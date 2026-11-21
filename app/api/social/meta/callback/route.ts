// app/api/social/meta/callback/route.ts
//
// GET -> retour de Facebook (Facebook Login for Business), 21/11/2026.
// On vérifie le « state », on échange le code, on lit la page gérée et son
// compte Instagram professionnel, puis on range DEUX liaisons chiffrées :
// 'facebook' (la page) et 'instagram' (le compte relié), avec le jeton de
// la page (c'est lui qui publie, pour les deux). Plusieurs pages : retour
// avec etat=choix, la personne choisit (app/api/social/meta/pages).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import { exchangeMetaCode, fetchMetaPages, readMetaState, saveMetaPage, META_PICK_COOKIE, META_PICK_TTL_SECONDS, META_STATE_COOKIE } from '@/lib/social-meta';

function back(result: 'ok' | 'refus' | 'erreur' | 'sans_page' | 'choix') {
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
  if (pages.length === 0) return back('sans_page');

  if (pages.length > 1) {
    // Plusieurs pages : la personne choisit dans Mon compte.
    const response = back('choix');
    response.cookies.set(META_PICK_COOKIE, encryptToken(tokens.token), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/social/meta',
      maxAge: META_PICK_TTL_SECONDS,
    });
    return response;
  }

  const saved = await saveMetaPage(supabaseAdmin, (user as any).company_id, (user as any).id, pages[0], encryptToken);
  return back(saved ? 'ok' : 'erreur');
}
