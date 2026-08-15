// app/api/auth/hubspot/callback/route.ts
// HubSpot redirige ici avec un "code" après autorisation. Échange contre un
// access_token + refresh_token, chiffrés puis stockés dans crm_connections
// (voir migration_crm_sync_2026-08-15.sql). Même structure que
// app/api/auth/google/callback/route.ts.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';

function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_hubspot_state', '', { path: '/api/auth/hubspot', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/preferences?crm_oauth_error=${error}`);
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  const cookieValue = request.cookies.get('oauth_hubspot_state')?.value;
  const [cookieNonce, companyId, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !companyId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/preferences?crm_oauth_error=state_mismatch`);
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/hubspot/callback`;

  const tokenResponse = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    console.error('Erreur échange token HubSpot:', errBody);
    return redirectClearingCookie(`${process.env.APP_URL}/app/preferences?crm_oauth_error=token_exchange_failed`);
  }

  const tokens = await tokenResponse.json();
  // tokens: { access_token, refresh_token, expires_in, token_type }

  // Récupère le hub_id (identifiant du portail HubSpot) — informatif seulement,
  // affiché dans Préférences pour confirmer quel compte HubSpot est connecté.
  let hubId: string | null = null;
  try {
    const introspect = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tokens.access_token}`);
    if (introspect.ok) {
      const info = await introspect.json();
      hubId = info.hub_id ? String(info.hub_id) : null;
    }
  } catch (err) {
    console.error('Erreur introspection token HubSpot (non bloquant):', err);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: companyId,
        provider: 'hubspot',
        portal_id: hubId,
        access_token: encryptToken(tokens.access_token),
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        expires_at: expiresAt,
        connected_by_user_id: userId || null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage tokens HubSpot:', dbError);
    return redirectClearingCookie(`${process.env.APP_URL}/app/preferences?crm_oauth_error=db_error`);
  }

  // Garde companies.crm_provider synchronisé avec la vraie connexion — ce champ
  // servait jusqu'ici de simple déclaration d'intention (texte libre côté
  // Préférences), il reflète maintenant une connexion réelle une fois établie.
  await supabaseAdmin.from('companies').update({ crm_provider: 'hubspot' }).eq('id', companyId);

  return redirectClearingCookie(`${process.env.APP_URL}/app/preferences?crm_oauth_success=hubspot`);
}
