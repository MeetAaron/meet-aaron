// app/api/social/meta/pages/route.ts
//
// Choix de la page Facebook quand le compte en gère plusieurs (21/11/2026).
// GET  -> les pages proposées (nom, compte Instagram relié), jamais de jeton ;
// POST { page_id } -> lie cette page (et son Instagram), efface le cookie.
// Le jeton utilisateur vient du cookie chiffré posé par le retour Facebook
// (lib/social-meta.ts, META_PICK_COOKIE, 15 minutes).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { decryptToken, encryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import { readJsonBody } from '@/lib/http';
import { fetchMetaPages, saveMetaPage, META_PICK_COOKIE } from '@/lib/social-meta';

async function context(request: NextRequest): Promise<{ user: any; token: string } | { error: NextResponse }> {
  const user = await getAuthedUser(request);
  if (!user) return { error: unauthorizedResponse() };
  if (!socialPreviewAllowed(user.email) || !user.company_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  const stored = request.cookies.get(META_PICK_COOKIE)?.value;
  if (!stored) return { error: NextResponse.json({ error: 'expired' }, { status: 410 }) };
  try {
    return { user, token: decryptToken(stored) };
  } catch {
    return { error: NextResponse.json({ error: 'expired' }, { status: 410 }) };
  }
}

export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;
  const pages = await fetchMetaPages(ctx.token);
  return NextResponse.json({
    pages: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ? `@${p.instagram.username}` : null })),
  });
}

export async function POST(request: NextRequest) {
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;
  const body = await readJsonBody(request).catch(() => ({}));
  const pageId = String(body?.page_id || '');
  const pages = await fetchMetaPages(ctx.token);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return NextResponse.json({ error: 'page_not_found' }, { status: 400 });
  const saved = await saveMetaPage(supabaseAdmin, ctx.user.company_id, ctx.user.id, page, encryptToken);
  if (!saved) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  const response = NextResponse.json({ success: true });
  response.cookies.set(META_PICK_COOKIE, '', { path: '/api/social/meta', maxAge: 0 });
  return response;
}
