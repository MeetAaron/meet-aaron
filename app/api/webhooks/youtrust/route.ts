// app/api/webhooks/youtrust/route.ts
// Reçoit les notifications de statut de Youtrust (ex-Yousign, voir
// lib/youtrust.ts) quand un prospect signe (ou refuse de signer) un devis
// envoyé via app/api/prospects/[id]/signature-request.
//
// Vérification : la doc publique Youtrust ne précise pas de format de
// signature HMAC pour son webhook (contrairement à Stripe) — on protège donc
// cette route avec un secret partagé passé en paramètre d'URL, à définir à
// la fois dans Vercel (YOUTRUST_WEBHOOK_SECRET) et dans l'URL du webhook
// configuré côté tableau de bord Youtrust :
//   https://meetaaron.app/api/webhooks/youtrust?secret=<YOUTRUST_WEBHOOK_SECRET>
// Alex doit créer cet abonnement webhook lui-même dans le dashboard Youtrust
// (Paramètres > Webhooks), sur les événements "signature_request.done" et
// "signature_request.declined" — voir developers.youtrust.com/docs/webhooks.
//
// Événements gérés (noms confirmés par la doc publique) :
//   - signature_request.done     -> le prospect a signé : bascule en client
//     gagné (même effet que l'action manuelle "set_deal_stage = signé"),
//     exactement comme la détection "bon pour accord" par email (voir
//     app/api/cron/check-inbox).
//   - signature_request.declined -> le prospect a refusé de signer : notifie
//     le commercial, ne change pas le statut du prospect (à lui de décider
//     la suite — relance, perdu, etc.).
//
// Le payload exact n'est pas documenté publiquement dans le détail — on lit
// l'id de la demande de signature de façon tolérante à plusieurs formes
// plausibles (event.data.id, event.data.signature_request.id, event.id).

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';
import { markQuoteSigned } from '@/lib/quote-signature';

function extractSignatureRequestId(event: any): string | null {
  return (
    event?.data?.id ||
    event?.data?.signature_request?.id ||
    event?.data?.signature_request_id ||
    event?.signature_request_id ||
    null
  );
}

// AUTHENTIFICATION (22/10/2026, dette CASA « secret dans l'URL ») :
//   1. préférée : signature HMAC-SHA256 du corps brut, envoyée par Youtrust
//      (ex-Yousign) dans l'en-tête X-Yousign-Signature-256 (ou
//      X-Youtrust-Signature-256), au format « sha256=<hex> », calculée avec le
//      secret du webhook = YOUTRUST_WEBHOOK_SECRET. Le secret ne voyage plus
//      dans l'URL (donc plus dans les journaux d'accès).
//   2. héritée, gardée pour ne rien casser tant que l'URL du webhook n'a pas
//      été changée côté Youtrust : ?secret=… dans l'URL. Comparaison en temps
//      constant. À retirer une fois la signature constatée dans les journaux
//      (« youtrust webhook: signature » ).
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const received = header.trim().replace(/^sha256=/i, '');
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return constantTimeEqual(received.toLowerCase(), expected);
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.YOUTRUST_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  const rawBody = await request.text();
  const sigHeader = request.headers.get('x-yousign-signature-256') || request.headers.get('x-youtrust-signature-256');
  const urlSecret = request.nextUrl.searchParams.get('secret');
  if (signatureValid(rawBody, sigHeader, webhookSecret)) {
    console.info('youtrust webhook: signature');
  } else if (urlSecret && constantTimeEqual(urlSecret, webhookSecret)) {
    console.info('youtrust webhook: url-secret (hérité)');
  } else {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Payload JSON invalide' }, { status: 400 });
  }

  const eventType = event?.event_name || event?.type || event?.event;
  const signatureRequestId = extractSignatureRequestId(event);

  if (!signatureRequestId || (eventType !== 'signature_request.done' && eventType !== 'signature_request.declined')) {
    // Événement non pertinent pour nous (ex: signer.done intermédiaire alors
    // qu'il reste d'autres signataires, ou signature_request.activated) —
    // on accuse quand même réception pour éviter des retentatives inutiles
    // côté Youtrust.
    return NextResponse.json({ received: true, ignored: true });
  }

  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, assigned_user_id, company_id')
    .eq('youtrust_signature_request_id', signatureRequestId)
    .maybeSingle();

  if (!prospect) {
    console.error(`Webhook Youtrust : aucun prospect trouvé pour signature_request_id ${signatureRequestId}`);
    return NextResponse.json({ received: true, matched: false });
  }

  const now = new Date().toISOString();

  if (eventType === 'signature_request.done') {
    // Effet de la signature factorisé dans lib/quote-signature.ts (23/10/2026)
    // pour être partagé avec le devis signé renvoyé par email (check-inbox).
    await markQuoteSigned(prospect as any, 'youtrust');
  } else {
    await supabaseAdmin
      .from('prospects')
      .update({ signature_status: 'refuse', signature_completed_at: now })
      .eq('id', prospect.id);

    await sendPushNotification(prospect.assigned_user_id, {
      title: 'Signature refusée',
      body: `${prospect.full_name} a refusé de signer le devis envoyé.`,
      url: `/app/prospects?user_id=${prospect.assigned_user_id}`,
    });
  }

  return NextResponse.json({ received: true, matched: true });
}
