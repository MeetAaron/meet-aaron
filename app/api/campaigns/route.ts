// app/api/campaigns/route.ts
// POST -> le commercial crée une nouvelle campagne de prospection (zone + secteur)
// GET  -> liste les campagnes du commercial, avec leur avancement

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

  const { data: campaigns, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('*')
    .eq('assigned_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Petit récapitulatif par campagne (gagnés / perdus / en cours) — permet au
  // commercial de voir en un coup d'œil comment chaque campagne performe
  // quand plusieurs tournent en même temps, sans avoir à aller dans Prospects.
  const campaignIds = (campaigns || []).map((c) => c.id);
  const statsByCampaign: Record<string, { won: number; lost: number; active: number }> = {};

  if (campaignIds.length > 0) {
    const { data: companies } = await supabaseAdmin
      .from('prospect_companies')
      .select('id, found_by_campaign_id')
      .in('found_by_campaign_id', campaignIds);

    const campaignIdByCompanyId: Record<string, string> = {};
    (companies || []).forEach((c) => {
      if (c.found_by_campaign_id) campaignIdByCompanyId[c.id] = c.found_by_campaign_id;
    });
    const companyIds = Object.keys(campaignIdByCompanyId);

    if (companyIds.length > 0) {
      const { data: prospects } = await supabaseAdmin
        .from('prospects')
        .select('prospect_company_id, is_won, is_lost')
        .in('prospect_company_id', companyIds);

      (prospects || []).forEach((p) => {
        const campaignId = campaignIdByCompanyId[p.prospect_company_id];
        if (!campaignId) return;
        if (!statsByCampaign[campaignId]) statsByCampaign[campaignId] = { won: 0, lost: 0, active: 0 };
        if (p.is_won) statsByCampaign[campaignId].won++;
        else if (p.is_lost) statsByCampaign[campaignId].lost++;
        else statsByCampaign[campaignId].active++;
      });
    }
  }

  const campaignsWithStats = (campaigns || []).map((c) => ({
    ...c,
    stats: statsByCampaign[c.id] || { won: 0, lost: 0, active: 0 },
  }));

  return NextResponse.json({ campaigns: campaignsWithStats });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    company_id,
    assigned_user_id,
    zone_label,
    zone_type,
    zone_codes,
    sector_keywords,
    company_sizes,
    target_count,
    context_notes,
    target_role,
  } = body;

  if (!company_id || !assigned_user_id || !zone_label || !zone_type || !zone_codes || !sector_keywords) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== assigned_user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  const { data: campaign, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .insert({
      company_id,
      assigned_user_id,
      zone_label,
      zone_type,
      zone_codes,
      sector_keywords,
      company_sizes: Array.isArray(company_sizes) ? company_sizes : [],
      target_count: target_count || 20,
      context_notes: context_notes || null,
      target_role: target_role || null,
      status: 'en_attente',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign });
}
