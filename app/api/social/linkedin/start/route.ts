// app/api/social/linkedin/start/route.ts
//
// POST -> prépare la liaison d'un compte LinkedIn : renvoie l'adresse
// d'autorisation LinkedIn où envoyer le navigateur, et pose le cookie qui
// permettra de reconnaître le retour (voir lib/social-linkedin.ts).
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';
import {
  createLinkedinState,
  linkedinAuthorizeUrl,
  linkedinClientSecret,
  linkedinPagesReady,
  LINKEDIN_STATE_COOKIE,
  LINKEDIN_STATE_TTL_SECONDS,
} from '@/lib/social-linkedin';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'company_missing' }, { status: 400 });
  }
  if (!linkedinPagesReady()) {
    return NextResponse.json({ error: 'linkedin_pending' }, { status: 409 });
  }
  if (!linkedinClientSecret()) {
    return NextResponse.json({ error: 'linkedin_not_configured' }, { status: 503 });
  }

  const created = createLinkedinState(authedUser.id);
  if (!created) {
    return NextResponse.json({ error: 'linkedin_not_configured' }, { status: 503 });
  }

  const response = NextResponse.json({ url: linkedinAuthorizeUrl(created.state) });
  response.cookies.set(LINKEDIN_STATE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/social/linkedin',
    maxAge: LINKEDIN_STATE_TTL_SECONDS,
  });
  return response;
}
