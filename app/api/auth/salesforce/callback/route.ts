// app/api/auth/salesforce/callback/route.ts
// Salesforce redirige ici avec un "code" après autorisation. Échange contre un
// access_token + refresh_token + instance_url, chiffrés (tokens) puis stockés
// dans crm_connections (voir migration_crm_instance_url_2026-08-16.sql). Même
// structure que app/api/auth/hubspot/callback/route.ts, avec l'ajout de
// `instance_url` : contrairement à HubSpot (une seule API centrale,
// api.hubapi.com), chaque organisation Salesforce a sa propre URL d'API
// (ex: https://monentreprise.my.salesforce.com), renvoyée dans la réponse du
// token et indispensable pour tous les appels API suivants.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_salesforce_state', '', { path: '/api/auth/salesforce', maxAge: 0 });
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

  const cookieValue = request.cookies.get('oauth_salesforce_state')?.value;
  const [cookieNonce, companyId, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !companyId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=state_mismatch`);
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/salesforce/callback`;

  const tokenResponse = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token Salesforce:', errBody);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, instance_url, id, token_type, issued_at, signature }
  // Pas d'expires_in renvoyé par Salesforce (contrairement à HubSpot) — les
  // access_token Salesforce n'expirent pas à date fixe connue à l'avance ;
  // lib/crm-sync.ts gère ceci en retentant avec le refresh_token dès qu'un
  // appel API renvoie 401, plutôt que de calculer une date d'expiration.

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: companyId,
        provider: 'salesforce',
        portal_id: tokens.id ? String(tokens.id) : null,
        instance_url: tokens.instance_url || null,
        access_token: encryptToken(tokens.access_token),
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        expires_at: null,
        connected_by_user_id: userId || null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens Salesforce:', dbError);
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_error=db_error`);
  }

  await supabaseAdmin.from('companies').update({ crm_provider: 'salesforce' }).eq('id', companyId);

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?crm_oauth_success=salesforce`);
}
