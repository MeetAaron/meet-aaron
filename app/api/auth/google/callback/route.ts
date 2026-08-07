// app/api/auth/google/callback/route.ts
// Google redirige ici avec un "code" après que l'utilisateur a autorisé l'accès.
// On échange ce code contre un access_token + refresh_token, qu'on chiffre et stocke.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const userId = searchParams.get('state'); // récupéré depuis /api/auth/google
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${process.env.APP_URL}/app/settings?oauth_error=${error}`);
  }

  if (!code || !userId) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

  // Échange du code contre les tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token Google:', errBody);
    return NextResponse.redirect(`${process.env.APP_URL}/app/settings?oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, expires_in, scope, token_type, id_token }

  // Récupère l'email du compte connecté
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileResponse.json();

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Upsert dans oauth_connections (un utilisateur = une connexion Google max)
  const { error: dbError } = await supabaseAdmin
    .from('oauth_connections')
    .upsert(
      {
        user_id: userId,
        provider: 'google',
        provider_account_email: profile.email,
        access_token: encryptToken(tokens.access_token),
        refresh_token: encryptToken(tokens.refresh_token),
        scopes: tokens.scope.split(' '),
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens Google:', dbError);
    return NextResponse.redirect(`${process.env.APP_URL}/app/settings?oauth_error=db_error`);
  }

  return NextResponse.redirect(`${process.env.APP_URL}/app/settings?oauth_success=google`);
}
