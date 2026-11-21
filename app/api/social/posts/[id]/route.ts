// app/api/social/posts/[id]/route.ts
//
// AARON SOCIAL : modifier un post (21/11/2026).
// PATCH { content?, review_text? }
//   - content : le texte d'un ou plusieurs réseaux, retouché par le client ;
//   - review_text : l'avis client recopié, pour un post « client satisfait ».
// Le statut suit : « pret » quand ce que le post demandait est fourni.
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import { postIsReady } from '@/lib/social-media';
import { readJsonBody } from '@/lib/http';

export const runtime = 'nodejs';

const str = (v: any, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const list = (v: any, count: number, max: number) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : [];

// On ne garde que la forme attendue : rien d'autre n'entre dans content.
function mergeContent(current: any, incoming: any) {
  const c = current && typeof current === 'object' ? current : {};
  const n = incoming && typeof incoming === 'object' ? incoming : {};
  const out: any = { ...c };
  if (n.instagram) out.instagram = { slides: list(n.instagram.slides, 5, 220), caption: str(n.instagram.caption, 1500) };
  if (n.facebook) out.facebook = { text: str(n.facebook.text, 2000) };
  if (n.linkedin) out.linkedin = { slides: list(n.linkedin.slides, 5, 220), text: str(n.linkedin.text, 2000) };
  if (n.tiktok) out.tiktok = { scenes: list(n.tiktok.scenes, 5, 120), caption: str(n.tiktok.caption, 300) };
  return out;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { id } = await params;
  const body = await readJsonBody(request).catch(() => ({}));

  const { data: post } = await supabaseAdmin
    .from('social_posts')
    .select('id, company_id, content, material_needed, media, review_text, status')
    .eq('id', id)
    .maybeSingle();
  if (!post || (post as any).company_id !== authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const update: any = { updated_at: new Date().toISOString() };
  if (body?.content) update.content = mergeContent((post as any).content, body.content);
  if (typeof body?.review_text === 'string') update.review_text = str(body.review_text, 2000) || null;

  const next = { ...(post as any), ...update };
  if ((post as any).status !== 'publie' && (post as any).status !== 'retire') {
    update.status = postIsReady(next) ? 'pret' : 'brouillon';
  }

  const { data: saved, error } = await supabaseAdmin
    .from('social_posts')
    .update(update)
    .eq('id', id)
    .select('id, week, slot, category, subject, material_needed, material_hint, content, status, media, review_text')
    .single();
  if (error) {
    if (error.code === '42703') return NextResponse.json({ error: 'migration_missing' }, { status: 409 });
    console.error('[social] modification du post :', error.code || '', error.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  return NextResponse.json({ post: saved });
}
