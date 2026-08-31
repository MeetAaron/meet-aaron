// app/api/cron/customer-checkins/route.ts
// Exécuté une fois par jour via Vercel Cron. Envoie un email de check-in
// satisfaction/NPS aux clients gagnés (is_won = true), selon la cadence
// demandée dans le docx (CLIENTS A1, "check-ins de satisfaction") :
//  - 1er check-in à J+30 après la signature ;
//  - 2e check-in à J+90 ;
//  - 3e check-in à J+180 ;
//  - au-delà, on continue tous les 180 jours (le docx ne précise pas la
//    suite — on ne veut pas arrêter de prendre le pouls d'un client de
//    longue date, donc on garde la dernière cadence plutôt que de s'arrêter).
// `prospects.checkin_count` (voir migration_checkin_cadence_2026-08-20.sql)
// retient le nombre de check-ins déjà envoyés pour savoir quel palier
// appliquer ensuite. La réponse du client est captée plus tard par
// app/api/cron/check-inbox (voir handleWonCustomerMessage) et parsée par
// lib/aaron-customer.ts.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCustomerAutomationCompanyIds } from '@/lib/subscription';
import { sendEmailForUser } from '@/lib/messaging';
import { generateCheckinMessage } from '@/lib/aaron-customer';

// Paliers en jours après la signature (won_at) pour les 3 premiers
// check-ins ; au-delà, CHECKIN_INTERVAL_AFTER_MILESTONES_DAYS s'applique en
// continu depuis le dernier check-in envoyé.
const CHECKIN_MILESTONES_DAYS = [30, 90, 180];
const CHECKIN_INTERVAL_AFTER_MILESTONES_DAYS = 180;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function isDue(customer: { won_at: string; last_checkin_sent_at: string | null; checkin_count: number }, now: number): boolean {
  const count = customer.checkin_count || 0;
  const daysThreshold =
    count < CHECKIN_MILESTONES_DAYS.length ? CHECKIN_MILESTONES_DAYS[count] : CHECKIN_INTERVAL_AFTER_MILESTONES_DAYS;
  // Les 3 premiers paliers comptent depuis la signature ; au-delà, depuis le
  // dernier check-in envoyé (sinon les paliers 30/90/180 sont tous mesurés
  // depuis won_at, ce qui reste correct puisqu'ils sont cumulatifs).
  const baseline = count < CHECKIN_MILESTONES_DAYS.length ? customer.won_at : customer.last_checkin_sent_at;
  if (!baseline) return false;
  const dueAt = new Date(baseline).getTime() + daysThreshold * 24 * 60 * 60 * 1000;
  return now >= dueAt;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = Date.now();

  // Lot API-1 (docx 30/08) : automatismes Clients réservés au compte interne.
  const allowedCompanyIds = await getCustomerAutomationCompanyIds();
  if (allowedCompanyIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'automatismes Clients désactivés' });
  }

  const { data: customers, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, assigned_user_id, won_at, last_checkin_sent_at, checkin_count')
    // Client à part entière seulement (voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .in('company_id', allowedCompanyIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = (customers || []).filter((c) => isDue(c as any, now));
  const sent: string[] = [];

  for (const customer of due) {
    try {
      // Alterne le type pour varier un peu la sollicitation : NPS pour le
      // tout premier check-in (mesure la confiance initiale), satisfaction
      // pour les suivants.
      const type = customer.last_checkin_sent_at ? 'satisfaction' : 'nps';
      const message = await generateCheckinMessage(customer.id, type);

      await sendEmailForUser(customer.assigned_user_id, customer.email, message.subject, message.body);

      const sentAt = new Date().toISOString();

      await supabaseAdmin.from('customer_checkins').insert({
        prospect_id: customer.id,
        type,
        question_subject: message.subject,
        question_body: message.body,
        sent_at: sentAt,
      });

      await supabaseAdmin
        .from('prospects')
        .update({ last_checkin_sent_at: sentAt, checkin_count: (customer.checkin_count || 0) + 1 })
        .eq('id', customer.id);

      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('prospect_id', customer.id)
        .eq('channel', 'email')
        .maybeSingle();

      if (conversation) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          sender_email: '',
          recipient_email: customer.email,
          body: message.body,
        });
      }

      sent.push(customer.id);
    } catch (err: any) {
      // Un échec d'envoi pour UN client (ex: boîte mail déconnectée) ne doit
      // pas empêcher les check-ins des autres clients de ce cycle.
      console.error(`Erreur envoi check-in pour client ${customer.id}:`, err.message);
    }
  }

  return NextResponse.json({ sent: sent.length });
}
