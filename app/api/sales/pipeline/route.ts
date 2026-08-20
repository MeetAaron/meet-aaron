// app/api/sales/pipeline/route.ts
// GET -> liste les "affaires" (prospects ayant dépassé le premier RDV, donc
//        deal_stage renseigné) du commercial connecté, avec le RDV le plus
//        récent associé, pour app/app/sales/page.jsx (tableau de pipeline
//        Aaron Sales : RDV fait -> devis envoyé -> en négociation -> signé/perdu).

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

  const { data: deals, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, job_title, email, deal_stage, deal_stage_updated_at, is_won, won_at, is_lost, lost_at,
       devis_generated_at, devis_sent_at, signature_external_link, signature_requested_at, signature_status,
       prospect_companies(name, domain)`
    )
    .eq('assigned_user_id', userId)
    .not('deal_stage', 'is', null)
    .order('deal_stage_updated_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dealIds = (deals || []).map((d) => d.id);

  let appointmentsByProspect: Record<string, any> = {};
  if (dealIds.length > 0) {
    const { data: appointments } = await supabaseAdmin
      .from('appointments')
      .select('id, prospect_id, proposed_at, type, outcome, debrief_summary, debrief_email_subject, debrief_email_body, debrief_email_sent_at')
      .in('prospect_id', dealIds)
      .order('proposed_at', { ascending: false });

    // Le RDV le plus récent par prospect — appointments est déjà trié par
    // date décroissante, donc la première occurrence rencontrée par prospect
    // suffit (pas besoin de comparer les dates nous-mêmes).
    for (const appt of appointments || []) {
      if (!appointmentsByProspect[appt.prospect_id]) {
        appointmentsByProspect[appt.prospect_id] = appt;
      }
    }
  }

  const pipeline = (deals || []).map((deal) => ({
    ...deal,
    latest_appointment: appointmentsByProspect[deal.id] || null,
  }));

  return NextResponse.json({ deals: pipeline });
}
