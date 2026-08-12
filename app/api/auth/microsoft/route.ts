// app/api/auth/microsoft/route.ts
// Démarre le flux OAuth Microsoft pour Outlook (calendrier + email).
// À activer une fois l'app Azure créée (Client ID / Secret Microsoft).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const SCOPES = [
  'offline_access', // nécessaire pour obtenir un refresh_token
  'Calendars.ReadWrite',
  'Mail.Send', // envoi d'emails de prospection/relance au nom du commercial
  'Mail.Read', // lecture des réponses des prospects (cron check-inbox)
  'User.Read',
].join(' ');

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 });
  }

  // Même correctif que pour Google : l'identité vient du token vérifié, jamais
  // d'un user_id brut passé par le client.
  const authedUser = await getAuthedUserFromToken(token);
  if (!authedUser) {
    return NextResponse.json({ error: 'Non authentifié — reconnectez-vous.' }, { status: 401 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/microsoft/callback`;

  // Même protection anti-CSRF que pour Google (voir commentaire détaillé là-bas) :
  // le user_id part dans un cookie posé dans CE navigateur, pas dans le "state".
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${MICROSOFT_AUTH_URL}?${new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: SCOPES,
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_microsoft_state', `${nonce}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/microsoft',
  });

  return redirectResponse;
}
