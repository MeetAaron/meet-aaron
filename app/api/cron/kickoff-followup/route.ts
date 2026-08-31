// app/api/cron/kickoff-followup/route.ts
// Tâche #141 (sous-item 1). Exécuté une fois par jour via Vercel Cron.
// Relance UNE SEULE FOIS (à J+4) les clients à qui Aaron a proposé un
// premier appel de lancement (voir lib/aaron-customer.ts ->
// triggerAutomaticOnboarding) mais qui n'ont pas répondu — ni RDV
// "lancement" créé (voir app/api/cron/check-inbox -> handleWonCustomerMessage),
// ni relance déjà envoyée. Pas d'envoi automatique répété au-delà d'une
// seule relance : mieux vaut que le commercial reprenne la main manuellement
// plutôt qu'Aaron harcèle un client silencieux (même principe que
// app/api/cron/send-prospect-followups, qui plafonne aussi ses relances).
//
// Réutilise le sujet/corps déjà générés et mis en cache sur
// prospects.kickoff_call_subject/_body au moment de la proposition initiale
// (pas de nouvel appel Claude ici — un simple mot de relance suffit).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCustomerAutomationCompanyIds } from '@/lib/subscription';
import { sendEmailForUser } from '@/lib/messaging';

const FOLLOWUP_DELAY_DAYS = 4;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - FOLLOWUP_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Lot API-1 (docx 30/08) : automatismes Clients réservés au compte interne.
  const allowedCompanyIds = await getCustomerAutomationCompanyIds();
  if (allowedCompanyIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'automatismes Clients désactivés' });
  }

  const { data: candidates, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, assigned_user_id, kickoff_call_subject, kickoff_call_body')
    .in('company_id', allowedCompanyIds)
    .not('kickoff_call_proposed_at', 'is', null)
    .is('kickoff_call_followup_sent_at', null)
    .lte('kickoff_call_proposed_at', cutoff)
    // Commercial ayant repris la main sur ce client (voir
    // migration_customer_ai_managed_2026-08-17.sql) : Aaron n'envoie plus
    // rien automatiquement, exactement comme pour le reste d'Aaron Customer.
    .eq('ai_managed', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sent: string[] = [];

  for (const prospect of candidates || []) {
    try {
      if (!prospect.email || !prospect.kickoff_call_subject || !prospect.kickoff_call_body) continue;

      // Un RDV "lancement" déjà proposé/validé signifie que le client a en
      // fait répondu (voir handleWonCustomerMessage) — rien à relancer, on
      // marque juste comme traité pour ne plus le revoir dans ce cron.
      const { data: existing } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('prospect_id', prospect.id)
        .eq('purpose', 'lancement')
        .in('status', ['proposé', 'validé'])
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from('prospects')
          .update({ kickoff_call_followup_sent_at: new Date().toISOString() })
          .eq('id', prospect.id);
        continue;
      }

      const subject = `Relance — ${prospect.kickoff_call_subject}`;
      const body =
        `Bonjour,\n\nJe me permets de revenir vers vous — êtes-vous toujours partant(e) pour un premier échange ? ` +
        `Voici de nouveau les créneaux proposés :\n\n${prospect.kickoff_call_body}`;

      await sendEmailForUser(prospect.assigned_user_id, prospect.email, subject, body);

      const sentAt = new Date().toISOString();
      await supabaseAdmin.from('prospects').update({ kickoff_call_followup_sent_at: sentAt }).eq('id', prospect.id);

      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('prospect_id', prospect.id)
        .eq('channel', 'email')
        .maybeSingle();

      if (conversation) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          sender_email: '',
          recipient_email: prospect.email,
          body,
        });
      }

      sent.push(prospect.id);
    } catch (err: any) {
      // Un échec sur UNE relance ne doit pas empêcher les autres.
      console.error(`Erreur relance RDV de lancement pour prospect ${prospect.id}:`, err.message);
    }
  }

  return NextResponse.json({ sent: sent.length });
}
