// app/api/auth/google/callback/route.ts
// Google redirige ici avec un "code" après que l'utilisateur a autorisé l'accès.
// On échange ce code contre un access_token + refresh_token, qu'on chiffre et stocke.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { notifyIfDeliverabilityIssue } from '@/lib/email-deliverability';

// Redirige tout en effaçant le cookie anti-CSRF à usage unique (posé par
// /api/auth/google), qu'il ait été consommé avec succès ou non.
function redirectClearingCookie(url: string) {
  const response = NextResponse.redirect(url);
  response.cookies.set('oauth_google_state', '', { path: '/api/auth/google', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=${error}&tab=connection`);
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  // Vérifie le cookie anti-CSRF posé par /api/auth/google dans CE même navigateur —
  // le user_id vient du cookie (posé côté serveur à partir d'un token vérifié),
  // jamais du "state" renvoyé par Google, qui n'est qu'une valeur de contrôle.
  const cookieValue = request.cookies.get('oauth_google_state')?.value;
  const [cookieNonce, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !userId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=state_mismatch&tab=connection`);
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
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=token_exchange_failed&tab=connection`);
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
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=db_error&tab=connection`);
  }

  // Fire-and-forget (demande Alex, 27/08/2026, suite à un domaine pro sans
  // DMARC repéré manuellement) : prévient tout de suite si le domaine pro
  // connecté n'a pas SPF/DMARC correct, plutôt que de compter sur une
  // visite future de Connexions — voir lib/email-deliverability.ts. Ne doit
  // jamais retarder ou faire échouer la redirection.
  if (profile.email) {
    notifyIfDeliverabilityIssue(userId, profile.email).catch(() => {});
  }

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_success=google&tab=connection`);
}
