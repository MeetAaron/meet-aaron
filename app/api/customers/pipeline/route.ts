// app/api/customers/pipeline/route.ts
// GET -> liste les clients gagnés (is_won = true) du commercial connecté,
//        avec leur statut d'onboarding, leur score de santé et leur dernier
//        check-in, pour app/app/customer/page.jsx (tableau de bord Aaron
//        Customer). Mêmes conventions que app/api/sales/pipeline pour Aaron
//        Sales.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: customers, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, job_title, email, created_at, won_at, won_reason, is_lost, lost_at, ai_managed,
       onboarding_status, onboarding_plan, onboarding_generated_at,
       welcome_email_subject, welcome_email_body, welcome_email_sent_at,
       customer_health_score, customer_health_label, customer_health_updated_at, churn_risk,
       last_checkin_sent_at, last_checkin_response_at,
       contract_renewal_date, renewal_reminder_sent_at,
       renewal_email_subject, renewal_email_body, renewal_email_sent_at,
       upsell_suggestion, upsell_suggested_at, upsell_dismissed_at,
       testimonial_email_subject, testimonial_email_body, testimonial_email_sent_at,
       devis_recap,
       prospect_companies (name, domain, address, siret, website, industry, company_size, estimated_revenue)`
    )
    .eq('assigned_user_id', userId)
    // Aaron Customer ne traite que les clients à part entière — 1ère commande
    // confirmée, pas juste "gagné" (voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .order('won_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const customerIds = (customers || []).map((c) => c.id);

  let latestCheckinByProspect: Record<string, any> = {};
  if (customerIds.length > 0) {
    const { data: checkins } = await supabaseAdmin
      .from('customer_checkins')
      .select('id, prospect_id, type, sent_at, responded_at, response_score, response_comment')
      .in('prospect_id', customerIds)
      .order('sent_at', { ascending: false });

    for (const checkin of checkins || []) {
      if (!latestCheckinByProspect[checkin.prospect_id]) {
        latestCheckinByProspect[checkin.prospect_id] = checkin;
      }
    }
  }

  const pipeline = (customers || []).map((customer) => ({
    ...customer,
    latest_checkin: latestCheckinByProspect[customer.id] || null,
  }));

  return NextResponse.json({ customers: pipeline });
}
