// app/api/support-drafts/route.ts
// GET -> liste les suggestions de réponse support en attente (ni envoyées ni
//        écartées) pour les clients du commercial connecté, les plus
//        récentes en premier. Voir lib/aaron-customer.ts (generateSupportReply),
//        app/api/cron/check-inbox (handleWonCustomerMessage) et
//        app/app/customer/page.jsx.

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

  // Deux requêtes séparées plutôt qu'un filtre imbriqué sur la jointure :
  // même convention que app/api/sales/pipeline et app/api/customers/pipeline
  // (PostgREST ne fait pas de LIMIT/filtre par groupe facilement).
  const { data: myProspects } = await supabaseAdmin.from('prospects').select('id, full_name').eq('assigned_user_id', userId);

  const prospectIds = (myProspects || []).map((p) => p.id);
  if (prospectIds.length === 0) {
    return NextResponse.json({ drafts: [] });
  }

  const namesByProspect: Record<string, string> = {};
  for (const p of myProspects || []) namesByProspect[p.id] = p.full_name;

  const { data: drafts, error } = await supabaseAdmin
    .from('customer_support_drafts')
    .select('id, prospect_id, inbound_excerpt, suggested_subject, suggested_body, created_at')
    .in('prospect_id', prospectIds)
    .is('sent_at', null)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (drafts || []).map((d) => ({ ...d, prospect_full_name: namesByProspect[d.prospect_id] || null }));

  return NextResponse.json({ drafts: enriched });
}
