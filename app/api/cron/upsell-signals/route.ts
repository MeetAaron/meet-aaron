// app/api/cron/upsell-signals/route.ts
// Exécuté une fois par jour via Vercel Cron. Détecte les clients en très
// bonne santé (customer_health_score élevé) et suffisamment anciens
// (won_at) pour être de bons candidats à une offre complémentaire, génère
// une suggestion d'upsell (lib/aaron-customer.ts -> generateUpsellSuggestion)
// et prévient le commercial. Ne suggère jamais rien automatiquement au
// client — juste une piste pour le commercial, à explorer ou écarter
// (voir app/api/prospects/[id] action "dismiss_upsell").

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCustomerAutomationCompanyIds } from '@/lib/subscription';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { generateUpsellSuggestion } from '@/lib/aaron-customer';

const MIN_HEALTH_SCORE = 80;
const MIN_TENURE_DAYS = 60;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const tenureCutoff = new Date(Date.now() - MIN_TENURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Lot API-1 (docx 30/08) : automatismes Clients réservés au compte interne.
  const allowedCompanyIds = await getCustomerAutomationCompanyIds();
  if (allowedCompanyIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'automatismes Clients désactivés' });
  }

  const { data: candidates, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, assigned_user_id, won_at, customer_health_score, users(id, full_name, email, notify_channel), prospect_companies(name)')
    .in('company_id', allowedCompanyIds)
    // Client à part entière seulement — pas un prospect juste "gagné" en
    // attente de 1ère commande (voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .gte('customer_health_score', MIN_HEALTH_SCORE)
    .lte('won_at', tenureCutoff)
    .is('upsell_suggested_at', null)
    .is('upsell_dismissed_at', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const suggested: string[] = [];

  for (const customer of candidates || []) {
    try {
      const suggestion = await generateUpsellSuggestion(customer.id);

      // Pas de suggestion générique : si Claude n'a rien renvoyé de solide,
      // on ne notifie pas le commercial avec une alerte vide — on réessaiera
      // au prochain passage du cron tant qu'upsell_suggested_at reste null.
      if (!suggestion) continue;

      const now = new Date().toISOString();
      await supabaseAdmin
        .from('prospects')
        .update({ upsell_suggestion: suggestion, upsell_suggested_at: now })
        .eq('id', customer.id);

      const user = (customer as any).users;
      if (!user) continue;

      const companyName = (customer as any).prospect_companies?.name;
      const title = `Piste d'upsell : ${customer.full_name}`;
      const body = `${customer.full_name}${companyName ? ` (${companyName})` : ''} — client en excellente santé. ${suggestion}`;
      const url = `/app/customer?user_id=${customer.assigned_user_id}`;
      const channel = user.notify_channel || 'email';

      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(user.id, user.email, title, `${body}\n\nVoir le suivi client Aaron Client : ${process.env.APP_URL || ''}${url}`);
      }
      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, { title, body, url });
      }

      suggested.push(customer.id);
    } catch (err: any) {
      console.error(`Erreur suggestion upsell pour client ${customer.id}:`, err.message);
    }
  }

  return NextResponse.json({ suggested: suggested.length });
}
