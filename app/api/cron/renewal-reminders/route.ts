// app/api/cron/renewal-reminders/route.ts
// Exécuté une fois par jour via Vercel Cron. Pour chaque client gagné avec
// une date de renouvellement de contrat renseignée (prospects.contract_renewal_date,
// saisie manuellement par le commercial — voir app/api/prospects/[id] action
// "set_renewal_date") qui approche à moins de RENEWAL_WINDOW_DAYS jours :
// génère un email de relance de renouvellement (lib/aaron-customer.ts ->
// generateRenewalOutreach) et prévient le commercial, sans jamais envoyer
// automatiquement au client (validation requise dans Aaron Client).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCustomerAutomationCompanyIds } from '@/lib/subscription';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { generateRenewalOutreach } from '@/lib/aaron-customer';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

const RENEWAL_WINDOW_DAYS = 30;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const windowEnd = new Date(Date.now() + RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Lot API-1 (docx 30/08) : automatismes Clients réservés au compte interne.
  const allowedCompanyIds = await getCustomerAutomationCompanyIds();
  if (allowedCompanyIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'automatismes Clients désactivés' });
  }

  const { data: dueForRenewal, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, contract_renewal_date, assigned_user_id, users(id, full_name, email, notify_channel), prospect_companies(name)')
    .in('company_id', allowedCompanyIds)
    // Client à part entière seulement (voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .not('contract_renewal_date', 'is', null)
    .is('renewal_reminder_sent_at', null)
    .lte('contract_renewal_date', windowEnd);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const alerted: string[] = [];

  for (const customer of dueForRenewal || []) {
    try {
      let outreach;
      try {
        outreach = await generateRenewalOutreach(customer.id);
      } catch (err: any) {
        if (err instanceof MonthlyCapExceededError) {
          console.error(`Plafond API atteint — email de renouvellement non généré pour ${customer.id}, alerte envoyée quand même.`);
          outreach = null;
        } else {
          throw err;
        }
      }

      if (outreach) {
        await supabaseAdmin
          .from('prospects')
          .update({ renewal_email_subject: outreach.subject, renewal_email_body: outreach.body })
          .eq('id', customer.id);
      }

      await supabaseAdmin.from('prospects').update({ renewal_reminder_sent_at: new Date().toISOString() }).eq('id', customer.id);

      const user = (customer as any).users;
      if (!user) continue;

      const companyName = (customer as any).prospect_companies?.name;
      const renewalDate = new Date(customer.contract_renewal_date).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
      const title = `Renouvellement à préparer : ${customer.full_name}`;
      const body = `${customer.full_name}${companyName ? ` (${companyName})` : ''} — contrat renouvelable le ${renewalDate}. Un email de relance est prêt à valider.`;
      const url = `/app/customer?user_id=${customer.assigned_user_id}`;
      const channel = user.notify_channel || 'email';

      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(user.id, user.email, title, `${body}\n\nVoir le suivi client Aaron Client : ${process.env.APP_URL || ''}${url}`);
      }
      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, { title, body, url });
      }

      alerted.push(customer.id);
    } catch (err: any) {
      console.error(`Erreur alerte renouvellement pour client ${customer.id}:`, err.message);
    }
  }

  return NextResponse.json({ alerted: alerted.length });
}
