// app/api/marketing-campaigns/route.ts
// GET  -> liste les campagnes marketing (module Aaron Clients) de la société
//         du commercial, avec un petit récapitulatif de suivi par campagne.
// POST -> crée une campagne en brouillon (nom uniquement au départ — le
//         reste, y compris l'audience, se construit ensuite étape par étape).
//
// Module Aaron Marketing (docx AJOUT GLOBAL, message du 21/08/2026) — voir
// migration_marketing_campaigns_2026-08-21.sql pour le schéma complet.

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
  if (!authedUser.company_id) return NextResponse.json({ campaigns: [] });

  const { data: campaigns, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('*')
    .eq('company_id', authedUser.company_id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaignIds = (campaigns || []).map((c) => c.id);
  const statsByCampaign: Record<string, { total: number; envoyes: number; echecs: number; clics: number; desabonnes: number }> = {};

  if (campaignIds.length > 0) {
    const { data: recipients } = await supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('campaign_id, status, click_count')
      .in('campaign_id', campaignIds);

    (recipients || []).forEach((r) => {
      if (!statsByCampaign[r.campaign_id]) {
        statsByCampaign[r.campaign_id] = { total: 0, envoyes: 0, echecs: 0, clics: 0, desabonnes: 0 };
      }
      const s = statsByCampaign[r.campaign_id];
      s.total++;
      if (r.status === 'envoye') s.envoyes++;
      if (r.status === 'echec') s.echecs++;
      if (r.status === 'desabonne') s.desabonnes++;
      if (r.click_count > 0) s.clics++;
    });
  }

  const campaignsWithStats = (campaigns || []).map((c) => ({
    ...c,
    stats: statsByCampaign[c.id] || { total: 0, envoyes: 0, echecs: 0, clics: 0, desabonnes: 0 },
  }));

  return NextResponse.json({ campaigns: campaignsWithStats });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, name } = body;

  if (!user_id || !name) {
    return NextResponse.json({ error: 'Champs requis manquants (nom de la campagne)' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();
  if (!authedUser.company_id) return NextResponse.json({ error: 'Aucune société associée' }, { status: 400 });

  const { data: campaign, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .insert({
      company_id: authedUser.company_id,
      created_by_user_id: user_id,
      name,
      status: 'brouillon',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign });
}
