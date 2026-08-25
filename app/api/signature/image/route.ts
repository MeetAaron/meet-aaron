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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

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
  const storagePath = `${userId}/${Date.now()}.${extensionFor(file.type)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlData.publicUrl;

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ email_signature_image_url: publicUrl })
    .eq('id', userId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl });
}

export async function DELETE(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { error } = await supabaseAdmin
    .from('users')
    .update({ email_signature_image_url: null })
    .eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
