// app/api/social/meta/start/route.ts
//
// POST -> prépare la liaison Facebook + Instagram (21/11/2026) : renvoie
// l'adresse de la boîte de dialogue Facebook et pose le cookie de retour
// (voir lib/social-meta.ts). 503 tant que META_APP_SECRET ou
// META_LOGIN_CONFIG_ID manquent.
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import { createMetaState, metaAuthorizeUrl, META_STATE_COOKIE, META_STATE_TTL_SECONDS } from '@/lib/social-meta';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!authedUser.company_id) return NextResponse.json({ error: 'company_missing' }, { status: 400 });

  const created = createMetaState(authedUser.id);
  const url = created ? metaAuthorizeUrl(created.state) : null;
  if (!created || !url) return NextResponse.json({ error: 'meta_not_configured' }, { status: 503 });

  const response = NextResponse.json({ url });
  response.cookies.set(META_STATE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/social/meta',
    maxAge: META_STATE_TTL_SECONDS,
  });
  return response;
}
