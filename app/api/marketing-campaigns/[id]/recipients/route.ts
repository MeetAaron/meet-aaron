// app/api/marketing-campaigns/[id]/recipients/route.ts
// POST -> fige la liste des destinataires (recalcule l'audience actuelle et
// crée les lignes marketing_campaign_recipients manquantes), fait passer la
// campagne en statut "prete". Étape obligatoire avant /send : on ne veut
// jamais que la liste de destinataires bouge PENDANT un envoi (un client qui
// se désabonne au milieu, ou un nouveau client gagné entre-temps, ne doit pas
// changer ce qui a déjà été décidé).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { resolveAudience } from '@/lib/marketing-audience';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: campaign } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', params.id).single();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  if (!['brouillon', 'prete'].includes(campaign.status)) {
    return NextResponse.json({ error: "Cette campagne a déjà été envoyée ou est en cours d'envoi" }, { status: 400 });
  }
  if (!campaign.subject || !campaign.body_text) {
    return NextResponse.json({ error: 'Rédige un sujet et un contenu avant de préparer les destinataires' }, { status: 400 });
  }

  let prospects;
  try {
    prospects = await resolveAudience(campaign);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }

  if (prospects.length === 0) {
    return NextResponse.json({ error: 'Aucun client ne correspond au filtre actuel de cette campagne' }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('prospect_id')
    .eq('campaign_id', campaign.id);
  const existingIds = new Set((existing || []).map((r) => r.prospect_id));

  const toInsert = prospects
    .filter((p) => !existingIds.has(p.id))
    .map((p) => ({ campaign_id: campaign.id, prospect_id: p.id, email: p.email }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('marketing_campaign_recipients').insert(toInsert);
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .update({ status: 'prete', updated_at: new Date().toISOString() })
    .eq('id', campaign.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campaign: updated, recipient_count: prospects.length, added: toInsert.length });
}
