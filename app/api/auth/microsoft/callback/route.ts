// app/api/auth/microsoft/callback/route.ts
// Microsoft redirige ici avec un "code" après autorisation.
// Même logique que le callback Google, adaptée à l'API Microsoft Graph.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { notifyIfDeliverabilityIssue } from '@/lib/email-deliverability';

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

  // Retour du flux "consentement administrateur" (voir
  // app/api/auth/microsoft/admin-consent/route.ts) : Microsoft renvoie ici
  // avec ?admin_consent=True&tenant=... et SANS code — l'admin a autorisé
  // Aaron pour toute l'entreprise, il ne reste au commercial qu'à cliquer
  // "Connecter" normalement.
  if (searchParams.get('admin_consent')) {
    return redirectClearingCookie(
      `${process.env.APP_URL}/app/connexions?admin_consent=${error ? 'refused' : 'granted'}&tab=connection`
    );
  }

  if (error) {
    // Microsoft 365 : quand le locataire (tenant) interdit le consentement
    // utilisateur, l'employé reçoit "Approbation de l'administrateur requise"
    // et Microsoft nous renvoie error=access_denied avec un code AADSTS précis
    // dans error_description. Sans ce tri, l'utilisateur ne voyait qu'un
    // "access_denied" brut, incompréhensible et sans issue. On le distingue
    // pour afficher la marche à suivre (lien à envoyer à l'administrateur).
    //   AADSTS65004  : l'utilisateur a refusé lui-même
    //   AADSTS90094  : l'octroi nécessite une autorisation d'administrateur
    //   AADSTS900941 : consentement administrateur requis (variante)
    //   AADSTS530003/1000000 : politiques de conformité du locataire
    const description = searchParams.get('error_description') || '';
    const needsAdmin =
      error === 'consent_required' ||
      /AADSTS90094|AADSTS900941|admin(istrator)?[ _]?(approval|consent)|approbation de l'administrateur/i.test(description);
    const code = needsAdmin ? 'admin_consent_required' : error;
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=${code}&tab=connection`);
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'code ou state manquant' }, { status: 400 });
  }

  const cookieValue = request.cookies.get('oauth_microsoft_state')?.value;
  const [cookieNonce, userId] = cookieValue?.split(':') || [];

  if (!cookieValue || cookieNonce !== returnedState || !userId) {
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=state_mismatch&tab=connection`);
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
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=token_exchange_failed&tab=connection`);
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
    return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_error=db_error&tab=connection`);
  }

  // Fire-and-forget — voir même correctif côté Google callback et
  // lib/email-deliverability.ts. Ne doit jamais retarder ou faire échouer
  // la redirection.
  const microsoftEmail = profile.mail || profile.userPrincipalName;
  if (microsoftEmail) {
    notifyIfDeliverabilityIssue(userId, microsoftEmail).catch(() => {});
  }

  return redirectClearingCookie(`${process.env.APP_URL}/app/connexions?oauth_success=microsoft&tab=connection`);
}
