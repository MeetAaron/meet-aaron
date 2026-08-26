// app/api/prospects/[id]/route.ts
// GET   -> détail complet d'un prospect (fiche + historique des échanges)
// PATCH -> approuver ou rejeter une tentative de sauvetage proposée par Aaron
//          ("approuver_sauvetage" envoie l'email, "rejeter_sauvetage" abandonne sans envoyer)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser, DailySendCapExceededError, hasReachedProspectingCap, DEFAULT_DAILY_PROSPECTING_CAP } from '@/lib/messaging';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { triggerAutomaticOnboarding } from '@/lib/aaron-customer';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain, address, siret, website, industry, company_size, estimated_revenue)')
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
  const {
    action,
    deal_stage,
    onboarding_status,
    signature_link,
    contract_renewal_date,
    first_order_confirmed,
    first_email_subject,
    first_email_body,
    ai_managed,
    address,
    siret,
    website,
    industry,
    company_size,
    estimated_revenue,
  } = await request.json();
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

    try {
      await sendEmailForUser(
        prospect.assigned_user_id,
        prospect.email,
        prospect.rescue_proposal_subject,
        prospect.rescue_proposal_body,
        { emailType: 'prospecting' }
      );
    } catch (err: any) {
      if (err instanceof DailySendCapExceededError) {
        return NextResponse.json(
          { error: `Plafond quotidien d'emails de prospection atteint (${err.cap}/jour) — réessayez demain, ou augmentez le plafond dans Préférences.` },
          { status: 429 }
        );
      }
      throw err;
    }

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
        status_updated_at: new Date().toISOString(),
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
        status_updated_at: new Date().toISOString(),
        rescue_proposal_pending: false,
        rescue_proposal_subject: null,
        rescue_proposal_body: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'abandonne' });
  }

  // Envoie le tout premier email d'un prospect resté en attente de
  // validation (voir migration_first_email_approval_2026-08-15.sql,
  // fonctionnalité opt-in — préférence "require_first_email_approval").
  // Le commercial peut modifier l'objet/le corps avant envoi (first_email_subject/
  // first_email_body optionnels) — sinon la version générée par Aaron est
  // envoyée telle quelle. Même schéma que approuver_sauvetage ci-dessus.
  if (action === 'envoyer_premier_email') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.pending_first_email_subject || !prospect.pending_first_email_body) {
      return NextResponse.json({ error: 'Aucun premier email en attente de validation' }, { status: 400 });
    }

    const finalSubject = (typeof first_email_subject === 'string' && first_email_subject.trim()) || prospect.pending_first_email_subject;
    const finalBody = (typeof first_email_body === 'string' && first_email_body.trim()) || prospect.pending_first_email_body;

    // Vérifié AVANT la réclamation ci-dessous (pas après) : la réclamation efface
    // le brouillon en attente, donc si on l'effaçait puis échouait à l'envoi faute
    // de plafond disponible, le brouillon serait perdu sans jamais avoir été
    // envoyé. En vérifiant avant, un plafond atteint laisse le brouillon intact
    // pour une nouvelle tentative demain.
    if (await hasReachedProspectingCap(prospect.assigned_user_id)) {
      const { data: capUser } = await supabaseAdmin
        .from('users')
        .select('daily_prospecting_email_cap')
        .eq('id', prospect.assigned_user_id)
        .maybeSingle();
      const cap = capUser?.daily_prospecting_email_cap ?? DEFAULT_DAILY_PROSPECTING_CAP;
      return NextResponse.json(
        { error: `Plafond quotidien d'emails de prospection atteint (${cap}/jour) — le brouillon reste en attente, réessayez demain.` },
        { status: 429 }
      );
    }

    // Réclamation atomique AVANT l'envoi : le WHERE (pending_first_email_subject
    // non nul) est réévalué par Postgres au moment de l'UPDATE, donc si deux
    // requêtes concurrentes arrivent en même temps (double clic, retry réseau,
    // deux onglets ouverts sur la même fiche), une seule obtient une ligne en
    // retour — la seconde tombe sur 0 ligne et n'envoie rien. Évite un envoi
    // en double du même email au prospect.
    const { data: claimed } = await supabaseAdmin
      .from('prospects')
      .update({
        pending_first_email_subject: null,
        pending_first_email_body: null,
        pending_first_email_generated_at: null,
      })
      .eq('id', prospectId)
      .not('pending_first_email_subject', 'is', null)
      .select('id')
      .maybeSingle();

    if (!claimed) {
      return NextResponse.json({ error: 'Ce premier email a déjà été envoyé ou traité' }, { status: 409 });
    }

    await sendEmailForUser(prospect.assigned_user_id, prospect.email, finalSubject, finalBody, { emailType: 'prospecting' });

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('channel', 'email')
      .single();

    if (conversation) {
      const { data: senderUser } = await supabaseAdmin.from('users').select('email').eq('id', prospect.assigned_user_id).single();
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: senderUser?.email || '',
        recipient_email: prospect.email,
        body: finalBody,
      });
    }

    return NextResponse.json({ success: true, status: 'premier_email_envoye' });
  }

  // Abandonne le premier email en attente sans l'envoyer (ex: le commercial
  // juge le prospect finalement non pertinent) — le prospect reste dans la
  // liste, sans email envoyé ; il peut être relancé plus tard en le
  // supprimant/recréant, ou laissé tel quel.
  if (action === 'rejeter_premier_email') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({
        pending_first_email_subject: null,
        pending_first_email_body: null,
        pending_first_email_generated_at: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'premier_email_rejete' });
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
        status_updated_at: new Date().toISOString(),
        is_lost: true,
        lost_at: new Date().toISOString(),
        rescue_proposal_pending: false,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'perdu' });
  }

  // CHANGEMENTS A FAIRE — Mon équipe (item 1, 2026-08-16) : "clients perdus"
  // est une des 6 nouvelles colonnes de stats de Mon équipe. Réutilise le
  // même champ is_lost/lost_at que "marquer_perdu" ci-dessus (jusqu'ici
  // utilisé uniquement pour un prospect perdu AVANT signature) — un client
  // à part entière (first_order_confirmed_at renseigné) peut désormais aussi
  // être marqué perdu/réactivé depuis Aaron Client, sans nouvelle colonne ni
  // migration. Voir lib/team-stats.ts pour comment ce champ est agrégé.
  if (action === 'marquer_client_perdu') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.first_order_confirmed_at) {
      return NextResponse.json({ error: "Ce prospect n'est pas encore un client à part entière" }, { status: 400 });
    }

    await supabaseAdmin
      .from('prospects')
      .update({ is_lost: true, lost_at: new Date().toISOString() })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'client_perdu' });
  }

  if (action === 'reactiver_client') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({ is_lost: false, lost_at: null })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'client_reactive' });
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

    // Docx "CLIENTS A1(a)" : onboarding automatique dès que ce prospect
    // devient réellement client (pas juste "gagné en attente de 1ère
    // commande") — voir lib/aaron-customer.ts. Fire-and-forget : ne bloque
    // jamais la réponse de cette action interactive (le commercial ne doit
    // pas attendre un appel Claude + l'envoi d'un email avant de voir son
    // clic "Gagné" confirmé).
    if (first_order_confirmed) {
      triggerAutomaticOnboarding(prospectId).catch(() => {});
    }

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

    // Docx "CLIENTS A1(a)" : onboarding automatique — voir lib/aaron-customer.ts.
    triggerAutomaticOnboarding(prospectId).catch(() => {});

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

    // Docx "CLIENTS A1(a)" : onboarding automatique — voir lib/aaron-customer.ts.
    if (deal_stage === 'signe') {
      triggerAutomaticOnboarding(prospectId).catch(() => {});
    }

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
  // signature externe (Yousign/Youtrust ou autre) une fois le devis envoyé.
  // Depuis le 2026-08-20, ceci reste un REPLI manuel à côté de l'envoi
  // automatique via l'API Youtrust (voir action POST sur
  // app/api/prospects/[id]/signature-request et lib/youtrust.ts) — utile si
  // Alex préfère générer le lien lui-même dans un autre outil, ou tant que
  // YOUTRUST_API_KEY n'est pas configurée.
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
      .update({
        signature_external_link: null,
        signature_requested_at: null,
        youtrust_signature_request_id: null,
        signature_status: null,
        signature_completed_at: null,
      })
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

  // Bascule "Aaron s'en charge" — à l'origine exposée uniquement dans Aaron
  // Client (voir migration_customer_ai_managed_2026-08-17.sql) et bloquée
  // ici pour tout prospect pas encore gagné. Étendue le 2026-08-26 (demande
  // Alex : "il faut quand même un bouton à côté de chaque ligne du genre
  // 'aaron s'en charge / aaron ne s'en charge pas'" + garantie qu'Aaron ne
  // traite que les contacts dont il a la charge) à TOUT prospect assigné au
  // commercial connecté, quel que soit son statut (prospect en cours,
  // opportunité, client gagné) : app/api/cron/check-inbox/route.ts vérifie
  // désormais ai_managed dans les deux branches (client gagné comme avant,
  // et prospect/opportunité en cours, nouveau) — quand ai_managed passe à
  // false, Aaron n'ouvre plus du tout les messages de ce contact : ni
  // archivage, ni brouillon de réponse, ni relance automatique — le
  // commercial reprend entièrement la main, comme pour un email personnel.
  if (action === 'set_ai_managed') {
    if (typeof ai_managed !== 'boolean') {
      return NextResponse.json({ error: 'ai_managed doit être un booléen' }, { status: 400 });
    }

    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    await supabaseAdmin
      .from('prospects')
      .update({ ai_managed })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, ai_managed });
  }

  // Modifie les infos société (adresse, SIRET, site web, secteur, taille,
  // CA estimé — demande Alex, 2026-08-25 : "il manque des infos... l'adresse,
  // etc etc ?"). Portées par prospect_companies (la société), pas par ce
  // prospect : la modification se répercute donc sur tous les contacts de la
  // même société. Voir migration_company_info_2026-08-25.sql. Accessible
  // depuis Prospects, Opportunités ET Clients puisque les trois pages
  // affichent la même fiche prospect/société, juste à des étapes différentes
  // du pipeline.
  if (action === 'update_company_info') {
    const authedUser = await getAuthedUser(request);
    if (!authedUser) return unauthorizedResponse();
    if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

    if (!prospect.prospect_company_id) {
      return NextResponse.json({ error: 'Aucune société associée à cette fiche' }, { status: 400 });
    }

    const cleanStr = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const companyUpdate = {
      address: cleanStr(address),
      siret: cleanStr(siret),
      website: cleanStr(website),
      industry: cleanStr(industry),
      company_size: cleanStr(company_size),
      estimated_revenue: cleanStr(estimated_revenue),
    };

    const { error: updateError } = await supabaseAdmin
      .from('prospect_companies')
      .update(companyUpdate)
      .eq('id', prospect.prospect_company_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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
