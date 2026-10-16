// app/api/t/[token]/route.ts
// Pixel de suivi d'ouverture des devis. Point d'accès PUBLIC : l'URL part
// dans un email, personne n'est authentifié quand elle est appelée.
//
// Ce que cet endpoint renvoie, toujours et quoi qu'il arrive : un GIF
// transparent de 1×1. Jeton inconnu, base de données en panne, token
// malformé — la réponse est identique. Deux raisons :
//   - côté client, une image cassée dans un devis fait mauvais effet ;
//   - côté sécurité, répondre différemment selon que le jeton existe ou non
//     transformerait ce point d'accès en oracle permettant de tester des
//     jetons. Réponse constante, donc rien à apprendre en la sondant.
//
// Aucune donnée personnelle n'est enregistrée : ni adresse IP, ni
// user-agent, ni en-têtes. On écrit une date et on incrémente un compteur.
// C'est tout ce dont la relance a besoin, et c'est le minimum que le RGPD
// nous autorise à collecter sans justification supplémentaire.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GIF 1×1 transparent, 43 octets.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function pixelResponse() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      // Sans ces en-têtes, le proxy d'images de Gmail sert sa copie en cache
      // et la deuxième ouverture n'arrive jamais jusqu'à nous.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

// Fenêtre anti-rebond : un même client mail recharge parfois l'image
// plusieurs fois pour un seul affichage (défilement, fenêtre d'aperçu). Sans
// ce garde-fou, « ouvert 7 fois » voudrait dire « a fait défiler une fois ».
const DEBOUNCE_MS = 2 * 60 * 1000;

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;

  // La réponse ne dépend jamais du traitement : on la prépare d'abord, et
  // toute erreur plus bas est avalée. Le client voit un devis correct même
  // si notre base est indisponible.
  try {
    if (!token || !/^[0-9a-f]{32}$/.test(token)) return pixelResponse();

    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, full_name, devis_opened_at, devis_last_opened_at, devis_open_count, devis_call_done_at')
      .eq('devis_track_token', token)
      .maybeSingle();

    if (!prospect) return pixelResponse();

    const now = new Date();
    const last = prospect.devis_last_opened_at ? new Date(prospect.devis_last_opened_at) : null;
    if (last && now.getTime() - last.getTime() < DEBOUNCE_MS) return pixelResponse();

    const isFirstOpen = !prospect.devis_opened_at;

    await supabaseAdmin
      .from('prospects')
      .update({
        devis_opened_at: prospect.devis_opened_at || now.toISOString(),
        devis_last_opened_at: now.toISOString(),
        devis_open_count: (prospect.devis_open_count || 0) + 1,
      })
      .eq('id', prospect.id);

    // Push UNIQUEMENT à la première ouverture, et seulement si le commercial
    // n'a pas déjà traité la relance. Les réouvertures se voient dans la
    // story ; elles ne méritent pas de faire sonner un téléphone. C'est la
    // leçon des quatorze notifications du 13/10 : chaque push de trop coûte
    // la crédibilité de tous les suivants.
    if (isFirstOpen && !prospect.devis_call_done_at) {
      await sendPushNotification(prospect.assigned_user_id, {
        title: 'Devis ouvert',
        body: `${prospect.full_name} est en train de lire ton devis. Appelle-le.`,
        url: `/app/prospects?contact=${prospect.id}`,
        // Un tag par prospect : si un second devis était suivi pour la même
        // personne, la notification remplacerait la précédente au lieu de
        // s'empiler.
        tag: `devis_ouvert:${prospect.id}`,
      });
    }
  } catch (err: any) {
    console.error('Pixel devis — traitement ignoré:', err?.message);
  }

  return pixelResponse();
}
