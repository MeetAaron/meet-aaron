// app/api/social/meta/webhook/route.ts
//
// AARON SOCIAL — point d'entrée des notifications Meta (commentaires et
// messages Instagram et Facebook). Socle du 18/11/2026 : la route vérifie et
// accuse réception, elle ne traite encore rien (voir lib/social-meta.ts).
//
// GET  : poignée de main. Quand on enregistre l'adresse dans la console Meta,
//        Meta appelle ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
//        et attend le « challenge » en retour, tel quel, en texte.
// POST : notification. Signature vérifiée sur le corps brut ; réponse 200
//        immédiate, parce que Meta renvoie la notification tant qu'il n'a pas
//        eu de réponse rapide.

import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenMatches, verifyWebhookSignature } from '@/lib/social-meta';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const challenge = params.get('hub.challenge');
  if (params.get('hub.mode') !== 'subscribe' || !challenge || !verifyTokenMatches(params.get('hub.verify_token'))) {
    console.warn('[social-meta] vérification du webhook refusée');
    return new NextResponse('Forbidden', { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    console.warn('[social-meta] notification refusée : signature absente ou invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 403 });
  }

  // Journal minimal : le type d'objet et le nombre d'entrées, JAMAIS le
  // contenu (un commentaire ou un message privé est une donnée personnelle).
  let object = 'inconnu';
  let entries = 0;
  try {
    const body = JSON.parse(rawBody);
    object = typeof body?.object === 'string' ? body.object : 'inconnu';
    entries = Array.isArray(body?.entry) ? body.entry.length : 0;
  } catch {}
  console.info('[social-meta] notification reçue', { object, entries });

  return NextResponse.json({ received: true });
}
