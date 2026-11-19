// app/api/social/tiktok/start/route.ts
//
// POST -> prépare la liaison d'un compte TikTok : renvoie l'adresse
// d'autorisation TikTok où envoyer le navigateur, et pose le cookie qui
// permettra de reconnaître le retour (voir lib/social-tiktok.ts).
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import {
  createTiktokState,
  tiktokAuthorizeUrl,
  tiktokClientSecret,
  TIKTOK_STATE_COOKIE,
  TIKTOK_STATE_TTL_SECONDS,
} from '@/lib/social-tiktok';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'company_missing' }, { status: 400 });
  }
  if (!tiktokClientSecret()) {
    return NextResponse.json({ error: 'tiktok_not_configured' }, { status: 503 });
  }

  const created = createTiktokState(authedUser.id);
  if (!created) {
    return NextResponse.json({ error: 'tiktok_not_configured' }, { status: 503 });
  }

  const response = NextResponse.json({ url: tiktokAuthorizeUrl(created.state) });
  response.cookies.set(TIKTOK_STATE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/social/tiktok',
    maxAge: TIKTOK_STATE_TTL_SECONDS,
  });
  return response;
}
