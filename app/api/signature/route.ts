// app/api/signature/route.ts
// GET    -> lit la signature email enregistrée pour le commercial
// PATCH  -> enregistre la signature (après relecture/correction manuelle)
// POST   -> tente de détecter automatiquement une signature à partir du
//           dernier email envoyé (Gmail uniquement pour l'instant) — ne
//           l'enregistre PAS, la renvoie juste pour relecture côté UI.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { getLastSentGmailBodyText } from '@/lib/google';
import { guessEmailSignature } from '@/lib/signature';
import { normalizeSignatureMap } from '@/lib/signature-locale';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Repli 42703 : tant que migration_signature_multilingue_2026-09-26.sql
  // n'est pas passée, la page Mon entreprise doit continuer à fonctionner
  // avec la seule signature par défaut.
  let userRes: any = await supabaseAdmin
    .from('users')
    .select('email_signature, email_signature_by_locale, email_signature_image_url, email_banner_image_url')
    .eq('id', userId)
    .maybeSingle();
  if (userRes.error && userRes.error.code === '42703') {
    userRes = await supabaseAdmin
      .from('users')
      .select('email_signature, email_signature_image_url, email_banner_image_url')
      .eq('id', userId)
      .maybeSingle();
  }
  const user: any = userRes.data;

  return NextResponse.json({
    signature: user?.email_signature || null,
    // Signature par langue de destinataire (A_FAIRE.docx, 26/09/2026) — voir
    // lib/signature-locale.ts. Objet { langue: texte }, les langues absentes
    // retombant sur `signature` ci-dessus.
    signature_by_locale: user?.email_signature_by_locale || null,
    signature_image_url: user?.email_signature_image_url || null,
    // Bandeau publicitaire affiché sous la signature dans les emails (docx
    // Modifs Aaron, bloc "AJOUT signature", 30/08/2026) — voir
    // migration_email_banner_2026-08-31.sql et lib/messaging.ts.
    banner_image_url: user?.email_banner_image_url || null,
  });
}

export async function PATCH(request: NextRequest) {
  const { user_id, signature, signature_by_locale } = await request.json();

  if (!user_id || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const patch: Record<string, any> = { email_signature: signature.trim() || null };
  // `signature_by_locale` absent du corps = champ non touché (les anciens
  // clients continuent de fonctionner). Présent mais vide = remise à zéro.
  const hasLocaleMap = signature_by_locale !== undefined;
  if (hasLocaleMap) {
    patch.email_signature_by_locale = normalizeSignatureMap(signature_by_locale);
  }

  let { error } = await supabaseAdmin.from('users').update(patch).eq('id', user_id);
  // Colonne pas encore créée : on enregistre au moins la signature par défaut
  // plutôt que de renvoyer une erreur au commercial, et on le dit.
  if (error && (error as any).code === '42703') {
    const retry = await supabaseAdmin
      .from('users')
      .update({ email_signature: signature.trim() || null })
      .eq('id', user_id);
    if (retry.error) {
      return NextResponse.json({ error: retry.error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, locale_signatures_saved: false });
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, locale_signatures_saved: hasLocaleMap });
}

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: connection } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider')
    .eq('user_id', user_id)
    .eq('provider', 'google')
    .maybeSingle();

  if (!connection) {
    return NextResponse.json(
      { error: "Détection automatique disponible uniquement pour Gmail — connectez votre compte Google, ou saisissez votre signature manuellement." },
      { status: 400 }
    );
  }

  try {
    const bodyText = await getLastSentGmailBodyText(user_id);
    const guess = guessEmailSignature(bodyText);

    if (!guess) {
      return NextResponse.json(
        { error: "Aucune signature détectée dans votre dernier email envoyé — saisissez-la manuellement ci-dessous.", signature: null },
        { status: 200 }
      );
    }

    return NextResponse.json({ signature: guess });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur lors de la détection' }, { status: 500 });
  }
}
