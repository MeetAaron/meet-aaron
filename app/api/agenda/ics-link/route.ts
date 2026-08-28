// app/api/agenda/ics-link/route.ts
// GET  -> renvoie (en la créant si besoin) l'URL d'abonnement calendrier
//         (webcal://) du commercial connecté.
// POST -> régénère le token (invalide l'ancien lien) — utile si le lien a
//         fuité, ou si le commercial veut couper un abonnement existant.
//
// Option complémentaire à la synchro Google/Outlook (28/08/2026, voir
// lib/calendar-sync.ts) : pour un commercial sans Google ni Microsoft
// connecté, ou qui préfère un flux dédié Aaron plutôt que d'utiliser son
// compte pro. Lecture seule (Aaron -> calendrier externe uniquement) — pas de
// remontée possible dans ce sens-là, contrairement à la synchro Google/
// Outlook qui est bidirectionnelle.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

function urlsForToken(token: string) {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const httpsUrl = `${base}/api/agenda/ics/${token}`;
  // webcal:// est le schéma standard reconnu par l'app Calendrier iOS/macOS
  // pour proposer directement "S'abonner" au lieu d'ouvrir/télécharger un
  // fichier — même contenu, juste un schéma différent de l'URL.
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');
  return { httpsUrl, webcalUrl };
}

async function handler(request: NextRequest, regenerate: boolean) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('ics_feed_token').eq('id', userId).maybeSingle();

  let token = user?.ics_feed_token;
  if (!token || regenerate) {
    token = randomUUID();
    const { error } = await supabaseAdmin.from('users').update({ ics_feed_token: token }).eq('id', userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(urlsForToken(token));
}

export async function GET(request: NextRequest) {
  return handler(request, false);
}

export async function POST(request: NextRequest) {
  return handler(request, true);
}
