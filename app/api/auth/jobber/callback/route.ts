// app/api/auth/jobber/callback/route.ts
// Jobber redirige ici avec un "code" après autorisation. Échange contre un
// access_token + refresh_token, chiffrés puis stockés dans crm_connections.
// Même structure que app/api/auth/pipedrive/callback/route.ts, sans
// `instance_url` : Jobber a une seule API globale (https://api.getjobber.com/
// api/graphql), pas de domaine propre au client contrairement à Salesforce/
// Pipedrive.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';

function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_jobber_state', '', { path: '/api/auth/jobber', maxAge: 0 });
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

  const cookieValue = request.cookies.get('oauth_jobber_state')?.value;
  const [cookieNonce, companyId, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !companyId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=state_mismatch`);
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/jobber/callback`;

  const tokenResponse = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token Jobber:', errBody);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, expires_in, token_type, scope } —
  // access token valide 60 minutes (doc Jobber), d'où le rafraîchissement
  // automatique dans lib/crm-sync.ts.
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: companyId,
        provider: 'jobber',
        portal_id: null,
        instance_url: null,
        access_token: encryptToken(tokens.access_token),
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        expires_at: expiresAt,
        connected_by_user_id: userId || null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens Jobber:', dbError);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=db_error`);
  }

  await supabaseAdmin.from('companies').update({ crm_provider: 'jobber' }).eq('id', companyId);

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_success=jobber`);
}
