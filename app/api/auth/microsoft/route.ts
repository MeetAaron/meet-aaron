// app/api/auth/microsoft/route.ts
// Démarre le flux OAuth Microsoft pour Outlook (calendrier + email).
// À activer une fois l'app Azure créée (Client ID / Secret Microsoft).

import { NextRequest, NextResponse } from 'next/server';

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
  const userId = searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/microsoft/callback`;

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state: userId,
  });

  return NextResponse.redirect(`${MICROSOFT_AUTH_URL}?${params.toString()}`);
}
