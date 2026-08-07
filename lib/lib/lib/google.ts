// app/api/auth/google/route.ts
// Démarre le flux OAuth Google. Le commercial clique sur "Connecter Gmail"
// dans l'app -> redirigé ici -> redirigé vers Google -> revient sur /callback.

import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ');

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('user_id'); // l'utilisateur Meet Aaron qui se connecte

  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // nécessaire pour obtenir un refresh_token
    prompt: 'consent',      // force le renvoi du refresh_token à chaque fois
    state: userId,          // on récupère l'user_id au retour du callback
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
