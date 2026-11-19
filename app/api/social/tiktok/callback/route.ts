// app/api/social/tiktok/callback/route.ts
//
// GET -> retour de TikTok après l'écran d'autorisation.
//   succès : ?code=…&scopes=…&state=…
//   refus  : ?error=…&error_description=…&state=…
//
// On vérifie le « state » (signature + cookie du navigateur + 10 minutes),
// on échange le code contre des jetons, on les range CHIFFRÉS, puis on
// renvoie vers Mon compte avec un état court : ok, refus ou erreur. Aucun
// jeton ni code ne part dans l'adresse de retour ni dans les journaux.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import {
  exchangeTiktokCode,
  fetchTiktokProfile,
  readTiktokState,
  TIKTOK_STATE_COOKIE,
} from '@/lib/social-tiktok';

function back(result: 'ok' | 'refus' | 'erreur') {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  const response = NextResponse.redirect(`${base}/app/connexions?tab=profile&social=tiktok&etat=${result}`);
  response.cookies.set(TIKTOK_STATE_COOKIE, '', { path: '/api/social/tiktok', maxAge: 0 });
  return response;
}

function expiry(seconds: number | null): string | null {
  return seconds && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const userId = readTiktokState(params.get('state'), request.cookies.get(TIKTOK_STATE_COOKIE)?.value || null);
  if (!userId) return back('erreur');

  // La personne a refusé, ou son compte n'a pas le droit de se lier.
  if (params.get('error')) return back('refus');

  const code = params.get('code');
  if (!code) return back('erreur');

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, company_id')
    .eq('id', userId)
    .maybeSingle();
  if (!user || !(user as any).company_id || !socialPreviewAllowed((user as any).email)) return back('erreur');

  const tokens = await exchangeTiktokCode(code);
  if (!tokens) return back('erreur');

  const profile = await fetchTiktokProfile(tokens.access_token);

  const { error } = await supabaseAdmin.from('social_connections').upsert(
    {
      company_id: (user as any).company_id,
      connected_by: (user as any).id,
      provider: 'tiktok',
      account_id: tokens.open_id,
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
    console.error('[tiktok] enregistrement de la liaison impossible :', error.code || '', error.message);
    return back('erreur');
  }
  return back('ok');
}
