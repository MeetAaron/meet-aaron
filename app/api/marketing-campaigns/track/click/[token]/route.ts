// app/api/marketing-campaigns/track/click/[token]/route.ts
// GET -> route PUBLIQUE (pas d'authentification — c'est un lien cliqué
// depuis une boîte mail) qui enregistre le clic du destinataire puis
// redirige vers l'URL d'origine (paramètre "u", posé par
// lib/marketing-tracking.ts au moment de l'envoi).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const FALLBACK_URL = (process.env.APP_URL || 'https://app.meetaaron.app').replace(/\/$/, '');

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const target = request.nextUrl.searchParams.get('u');

  // On ne redirige que vers une URL http(s) explicite — jamais vers une
  // valeur absente/mal formée, pour ne jamais servir de redirecteur ouvert
  // générique.
  let destination = FALLBACK_URL;
  if (target) {
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
