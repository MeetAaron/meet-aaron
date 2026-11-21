// app/api/social/posts/[id]/media/route.ts
//
// AARON SOCIAL : photos d'un post (21/11/2026).
// POST   multipart « file » (JPEG, PNG ou WebP, 4 Mo max — l'écran réduit la
//        photo avant l'envoi) -> ajoutée au post ;
// DELETE ?path=… -> retirée du post et du stockage.
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import {
  SOCIAL_MEDIA_BUCKET,
  SOCIAL_MEDIA_MAX_BYTES,
  SOCIAL_MEDIA_MAX_PER_POST,
  SOCIAL_MEDIA_TYPES,
  cleanMediaList,
  postIsReady,
} from '@/lib/social-media';

export const runtime = 'nodejs';

const SELECT = 'id, week, slot, category, subject, material_needed, material_hint, content, status, media, review_text, company_id';

async function loadPost(request: NextRequest, id: string) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return { error: unauthorizedResponse() };
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  const { data: post, error } = await supabaseAdmin.from('social_posts').select(SELECT).eq('id', id).maybeSingle();
  if (error?.code === '42703') return { error: NextResponse.json({ error: 'migration_missing' }, { status: 409 }) };
  if (!post || (post as any).company_id !== authedUser.company_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { post: post as any };
}

async function saveMedia(post: any, media: any[]) {
  const next = { ...post, media };
  const update: any = { media, updated_at: new Date().toISOString() };
  if (post.status !== 'publie' && post.status !== 'retire') update.status = postIsReady(next) ? 'pret' : 'brouillon';
  const { data, error } = await supabaseAdmin.from('social_posts').update(update).eq('id', post.id).select(SELECT).single();
  if (error) throw error;
  const { company_id, ...rest } = data as any;
  return rest;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPost(request, id);
  if ('error' in loaded) return loaded.error;
  const post = loaded.post;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file_missing' }, { status: 400 });
  const ext = SOCIAL_MEDIA_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'bad_type' }, { status: 400 });
  if (file.size > SOCIAL_MEDIA_MAX_BYTES) return NextResponse.json({ error: 'too_big' }, { status: 400 });

  const current = cleanMediaList(post.media);
  if (current.length >= SOCIAL_MEDIA_MAX_PER_POST) return NextResponse.json({ error: 'too_many' }, { status: 400 });

  const path = `${post.company_id}/${post.id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(SOCIAL_MEDIA_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('[social] envoi de la photo :', upErr.message);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  try {
    const saved = await saveMedia(post, [...current, { path, added_at: new Date().toISOString() }]);
    return NextResponse.json({ post: saved });
  } catch (err: any) {
    await supabaseAdmin.storage.from(SOCIAL_MEDIA_BUCKET).remove([path]).catch(() => null);
    console.error('[social] enregistrement de la photo :', err?.message || err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPost(request, id);
  if ('error' in loaded) return loaded.error;
  const post = loaded.post;
  const path = request.nextUrl.searchParams.get('path') || '';
  const current = cleanMediaList(post.media);
  if (!current.some((m) => m.path === path)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const saved = await saveMedia(post, current.filter((m) => m.path !== path));
    await supabaseAdmin.storage.from(SOCIAL_MEDIA_BUCKET).remove([path]).catch(() => null);
    return NextResponse.json({ post: saved });
  } catch (err: any) {
    console.error('[social] retrait de la photo :', err?.message || err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
