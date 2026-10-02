// app/api/signature/image/route.ts
// POST   -> upload une image de signature (carte de visite) dans le bucket
//           public "signatures" (voir migration_account_page_2026-08-25.sql)
//           et enregistre son URL publique sur users.email_signature_image_url.
// DELETE -> retire l'image de signature (sans toucher au texte de signature).
//
// Demande Alex (2026-08-25, page "Mon compte") : "beaucoup de signatures
// email sont comme des cartes de visite, donc une image" — voir aussi
// lib/messaging.ts (bascule en email HTML pour intégrer cette image) et
// components AccountPage (app/app/connexions/page.jsx, onglet Mon entreprise).
//
// 30/08/2026 (docx Modifs Aaron, bloc "AJOUT signature") : la même route
// gère désormais aussi le BANDEAU PUBLICITAIRE affiché sous la signature
// dans les emails — champ "kind" ('signature' par défaut, ou 'banner') dans
// le formData (POST) / la query (DELETE). Même bucket, même limite de
// taille, colonne users.email_banner_image_url (voir
// migration_email_banner_2026-08-31.sql).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { SIGNATURE_LOCALES } from '@/lib/signature-locale';

// Langue de destinataire pour laquelle ce bandeau est prevu (30/09/2026).
// Vide = le bandeau PAR DEFAUT, celui qui sert pour toute langue non
// renseignee. Une valeur inconnue est ignoree plutot que refusee : mieux vaut
// enregistrer le bandeau par defaut que de renvoyer une erreur au commercial.
function localeParam(value: any): string | null {
  const key = String(value || '').trim().toLowerCase();
  return (SIGNATURE_LOCALES as readonly string[]).includes(key) ? key : null;
}

// Fusionne une URL dans la colonne jsonb { langue: url }, ou l'en retire.
// `null` en valeur = suppression de cette langue ; un objet vide redevient
// null pour que la colonne reste propre.
function mergeLocaleMap(current: any, locale: string, url: string | null): Record<string, string> | null {
  let map: any = current;
  if (typeof map === 'string') {
    try { map = JSON.parse(map); } catch { map = null; }
  }
  const out: Record<string, string> = (map && typeof map === 'object' && !Array.isArray(map)) ? { ...map } : {};
  if (url) out[locale] = url;
  else delete out[locale];
  return Object.keys(out).length > 0 ? out : null;
}

const BUCKET = 'signatures';
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 Mo — largement suffisant pour un logo/une carte de visite
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const userId = formData.get('user_id') as string | null;
  const kind = formData.get('kind') === 'banner' ? 'banner' : 'signature';
  const column = kind === 'banner' ? 'email_banner_image_url' : 'email_signature_image_url';
  // 02/10/2026 : l'image de signature est elle aussi declinable par langue.
  // Mon raisonnement precedent — « une carte de visite ne se traduit pas » —
  // valait pour une carte de visite, pas pour ce qu'Alex y met reellement :
  // un visuel de marque portant du texte, en sept versions.
  const locale = localeParam(formData.get('locale'));
  const localeColumn = kind === 'banner' ? 'email_banner_by_locale' : 'email_signature_image_by_locale';

  if (!file || !userId) {
    return NextResponse.json({ error: 'Fichier ou user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Format non supporté — utilisez une image PNG, JPEG, GIF ou WebP.' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Image trop lourde (2 Mo maximum).' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // Dossier préfixé par userId : nécessaire pour matcher la policy RLS
  // "Signatures écriture par propriétaire" (storage.foldername(name))[1] =
  // auth.uid()) en cas d'écriture directe depuis le client — ici on passe par
  // la clé service_role, mais on garde la même convention de chemin.
  const storagePath = `${userId}/${Date.now()}${kind === 'banner' ? '-banner' : ''}.${extensionFor(file.type)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlData.publicUrl;

  // Bandeau d'une langue precise : on fusionne dans la colonne jsonb, sans
  // toucher au bandeau par defaut. Repli 42703 tant que
  // migration_bandeau_multilingue_2026-09-30.sql n'est pas passee : on
  // enregistre alors le bandeau par defaut et on le dit, plutot que de
  // renvoyer une erreur incomprehensible.
  if (locale) {
    const { data: row, error: readErr } = await supabaseAdmin
      .from('users')
      .select(localeColumn)
      .eq('id', userId)
      .maybeSingle();

    if (!readErr) {
      const merged = mergeLocaleMap((row as any)?.[localeColumn], locale, publicUrl);
      const { error: mergeErr } = await supabaseAdmin
        .from('users')
        .update({ [localeColumn]: merged })
        .eq('id', userId);
      if (!mergeErr) return NextResponse.json({ url: publicUrl, locale });
      if ((mergeErr as any).code !== '42703') {
        return NextResponse.json({ error: mergeErr.message }, { status: 500 });
      }
    } else if ((readErr as any).code !== '42703') {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    return NextResponse.json({ url: publicUrl, locale, locale_saved: false });
  }

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ [column]: publicUrl })
    .eq('id', userId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl });
}

export async function DELETE(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const kind = request.nextUrl.searchParams.get('kind') === 'banner' ? 'banner' : 'signature';
  const column = kind === 'banner' ? 'email_banner_image_url' : 'email_signature_image_url';
  const locale = localeParam(request.nextUrl.searchParams.get('locale'));
  const localeColumnDel = kind === 'banner' ? 'email_banner_by_locale' : 'email_signature_image_by_locale';
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Retirer le bandeau d'UNE langue : elle retombe simplement sur le bandeau
  // par defaut, elle ne devient pas vide.
  if (locale) {
    const { data: row, error: readErr } = await supabaseAdmin
      .from('users')
      .select(localeColumnDel)
      .eq('id', userId)
      .maybeSingle();
    if (readErr && (readErr as any).code !== '42703') {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    const merged = mergeLocaleMap((row as any)?.[localeColumnDel], locale, null);
    const { error: mergeErr } = await supabaseAdmin
      .from('users')
      .update({ [localeColumnDel]: merged })
      .eq('id', userId);
    if (mergeErr && (mergeErr as any).code !== '42703') {
      return NextResponse.json({ error: mergeErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, locale });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ [column]: null })
    .eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
