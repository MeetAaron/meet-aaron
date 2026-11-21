// app/api/social/meta/callback/route.ts
//
// GET -> retour de Facebook (Facebook Login for Business), 21/11/2026.
// On vérifie le « state », on échange le code, on lit la page gérée et son
// compte Instagram professionnel, puis on range DEUX liaisons chiffrées :
// 'facebook' (la page) et 'instagram' (le compte relié), avec le jeton de
// la page (c'est lui qui publie, pour les deux).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import { exchangeMetaCode, fetchMetaPages, readMetaState, META_STATE_COOKIE } from '@/lib/social-meta';

function back(result: 'ok' | 'refus' | 'erreur' | 'sans_page') {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  const response = NextResponse.redirect(`${base}/app/connexions?tab=social&social=facebook&etat=${result}`);
  response.cookies.set(META_STATE_COOKIE, '', { path: '/api/social/meta', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const userId = readMetaState(params.get('state'), request.cookies.get(META_STATE_COOKIE)?.value || null);
  if (!userId) return back('erreur');
  if (params.get('error')) return back(params.get('error_reason') === 'user_denied' ? 'refus' : 'erreur');
  const code = params.get('code');
  if (!code) return back('erreur');

  const { data: user } = await supabaseAdmin.from('users').select('id, email, company_id').eq('id', userId).maybeSingle();
  if (!user || !(user as any).company_id || !socialPreviewAllowed((user as any).email)) return back('erreur');

  const tokens = await exchangeMetaCode(code);
  if (!tokens) return back('erreur');
  const pages = await fetchMetaPages(tokens.token);
  const page = pages.find((p) => p.instagram) || pages[0];
  if (!page) return back('sans_page');

  const now = new Date().toISOString();
  const base = { company_id: (user as any).company_id, connected_by: (user as any).id, refresh_token: null, refresh_expires_at: null, updated_at: now };
  const rows: any[] = [
    {
      ...base,
      provider: 'facebook',
      account_id: page.id,
      account_name: page.name || null,
      avatar_url: null,
      access_token: encryptToken(page.accessToken),
      access_expires_at: null, // jeton de page issu d'un jeton long : sans échéance
      scopes: 'page',
    },
  ];
  if (page.instagram) {
    rows.push({
      ...base,
      provider: 'instagram',
      account_id: page.instagram.id,
      account_name: page.instagram.username ? `@${page.instagram.username}` : null,
      avatar_url: page.instagram.picture,
      access_token: encryptToken(page.accessToken),
      access_expires_at: null,
      scopes: `page:${page.id}`,
    });
  }
  const { error } = await supabaseAdmin.from('social_connections').upsert(rows, { onConflict: 'company_id,provider' });
  if (error) {
    console.error('[meta] enregistrement de la liaison :', error.code || '', error.message);
    return back('erreur');
  }
  return back('ok');
}
