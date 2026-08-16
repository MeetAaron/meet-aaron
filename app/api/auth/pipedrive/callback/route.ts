// app/api/auth/pipedrive/callback/route.ts
// Pipedrive redirige ici avec un "code" après autorisation. Échange contre un
// access_token + refresh_token + api_domain, chiffrés (tokens) puis stockés
// dans crm_connections. Même structure que
// app/api/auth/salesforce/callback/route.ts (également un domaine d'API
// propre au client, stocké dans la colonne générique `instance_url`).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_pipedrive_state', '', { path: '/api/auth/pipedrive', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=${error}`);
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  const cookieValue = request.cookies.get('oauth_pipedrive_state')?.value;
  const [cookieNonce, companyId, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !companyId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=state_mismatch`);
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/pipedrive/callback`;

  const tokenResponse = await fetch('https://oauth.pipedrive.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token Pipedrive:', errBody);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, expires_in, scope, api_domain, token_type }
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: companyId,
        provider: 'pipedrive',
        portal_id: null,
        instance_url: tokens.api_domain || null,
        access_token: encryptToken(tokens.access_token),
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        expires_at: expiresAt,
        connected_by_user_id: userId || null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens Pipedrive:', dbError);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=db_error`);
  }

  await supabaseAdmin.from('companies').update({ crm_provider: 'pipedrive' }).eq('id', companyId);

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_success=pipedrive`);
}
