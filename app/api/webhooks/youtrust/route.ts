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
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';
import { triggerAutomaticOnboarding } from '@/lib/aaron-customer';

function extractSignatureRequestId(event: any): string | null {
  return (
    event?.data?.id ||
    event?.data?.signature_request?.id ||
    event?.data?.signature_request_id ||
    event?.signature_request_id ||
    null
  );
}

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!process.env.YOUTRUST_WEBHOOK_SECRET || secret !== process.env.YOUTRUST_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let event: any;
  try {
    event = await request.json();
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
    .select('id, full_name, assigned_user_id')
    .eq('youtrust_signature_request_id', signatureRequestId)
    .maybeSingle();

  if (!prospect) {
    console.error(`Webhook Youtrust : aucun prospect trouvé pour signature_request_id ${signatureRequestId}`);
    return NextResponse.json({ received: true, matched: false });
  }

  const now = new Date().toISOString();

  if (eventType === 'signature_request.done') {
    await supabaseAdmin
      .from('prospects')
      .update({
        signature_status: 'signe',
        signature_completed_at: now,
        deal_stage: 'signe',
        deal_stage_updated_at: now,
        is_won: true,
        won_at: now,
        is_lost: false,
        first_order_confirmed_at: now,
        won_reason: 'Devis signé électroniquement via Youtrust.',
      })
      .eq('id', prospect.id);

    await sendPushNotification(prospect.assigned_user_id, {
      title: 'Contrat signé 🎉',
      body: `${prospect.full_name} a signé le devis. Aaron l'a basculé en client gagné.`,
      url: `/app/customer?user_id=${prospect.assigned_user_id}`,
    });

    // Docx "CLIENTS A1(a)" : onboarding automatique dès la signature — voir
    // lib/aaron-customer.ts. Fire-and-forget, best-effort.
    triggerAutomaticOnboarding(prospect.id).catch(() => {});
  } else {
    await supabaseAdmin
      .from('prospects')
      .update({ signature_status: 'refuse', signature_completed_at: now })
      .eq('id', prospect.id);

    await sendPushNotification(prospect.assigned_user_id, {
      title: 'Signature refusée',
      body: `${prospect.full_name} a refusé de signer le devis envoyé.`,
      url: `/app/sales?user_id=${prospect.assigned_user_id}`,
    });
  }

  return NextResponse.json({ received: true, matched: true });
}
