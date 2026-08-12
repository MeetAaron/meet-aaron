// app/api/auth/google/route.ts
// Démarre le flux OAuth Google. Le commercial clique sur "Connecter Gmail"
// dans l'app -> redirigé ici -> redirigé vers Google -> revient sur /callback.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

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
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 });
  }

  // Sécurité : l'utilisateur Meet Aaron à qui la boîte mail sera liée est dérivé
  // du token de session vérifié, jamais d'un user_id brut passé par le client —
  // sinon un lien "Connecter Gmail" forgé aurait pu lier la boîte mail de la
  // victime au compte Meet Aaron de l'attaquant (state n'est qu'un aller-retour,
  // pas une preuve d'identité).
  const authedUser = await getAuthedUserFromToken(token);
  if (!authedUser) {
    return NextResponse.json({ error: 'Non authentifié — reconnectez-vous.' }, { status: 401 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

  // Anti-CSRF : le "state" qui part vers Google n'est qu'un aller-retour — n'importe
  // qui peut fabriquer sa propre URL d'autorisation Google (client_id/redirect_uri
  // sont publics) avec le "state" de son choix, puis la faire ouvrir par une victime.
  // On lie donc le vrai user_id à un cookie posé UNIQUEMENT dans CE navigateur (celui
  // qui vient de prouver son identité via le token) : au retour, /callback exige que
  // ce cookie soit présent et que son nonce corresponde au "state" reçu de Google —
  // ce qui ne peut être vrai que si la même personne a initié puis terminé le flux.
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${GOOGLE_AUTH_URL}?${new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // nécessaire pour obtenir un refresh_token
      prompt: 'consent',      // force le renvoi du refresh_token à chaque fois
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_google_state', `${nonce}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes, largement suffisant pour le temps du consentement Google
    path: '/api/auth/google',
  });

  return redirectResponse;
}
