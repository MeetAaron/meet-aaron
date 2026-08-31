// app/api/cron/customer-health/route.ts
// Exécuté une fois par jour via Vercel Cron. Recalcule le score de santé de
// chaque client gagné (voir lib/customer-health.ts — calcul déterministe,
// sans appel Claude) et prévient le commercial (push et/ou email selon ses
// préférences) quand un client devient "à risque".
//
// Dédoublonnage via customer_health_alerts : une alerte par client, ré-émise
// seulement si le risque persiste après RE_ALERT_AFTER_DAYS jours. Dès que le
// client repasse au-dessus du seuil de risque, la ligne d'alerte est
// supprimée — donc une future rechute alerte immédiatement, sans attendre le
// délai de ré-alerte.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCustomerAutomationCompanyIds } from '@/lib/subscription';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { computeHealthScore, HEALTH_LABEL_META } from '@/lib/customer-health';

const RE_ALERT_AFTER_DAYS = 14;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Lot API-1 (docx 30/08) : automatismes Clients réservés au compte interne.
  const allowedCompanyIds = await getCustomerAutomationCompanyIds();
  if (allowedCompanyIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'automatismes Clients désactivés' });
  }

  const { data: customers, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, won_at, onboarding_status, assigned_user_id,
       users (id, full_name, email, notify_channel), prospect_companies (name)`
    )
    // Client à part entière seulement (voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .in('company_id', allowedCompanyIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const customerIds = (customers || []).map((c) => c.id);

  let latestCheckinByProspect: Record<string, any> = {};
  if (customerIds.length > 0) {
    const { data: checkins } = await supabaseAdmin
      .from('customer_checkins')
      .select('prospect_id, sent_at, responded_at, response_score')
      .in('prospect_id', customerIds)
      .order('sent_at', { ascending: false });

    for (const checkin of checkins || []) {
      if (!latestCheckinByProspect[checkin.prospect_id]) {
        latestCheckinByProspect[checkin.prospect_id] = checkin;
      }
    }
  }

  // Fréquence des échanges (docx CLIENTS A1) : dernier message + nombre de
  // messages entrants sur 30 jours, par client, via la conversation email.
  let lastMessageByProspect: Record<string, { direction: 'inbound' | 'outbound'; sentAt: string }> = {};
  let inboundCountByProspect: Record<string, number> = {};
  if (customerIds.length > 0) {
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id, prospect_id')
      .in('prospect_id', customerIds)
      .eq('channel', 'email');

    const conversationIdToProspectId: Record<string, string> = {};
    for (const conv of conversations || []) {
      conversationIdToProspectId[conv.id] = conv.prospect_id;
    }
    const conversationIds = Object.keys(conversationIdToProspectId);

    if (conversationIds.length > 0) {
      const { data: messages } = await supabaseAdmin
        .from('messages')
        .select('conversation_id, direction, sent_at')
        .in('conversation_id', conversationIds)
        .order('sent_at', { ascending: false });

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const msg of messages || []) {
        const prospectId = conversationIdToProspectId[msg.conversation_id];
        if (!prospectId) continue;

        if (!lastMessageByProspect[prospectId]) {
          lastMessageByProspect[prospectId] = { direction: msg.direction, sentAt: msg.sent_at };
        }
        if (msg.direction === 'inbound' && msg.sent_at && new Date(msg.sent_at).getTime() >= thirtyDaysAgo) {
          inboundCountByProspect[prospectId] = (inboundCountByProspect[prospectId] || 0) + 1;
        }
      }
    }
  }

  let updated = 0;
  const alerted: string[] = [];

  for (const customer of customers || []) {
    try {
      const lastCheckin = latestCheckinByProspect[customer.id] || null;

      const { score, label } = computeHealthScore({
        wonAt: customer.won_at,
        onboardingStatus: customer.onboarding_status,
        lastCheckin: lastCheckin
          ? { sentAt: lastCheckin.sent_at, respondedAt: lastCheckin.responded_at, responseScore: lastCheckin.response_score }
          : null,
        lastMessage: lastMessageByProspect[customer.id] || null,
        inboundMessageCountLast30Days: inboundCountByProspect[customer.id] || 0,
      });

      await supabaseAdmin
        .from('prospects')
        .update({
          customer_health_score: score,
          customer_health_label: label,
          customer_health_updated_at: new Date().toISOString(),
          churn_risk: label === 'a_risque',
        })
        .eq('id', customer.id);

      updated++;

      const { data: existingAlert } = await supabaseAdmin
        .from('customer_health_alerts')
        .select('id, sent_at')
        .eq('prospect_id', customer.id)
        .maybeSingle();

      if (label !== 'a_risque') {
        // Le client n'est plus à risque : on efface l'alerte pour qu'une
        // future rechute reparte à zéro (alerte immédiate).
        if (existingAlert) {
          await supabaseAdmin.from('customer_health_alerts').delete().eq('id', existingAlert.id);
        }
        continue;
      }

      const daysSinceLastAlert = existingAlert
        ? Math.floor((Date.now() - new Date(existingAlert.sent_at).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      if (existingAlert && (daysSinceLastAlert === null || daysSinceLastAlert < RE_ALERT_AFTER_DAYS)) {
        continue; // déjà alerté récemment pour ce client, on ne spamme pas
      }

      const user = (customer as any).users;
      if (!user) continue;

      const companyName = (customer as any).prospect_companies?.name;
      const title = `Client à risque : ${customer.full_name}`;
      const body = `${customer.full_name}${companyName ? ` (${companyName})` : ''} — ${HEALTH_LABEL_META[label].label.toLowerCase()} (score ${score}/100).`;
      const url = `/app/customer?user_id=${customer.assigned_user_id}`;

      const channel = user.notify_channel || 'email';

      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(
          user.id,
          user.email,
          title,
          `${body}\n\nVoir le suivi client Aaron Client : ${process.env.APP_URL || ''}${url}`
        );
      }
      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, { title, body, url });
      }

      if (existingAlert) {
        await supabaseAdmin.from('customer_health_alerts').update({ sent_at: new Date().toISOString() }).eq('id', existingAlert.id);
      } else {
        await supabaseAdmin.from('customer_health_alerts').insert({ prospect_id: customer.id });
      }

      alerted.push(customer.id);
    } catch (err: any) {
      // Un échec sur UN client ne doit pas bloquer le recalcul des autres.
      console.error(`Erreur calcul santé client ${customer.id}:`, err.message);
    }
  }

  return NextResponse.json({ updated, alerted: alerted.length });
}
