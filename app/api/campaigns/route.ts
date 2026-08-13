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

  return NextResponse.json({ campaigns });
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
      status: 'en_attente',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign });
}
