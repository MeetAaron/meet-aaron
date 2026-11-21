// app/api/social/posts/[id]/publish/route.ts
//
// AARON SOCIAL : publier un post (21/11/2026). TikTok pour commencer
// (photos + musique proposée par TikTok, lib/social-tiktok.ts).
//
// POST { network: 'tiktok' } -> envoie les photos du post à TikTok ;
// GET  ?network=tiktok       -> où en est la publication (l'écran interroge
//                               toutes les 5 secondes pendant 2 minutes).
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import { cleanMediaList, socialMediaUrl } from '@/lib/social-media';
import { readJsonBody } from '@/lib/http';
import {
  choosePrivacy,
  fetchPublishStatus,
  getValidTiktokAccess,
  publishTiktokPhotos,
  queryCreatorInfo,
} from '@/lib/social-tiktok';

export const runtime = 'nodejs';

const SELECT = 'id, week, slot, category, subject, material_needed, material_hint, content, status, media, review_text, published, company_id';

async function loadPost(request: NextRequest, id: string): Promise<{ post: any } | { error: NextResponse }> {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return { error: unauthorizedResponse() };
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  const { data, error } = await supabaseAdmin.from('social_posts').select(SELECT).eq('id', id).maybeSingle();
  if (error?.code === '42703') return { error: NextResponse.json({ error: 'migration_missing' }, { status: 409 }) };
  if (!data || (data as any).company_id !== authedUser.company_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { post: data as any };
}

async function savePublished(post: any, tiktok: any, extra: any = {}) {
  const published = { ...(post.published && typeof post.published === 'object' ? post.published : {}), tiktok };
  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .update({ published, updated_at: new Date().toISOString(), ...extra })
    .eq('id', post.id)
    .select(SELECT)
    .single();
  if (error) throw error;
  const { company_id, ...rest } = data as any;
  return rest;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPost(request, id);
  if ('error' in loaded) return loaded.error;
  const post = loaded.post;
  const body = await readJsonBody(request).catch(() => ({}));
  if ((body?.network || 'tiktok') !== 'tiktok') return NextResponse.json({ error: 'network_unsupported' }, { status: 400 });

  const media = cleanMediaList(post.media);
  if (media.length === 0) return NextResponse.json({ error: 'photos_missing' }, { status: 400 });

  const access = await getValidTiktokAccess(post.company_id);
  if (!access) return NextResponse.json({ error: 'tiktok_not_linked' }, { status: 400 });

  const creator = await queryCreatorInfo(access.accessToken);
  if (!creator.ok) {
    console.error('[tiktok] creator_info :', creator.code);
    return NextResponse.json({ error: 'tiktok_refused', detail: creator.code }, { status: 502 });
  }
  const privacyLevel = choosePrivacy(creator.data?.privacy_level_options);
  if (!privacyLevel) return NextResponse.json({ error: 'tiktok_refused', detail: 'no_privacy_option' }, { status: 502 });

  const tiktok = post.content?.tiktok || {};
  const firstScene = Array.isArray(tiktok.scenes) && tiktok.scenes[0] ? String(tiktok.scenes[0]) : '';
  const result = await publishTiktokPhotos({
    accessToken: access.accessToken,
    photoUrls: media.map((m) => socialMediaUrl(m.path)),
    title: firstScene || String(post.subject || ''),
    description: String(tiktok.caption || ''),
    privacyLevel,
  });
  if (!result.ok || !result.data?.publish_id) {
    console.error('[tiktok] publication refusée :', result.code);
    try {
      const saved = await savePublished(post, { status: 'echec', error: result.code, started_at: new Date().toISOString() });
      return NextResponse.json({ error: 'tiktok_refused', detail: result.code, post: saved }, { status: 502 });
    } catch {
      return NextResponse.json({ error: 'tiktok_refused', detail: result.code }, { status: 502 });
    }
  }

  try {
    const saved = await savePublished(post, {
      publish_id: String(result.data.publish_id),
      status: 'en_cours',
      privacy: privacyLevel,
      started_at: new Date().toISOString(),
    });
    return NextResponse.json({ post: saved });
  } catch (err: any) {
    console.error('[tiktok] suivi de publication :', err?.message || err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPost(request, id);
  if ('error' in loaded) return loaded.error;
  const post = loaded.post;
  const current = post.published?.tiktok;
  if (!current?.publish_id || current.status !== 'en_cours') {
    const { company_id, ...rest } = post;
    return NextResponse.json({ post: rest });
  }

  const access = await getValidTiktokAccess(post.company_id);
  if (!access) return NextResponse.json({ error: 'tiktok_not_linked' }, { status: 400 });
  const res = await fetchPublishStatus(access.accessToken, current.publish_id);
  if (!res.ok) {
    const { company_id, ...rest } = post;
    return NextResponse.json({ post: rest, detail: res.code });
  }

  const status = String(res.data?.status || '');
  try {
    if (status === 'PUBLISH_COMPLETE') {
      const saved = await savePublished(post, { ...current, status: 'publie', published_at: new Date().toISOString() }, { status: 'publie' });
      return NextResponse.json({ post: saved });
    }
    if (status === 'FAILED') {
      const saved = await savePublished(post, { ...current, status: 'echec', error: String(res.data?.fail_reason || 'failed') });
      return NextResponse.json({ post: saved });
    }
  } catch (err: any) {
    console.error('[tiktok] mise à jour du statut :', err?.message || err);
  }
  const { company_id, ...rest } = post;
  return NextResponse.json({ post: rest, tiktok_status: status });
}
