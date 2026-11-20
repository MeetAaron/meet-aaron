// app/api/social/linkedin/callback/route.ts
//
// GET -> retour de LinkedIn après l'écran d'autorisation.
//   succès : ?code=…&state=…
//   refus  : ?error=user_cancelled_authorize (ou autre)&error_description=…&state=…
//
// Même contrôle que TikTok (signature + cookie + 10 minutes), jeton rangé
// CHIFFRÉ, retour vers Mon compte avec ok, refus ou erreur. Aucun jeton ni
// code dans l'adresse de retour ni dans les journaux.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import {
  exchangeLinkedinCode,
  fetchLinkedinProfile,
  readLinkedinState,
  LINKEDIN_STATE_COOKIE,
} from '@/lib/social-linkedin';

function back(result: 'ok' | 'refus' | 'erreur') {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  const response = NextResponse.redirect(`${base}/app/connexions?tab=profile&social=linkedin&etat=${result}`);
  response.cookies.set(LINKEDIN_STATE_COOKIE, '', { path: '/api/social/linkedin', maxAge: 0 });
  return response;
}

function expiry(seconds: number | null): string | null {
  return seconds && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const userId = readLinkedinState(params.get('state'), request.cookies.get(LINKEDIN_STATE_COOKIE)?.value || null);
  if (!userId) return back('erreur');

  if (params.get('error')) {
    // Refus de la personne, ou portée non accordée à l'appli (produit pas
    // encore activé) : on garde la cause dans les journaux.
    console.warn('[linkedin] autorisation non accordée :', params.get('error'));
    return back(params.get('error') === 'user_cancelled_authorize' || params.get('error') === 'user_cancelled_login' ? 'refus' : 'erreur');
  }

  const code = params.get('code');
  if (!code) return back('erreur');

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, company_id')
    .eq('id', userId)
    .maybeSingle();
  if (!user || !(user as any).company_id || !socialPreviewAllowed((user as any).email)) return back('erreur');

  const tokens = await exchangeLinkedinCode(code);
  if (!tokens) return back('erreur');

  const profile = await fetchLinkedinProfile(tokens.access_token);

  const { error } = await supabaseAdmin.from('social_connections').upsert(
    {
      company_id: (user as any).company_id,
      connected_by: (user as any).id,
      provider: 'linkedin',
      account_id: profile.id || 'inconnu',
      account_name: profile.name,
      avatar_url: profile.avatarUrl,
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      access_expires_at: expiry(tokens.expires_in),
      refresh_expires_at: expiry(tokens.refresh_expires_in),
      scopes: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,provider' }
  );
  if (error) {
    console.error('[linkedin] enregistrement de la liaison impossible :', error.code || '', error.message);
    return back('erreur');
  }
  return back('ok');
}
