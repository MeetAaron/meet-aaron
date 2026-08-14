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
const VALID_ONBOARDING_STATUSES = ['a_demarrer', 'en_cours', 'termine'];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action, deal_stage, onboarding_status, signature_link, contract_renewal_date, first_order_confirmed } = await request.json();
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

  // Passage manuel en gagné : le commercial peut déclarer lui-même un
  // prospect gagné, avec ou sans passage par un RDV. is_won=true arrête
  // immédiatement la prospection automatique (comportement inchangé) — mais
  // le prospect ne bascule en "client" à part entière (Aaron Customer,
  // Résultats > Clients gagnés) que si `first_order_confirmed` est vrai,
  // c-à-d qu'une commande a déjà été réellement passée. Sinon, il reste
  // visible dans Prospects sous "🏆 Gagné — en attente de 1ère commande"
  // jusqu'à confirmation ultérieure (voir action confirmer_premiere_commande
  // ci-dessous et migration_first_order_confirmed_2026-08-14.sql).
  if (action === 'marquer_gagne') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    const now = new Date().toISOString();
    const update: Record<string, any> = {
      is_won: true,
      won_at: now,
      is_lost: false,
    };
    if (first_order_confirmed) {
      update.first_order_confirmed_at = now;
    }

    await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'gagne' });
  }

  // Confirme la 1ère commande d'un prospect déjà "gagné" mais pas encore
  // vraiment client (voir marquer_gagne ci-dessus) — le fait basculer en
  // client à part entière.
  if (action === 'confirmer_premiere_commande') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.is_won) {
      return NextResponse.json({ error: "Ce prospect n'est pas encore marqué comme gagné" }, { status: 400 });
    }

    await supabaseAdmin
      .from('prospects')
      .update({ first_order_confirmed_at: new Date().toISOString() })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'premiere_commande_confirmee' });
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
    // le fait déjà la mise à jour automatique depuis le bilan de RDV. "Signé"
    // implique déjà une commande/un contrat réel, donc on confirme aussi
    // directement la 1ère commande (voir migration_first_order_confirmed_2026-08-14.sql).
    if (deal_stage === 'signe') {
      update.is_won = true;
      update.won_at = now;
      update.is_lost = false;
      update.first_order_confirmed_at = now;
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

  // Aaron Customer — changement manuel du statut d'onboarding depuis
  // app/app/customer/page.jsx (ex: le commercial coche "onboarding terminé"
  // une fois le client bien démarré — pas de déclenchement automatique pour
  // cette étape, contrairement au pipeline Aaron Sales).
  if (action === 'set_onboarding_status') {
    if (!VALID_ONBOARDING_STATUSES.includes(onboarding_status)) {
      return NextResponse.json({ error: "Statut d'onboarding invalide" }, { status: 400 });
    }

    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.is_won) {
      return NextResponse.json({ error: "Ce prospect n'est pas (encore) un client gagné" }, { status: 400 });
    }

    await supabaseAdmin
      .from('prospects')
      .update({ onboarding_status, onboarding_status_updated_at: new Date().toISOString() })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, onboarding_status });
  }

  // Aaron Sales v2 — le commercial colle ici le lien de la procédure de
  // signature externe (Yousign ou autre) une fois le devis envoyé, en
  // attendant une éventuelle intégration API directe (nécessite une clé
  // Yousign fournie par Alex — voir migration_aaron_v2_2026-08-13.sql).
  if (action === 'set_signature_link') {
    if (typeof signature_link !== 'string' || !signature_link.trim()) {
      return NextResponse.json({ error: 'Lien de signature manquant' }, { status: 400 });
    }

    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({ signature_external_link: signature_link.trim(), signature_requested_at: new Date().toISOString() })
      .eq('id', prospectId);

    return NextResponse.json({ success: true });
  }

  if (action === 'clear_signature_link') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({ signature_external_link: null, signature_requested_at: null })
      .eq('id', prospectId);

    return NextResponse.json({ success: true });
  }

  // Aaron Customer v2 — date de renouvellement saisie manuellement par le
  // commercial (Aaron n'a aucun moyen de la connaître seul). Réinitialise
  // renewal_reminder_sent_at pour que le cron app/api/cron/renewal-reminders
  // reparte sur un nouveau cycle d'alerte si la date change.
  if (action === 'set_renewal_date') {
    if (contract_renewal_date !== null && typeof contract_renewal_date !== 'string') {
      return NextResponse.json({ error: 'Date de renouvellement invalide' }, { status: 400 });
    }

    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.is_won) {
      return NextResponse.json({ error: "Ce prospect n'est pas (encore) un client gagné" }, { status: 400 });
    }

    await supabaseAdmin
      .from('prospects')
      .update({ contract_renewal_date, renewal_reminder_sent_at: null })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, contract_renewal_date });
  }

  // Aaron Customer v2 — écarte une suggestion d'upsell du tableau de bord
  // sans la traiter (voir app/api/cron/upsell-signals).
  if (action === 'dismiss_upsell') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({ upsell_dismissed_at: new Date().toISOString() })
      .eq('id', prospectId);

    return NextResponse.json({ success: true });
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
