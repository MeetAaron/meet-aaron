// app/api/auth/microsoft/callback/route.ts
// Microsoft redirige ici avec un "code" après autorisation.
// Même logique que le callback Google, adaptée à l'API Microsoft Graph.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

// Redirige tout en effaçant le cookie anti-CSRF à usage unique.
function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_microsoft_state', '', { path: '/api/auth/microsoft', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=${error}`);
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  const cookieValue = request.cookies.get('oauth_microsoft_state')?.value;
  const [cookieNonce, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !userId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=state_mismatch`);
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/microsoft/callback`;

  const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token Microsoft:', errBody);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, expires_in, scope, token_type }

  const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileResponse.json();

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: dbError } = await supabaseAdmin
    .from('oauth_connections')
    .upsert(
      {
        user_id: userId,
        provider: 'microsoft',
        provider_account_email: profile.mail || profile.userPrincipalName,
        access_token: encryptToken(tokens.access_token),
        refresh_token: encryptToken(tokens.refresh_token),
        scopes: tokens.scope.split(' '),
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens Microsoft:', dbError);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=db_error`);
  }

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_success=microsoft`);
}
