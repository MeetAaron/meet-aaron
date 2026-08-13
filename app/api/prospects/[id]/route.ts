// app/api/prospects/[id]/route.ts
// GET   -> détail complet d'un prospect (fiche + historique des échanges)
// PATCH -> approuver ou rejeter une tentative de sauvetage proposée par Aaron
//          ("approuver_sauvetage" envoie l'email, "rejeter_sauvetage" abandonne sans envoyer)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain)')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', params.id)
    .eq('channel', 'email')
    .single();

  let messages: any[] = [];
  if (conversation) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, body, sent_at')
      .eq('conversation_id', conversation.id)
      .order('sent_at', { ascending: true });
    messages = msgs || [];
  }

  return NextResponse.json({ prospect, messages });
}

const VALID_DEAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation', 'signe', 'perdu'];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action, deal_stage } = await request.json();
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  if (action === 'approuver_sauvetage') {
    if (!prospect.rescue_proposal_subject || !prospect.rescue_proposal_body) {
      return NextResponse.json({ error: 'Aucune tentative de sauvetage en attente' }, { status: 400 });
    }

    await sendEmailForUser(
      prospect.assigned_user_id,
      prospect.email,
      prospect.rescue_proposal_subject,
      prospect.rescue_proposal_body
    );

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('channel', 'email')
      .single();

    if (conversation) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: '',
        recipient_email: prospect.email,
        body: prospect.rescue_proposal_body,
      });
    }

    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'jaune',
        rescue_proposal_pending: false,
        rescue_proposal_subject: null,
        rescue_proposal_body: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'sauvetage_envoye' });
  }

  if (action === 'rejeter_sauvetage') {
    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'rouge',
        rescue_proposal_pending: false,
        rescue_proposal_subject: null,
        rescue_proposal_body: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'abandonne' });
  }

  // Marque manuellement le prospect comme perdu : Aaron arrête de le
  // recontacter (voir le filtre is_lost dans le cron check-inbox) et il
  // passe visuellement en rouge dans le pipeline.
  if (action === 'marquer_perdu') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'rouge',
        is_lost: true,
        lost_at: new Date().toISOString(),
        rescue_proposal_pending: false,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'perdu' });
  }

  // Passage manuel en client gagné (jusqu'ici uniquement pensé pour un
  // process automatique post-RDV, jamais câblé) : le commercial peut
  // déclarer lui-même un prospect gagné, avec ou sans passage par un RDV.
  if (action === 'marquer_gagne') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({
        is_won: true,
        won_at: new Date().toISOString(),
        is_lost: false,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'gagne' });
  }

  // Aaron Sales — changement manuel d'étape du pipeline de vente depuis
  // app/app/sales/page.jsx (ex: le commercial coche "devis envoyé" lui-même
  // plutôt que d'attendre la mise à jour automatique via le bilan de RDV,
  // voir lib/appointment-outcome.ts).
  if (action === 'set_deal_stage') {
    if (!VALID_DEAL_STAGES.includes(deal_stage)) {
      return NextResponse.json({ error: 'Étape de pipeline invalide' }, { status: 400 });
    }

    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    const now = new Date().toISOString();
    const update: Record<string, any> = { deal_stage, deal_stage_updated_at: now };

    // Garde is_won/is_lost cohérents avec l'étape choisie manuellement, comme
    // le fait déjà la mise à jour automatique depuis le bilan de RDV.
    if (deal_stage === 'signe') {
      update.is_won = true;
      update.won_at = now;
      update.is_lost = false;
    } else if (deal_stage === 'perdu') {
      update.is_lost = true;
      update.lost_at = now;
    } else {
      update.is_won = false;
      update.is_lost = false;
    }

    await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);

    return NextResponse.json({ success: true, deal_stage });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}

// DELETE -> supprime définitivement un prospect ajouté par erreur (avec
// confirmation côté frontend). Les conversations/messages/RDV liés partent
// avec lui via ON DELETE CASCADE (voir migration_prospect_lifecycle_2026-08-12.sql).
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  const { error: deleteError } = await supabaseAdmin.from('prospects').delete().eq('id', prospectId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
