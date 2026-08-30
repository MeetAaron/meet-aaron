// app/api/auth/microsoft/route.ts
// Démarre le flux OAuth Microsoft pour Outlook (calendrier + email).
// À activer une fois l'app Azure créée (Client ID / Secret Microsoft).
//
// Accepte aussi un paramètre ?qr=... (28/08/2026, voir app/api/auth/qr-token/
// route.ts et le même commentaire côté app/api/auth/google/route.ts) : atteint
// en scannant le QR code affiché dans Connexions, typiquement depuis le
// téléphone du commercial.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken, resolveAndConsumeQrToken } from '@/lib/auth-helpers';

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const SCOPES = [
  'offline_access', // nécessaire pour obtenir un refresh_token
  'Calendars.ReadWrite',
  // Bug remonté par Alex (30/08/2026, test avec un compte Outlook TeamSystem) :
  // "Erreur création du brouillon Outlook: ErrorAccessDenied / Access is
  // denied." — lib/microsoft.ts::sendOutlookEmail crée d'abord un brouillon
  // via POST /me/messages (ce qui nécessite Mail.ReadWrite, l'écriture dans
  // un dossier de la boîte) PUIS l'envoie via POST /me/messages/{id}/send
  // (ce qui nécessite Mail.Send). Mail.Send seul ne couvre PAS la création
  // du brouillon — c'est exactement ce qui manquait ici. Les deux scopes
  // sont donc nécessaires ensemble pour ce parcours en 2 étapes (voir le
  // commentaire détaillé dans sendOutlookEmail sur le choix brouillon+envoi
  // plutôt que /sendMail direct, nécessaire pour poser la catégorie "🤖 Géré
  // par Aaron" après coup).
  'Mail.ReadWrite',
  'Mail.Send', // envoi d'emails de prospection/relance au nom du commercial
  'Mail.Read', // lecture des réponses des prospects (cron check-inbox)
  'User.Read',
].join(' ');

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const qrToken = searchParams.get('qr');

  // Même correctif que pour Google : l'identité vient du token vérifié (ou du
  // jeton QR à usage unique), jamais d'un user_id brut passé par le client.
  let authedUser;
  if (qrToken) {
    authedUser = await resolveAndConsumeQrToken(qrToken, 'microsoft');
    if (!authedUser) {
      return NextResponse.json(
        { error: 'QR code expiré ou déjà utilisé — génère-en un nouveau depuis Connexions.' },
        { status: 401 }
      );
    }
  } else if (token) {
    authedUser = await getAuthedUserFromToken(token);
    if (!authedUser) {
      return NextResponse.json({ error: 'Non authentifié — reconnectez-vous.' }, { status: 401 });
    }
  } else {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 });
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
