// app/api/cron/customer-checkins/route.ts
// Exécuté une fois par jour via Vercel Cron. Envoie un email de check-in
// satisfaction/NPS aux clients gagnés (is_won = true), selon une cadence
// simple et déterministe :
//  - premier check-in ~3 semaines après la signature (le temps que
//    l'onboarding démarre réellement) ;
//  - puis un nouveau check-in tous les ~60 jours, qu'il y ait eu une réponse
//    au précédent ou non (on ne veut pas relancer indéfiniment un client
//    silencieux, mais on veut quand même reprendre le pouls régulièrement).
// La réponse du client est captée plus tard par app/api/cron/check-inbox
// (voir handleWonCustomerMessage) et parsée par lib/aaron-customer.ts.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { generateCheckinMessage } from '@/lib/aaron-customer';

const FIRST_CHECKIN_AFTER_DAYS = 21;
const CHECKIN_INTERVAL_DAYS = 60;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = Date.now();
  const firstCheckinBefore = new Date(now - FIRST_CHECKIN_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nextCheckinBefore = new Date(now - CHECKIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Deux requêtes séparées plutôt qu'un OR complexe côté PostgREST : plus
  // simple à lire et à faire évoluer si la cadence change un jour.
  const { data: firstTimeCustomers, error: error1 } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, assigned_user_id, last_checkin_sent_at')
    .eq('is_won', true)
    .is('last_checkin_sent_at', null)
    .lt('won_at', firstCheckinBefore);

  const { data: dueForNextCheckin, error: error2 } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, assigned_user_id, last_checkin_sent_at')
    .eq('is_won', true)
    .not('last_checkin_sent_at', 'is', null)
    .lt('last_checkin_sent_at', nextCheckinBefore);

  if (error1 || error2) {
    return NextResponse.json({ error: (error1 || error2)?.message }, { status: 500 });
  }

  const due = [...(firstTimeCustomers || []), ...(dueForNextCheckin || [])];
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

      await supabaseAdmin.from('prospects').update({ last_checkin_sent_at: sentAt }).eq('id', customer.id);

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
