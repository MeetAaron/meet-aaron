// app/api/marketing-campaigns/[id]/route.ts
// GET    -> détail d'une campagne marketing + ses destinataires
// PATCH  -> modifie une campagne (nom, sujet, corps, filtre d'audience,
//           statut manuel pause/reprise) — toujours vérifié possible côté
//           statut (ex: on ne modifie plus le contenu une fois l'envoi lancé)
// DELETE -> supprime une campagne encore en brouillon uniquement

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

async function loadCampaign(id: string) {
  const { data } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', id).single();
  return data;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await loadCampaign(params.id);
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  const { data: recipients } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id, prospect_id, email, status, sent_at, error_message, clicked_at, click_count, unsubscribed_at')
    .eq('campaign_id', campaign.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ campaign, recipients: recipients || [] });
}

const EDITABLE_FIELDS = ['name', 'subject', 'body_text', 'audience_health_filter', 'audience_min_days_since_won'];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await loadCampaign(params.id);
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  const body = await request.json();

  // Pause / reprise manuelle, indépendant de l'édition de contenu.
  if (body.action === 'pause' || body.action === 'reprendre') {
    if (!['en_cours', 'en_pause'].includes(campaign.status)) {
      return NextResponse.json({ error: 'Cette campagne ne peut pas être mise en pause/reprise dans son état actuel' }, { status: 400 });
    }
    const newStatus = body.action === 'pause' ? 'en_pause' : 'en_cours';
    const { data: updated, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaign: updated });
  }

  // Édition de contenu : verrouillée une fois l'envoi commencé, pour ne
  // jamais changer le message sous les pieds d'un envoi en cours.
  if (!['brouillon', 'prete'].includes(campaign.status)) {
    return NextResponse.json({ error: 'Cette campagne ne peut plus être modifiée (envoi déjà commencé)' }, { status: 400 });
  }

  const update: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à modifier' }, { status: 400 });
  }

  // Toute modification du contenu ou de l'audience après avoir figé les
  // destinataires (statut "prete") ramène en "brouillon" — la liste de
  // destinataires déjà figée n'est plus fiable et doit être refaite via
  // /recipients avant un nouvel envoi.
  update.status = 'brouillon';
  update.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .update(update)
    .eq('id', campaign.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await loadCampaign(params.id);
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  if (campaign.status !== 'brouillon') {
    return NextResponse.json({ error: 'Seule une campagne encore en brouillon peut être supprimée' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('marketing_campaigns').delete().eq('id', campaign.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
