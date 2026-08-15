// app/api/campaigns/[id]/route.ts
// PATCH -> actions sur une campagne de prospection (CHANGEMENTS A FAIRE #16 :
// donner au commercial un vrai moyen de mettre en pause ou de terminer une
// campagne manuellement, plutôt que de ne dépendre que de l'objectif de
// contacts atteint automatiquement — voir lib/sourcing.ts) :
//   - "pause"     -> suspend la recherche (statut "en_pause", déjà prévu côté
//                    UI mais jamais réellement déclenchable jusqu'ici)
//   - "reprendre" -> relance la recherche (repasse en "en_cours")
//   - "terminer"  -> arrête définitivement la recherche pour cette campagne
//                    avant que l'objectif de contacts soit atteint (statut
//                    "terminee" + ended_manually_at renseigné, pour la
//                    distinguer d'une fin "normale" par objectif atteint —
//                    voir migration_campaigns_advice_2026-08-16.sql). Les
//                    prospects déjà trouvés restent inchangés dans le pipeline.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action } = await request.json();
  const campaignId = params.id;

  const { data: campaign, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('id, assigned_user_id, status')
    .eq('id', campaignId)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.assigned_user_id) return forbiddenResponse();

  if (campaign.status === 'terminee') {
    return NextResponse.json({ error: 'Cette campagne est déjà terminée' }, { status: 400 });
  }

  if (action === 'pause') {
    await supabaseAdmin.from('prospecting_campaigns').update({ status: 'en_pause' }).eq('id', campaignId);
    return NextResponse.json({ success: true, status: 'en_pause' });
  }

  if (action === 'reprendre') {
    await supabaseAdmin.from('prospecting_campaigns').update({ status: 'en_cours' }).eq('id', campaignId);
    return NextResponse.json({ success: true, status: 'en_cours' });
  }

  if (action === 'terminer') {
    await supabaseAdmin
      .from('prospecting_campaigns')
      .update({ status: 'terminee', ended_manually_at: new Date().toISOString() })
      .eq('id', campaignId);
    return NextResponse.json({ success: true, status: 'terminee' });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
