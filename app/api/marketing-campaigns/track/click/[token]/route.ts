// app/api/marketing-campaigns/track/click/[token]/route.ts
// GET -> route PUBLIQUE (pas d'authentification — c'est un lien cliqué
// depuis une boîte mail) qui enregistre le clic du destinataire puis
// redirige vers l'URL d'origine (paramètre "u", posé par
// lib/marketing-tracking.ts au moment de l'envoi).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyTrackedUrl } from '@/lib/marketing-tracking';

const FALLBACK_URL = (process.env.APP_URL || 'https://app.meetaaron.app').replace(/\/$/, '');

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const target = request.nextUrl.searchParams.get('u');
  const sig = request.nextUrl.searchParams.get('s');

  // PAS UN REDIRECTEUR OUVERT (CASA 5.1.2, 19/10/2026). La destination n'est
  // suivie que si (1) c'est une URL http(s) bien formée ET (2) la signature
  // HMAC posée à l'envoi (lib/marketing-tracking.ts, signTrackedUrl) est
  // valide pour CE jeton destinataire et CETTE URL. Toute URL forgée ou
  // modifiée, et tout lien sans signature, renvoie vers meetaaron.app. La
  // liste blanche, c'est donc exactement l'ensemble des liens que nous avons
  // nous-mêmes écrits dans les emails envoyés.
  let destination = FALLBACK_URL;
  if (target && /^[0-9a-f-]{20,}$/i.test(params.token) && verifyTrackedUrl(params.token, target, sig)) {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') destination = target;
    } catch {
      // URL mal formée : on retombe sur FALLBACK_URL.
    }
  }

  const { data: recipient } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id, click_count, clicked_at')
    .eq('tracking_token', params.token)
    .maybeSingle();

  if (recipient) {
    await supabaseAdmin
      .from('marketing_campaign_recipients')
      .update({
        click_count: (recipient.click_count || 0) + 1,
        clicked_at: recipient.clicked_at || new Date().toISOString(),
      })
      .eq('id', recipient.id);
  }

  return NextResponse.redirect(destination, { status: 302 });
}
