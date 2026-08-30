// app/api/cron/send-pending-replies/route.ts
// Exécuté périodiquement (voir vercel.json). Envoie les réponses d'Aaron mises
// en attente par app/api/cron/check-inbox parce que jugées "longues" (voir
// lib/messaging.ts::computeHumanReplyDelayMs — demande Alex, 30/08/2026 :
// répondre en 5 minutes à un email travaillé ne fait pas crédible).
//
// Ne fait QUE l'envoi + son archivage : toute la logique métier (mise à jour
// du statut du prospect, notifications, détection RDV/devis/négociation...) a
// déjà été appliquée immédiatement par check-inbox au moment de la réception
// — seul l'email au prospect lui-même a été différé, pour que le commercial
// garde une vue à jour dans le CRM sans attendre.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: pending } = await supabaseAdmin
    .from('pending_aaron_replies')
    .select('id, conversation_id, prospect_id, user_id, to_email, subject, body')
    .is('sent_at', null)
    .is('cancelled_at', null)
    .lte('send_after', new Date().toISOString())
    .order('send_after', { ascending: true })
    .limit(50);

  const results = [];

  for (const reply of pending || []) {
    try {
      // Revérification au moment de l'envoi (pas seulement à la mise en
      // attente, potentiellement plus d'une heure plus tôt) : le commercial a
      // pu reprendre la main sur ce prospect ("Aaron n'en charge plus") ou le
      // marquer perdu entre-temps — dans ce cas on annule proprement plutôt
      // que d'envoyer un email qu'on ne veut plus.
      const { data: prospect } = await supabaseAdmin
        .from('prospects')
        .select('id, ai_managed, is_lost')
        .eq('id', reply.prospect_id)
        .maybeSingle();

      if (!prospect || prospect.ai_managed === false || prospect.is_lost) {
        await supabaseAdmin
          .from('pending_aaron_replies')
          .update({ cancelled_at: new Date().toISOString() })
          .eq('id', reply.id);
        results.push({ id: reply.id, cancelled: true });
        continue;
      }

      await sendEmailForUser(reply.user_id, reply.to_email, reply.subject, reply.body);

      // Google prioritaire si les deux sont connectés, même règle que
      // sendEmailForUser (lib/messaging.ts) — juste pour renseigner
      // sender_email correctement dans l'historique, l'envoi lui-même a déjà
      // choisi le bon fournisseur dans sendEmailForUser ci-dessus.
      const { data: connections } = await supabaseAdmin
        .from('oauth_connections')
        .select('provider, provider_account_email')
        .eq('user_id', reply.user_id)
        .in('provider', ['google', 'microsoft']);
      const connection =
        (connections || []).find((c) => c.provider === 'google') ||
        (connections || []).find((c) => c.provider === 'microsoft');

      await supabaseAdmin.from('messages').insert({
        conversation_id: reply.conversation_id,
        direction: 'outbound',
        sender_email: connection?.provider_account_email || '',
        recipient_email: reply.to_email,
        body: reply.body,
      });

      await supabaseAdmin
        .from('pending_aaron_replies')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', reply.id);

      results.push({ id: reply.id, sent: true });
    } catch (err: any) {
      // Un échec sur UNE réponse en attente (ex: token révoqué entre-temps)
      // ne doit pas bloquer les autres — elle sera retentée au prochain
      // passage (sent_at reste null).
      console.error(`Erreur envoi réponse Aaron différée ${reply.id}:`, err.message);
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
