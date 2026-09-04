// lib/aaron.ts
// Le "cerveau" d'Aaron : construit le contexte, appelle Claude (API Anthropic),
// et parse la réponse structurée en JSON pour que le reste du backend l'exploite.

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';
import { LOCALE_NAMES, normalizeLocale } from './locale-instruction';
import { readFileSync } from 'fs';
import path from 'path';

const AARON_SYSTEM_PROMPT = readFileSync(
  path.join(process.cwd(), 'lib', 'aaron_system_prompt.md'),
  'utf-8'
);

const MAX_DOCS_IN_CONTEXT = 3;
const MAX_CHARS_PER_DOC = 600;

interface AaronOutput {
  email_draft: { subject: string; body: string };
  prospect_status: 'vert' | 'jaune' | 'orange' | 'rouge' | 'bleu';
  personality_type: 'dominant' | 'influent' | 'stable' | 'consciencieux' | null;
  personality_notes: string | null;
  aaron_advice: string;
  detected_phone: string | null;
  appointment_cancelled: boolean;
  rescue_proposal: { subject: string; body: string } | null;
  appointment_proposal: {
    detected: boolean;
    type: 'telephonique' | 'physique' | 'visio';
    proposed_datetime: string;
    requires_sales_validation: boolean;
  } | null;
  action_required_from_sales: string | null;
  quote_requested: boolean;
  deal_approved: { detected: boolean; reason: string | null } | null;
  // Docx pipeline (Alex, 2026-08-23) : deux nouveaux signaux, même mécanique
  // que deal_approved ci-dessus — voir lib/aaron_system_prompt.md pour la
  // définition complète, et app/api/cron/check-inbox pour leur exploitation.
  negotiation_confidence: { score: number; reason: string | null } | null;
  opportunity_signal: { detected: boolean; reason: string | null } | null;
}

async function buildContext(prospectId: string) {
  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('*, users(full_name, email, locale), prospect_companies(name, domain, is_won_client, found_by_campaign_id, research_summary)')
    .eq('id', prospectId)
    .single();

  if (!prospect) throw new Error('Prospect introuvable');

  // Ce qu'Aaron vend réellement — INDISPENSABLE pour écrire un premier
  // message et des relances qui parlent de la bonne offre plutôt que de
  // rester vague. Renseigné par le commercial dans Préférences (voir
  // app/api/business-summary).
  const { data: sellerCompany } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary, prospecting_goal, prospecting_goal_details, default_first_email_enabled, default_first_email_subject, default_first_email_body, public_link_url')
    .eq('id', prospect.company_id)
    .maybeSingle();

  // Objectif de prospection (demande Alex, 2026-08-26) : jusqu'ici la
  // "mission" d'Aaron était codée en dur sur l'obtention d'un rendez-vous,
  // quelle que soit la réponse donnée à la question d'onboarding
  // correspondante (jamais exploitée comme un vrai réglage de comportement,
  // seulement comme texte libre noyé dans business_summary). Traduit ici en
  // libellé lisible passé au prompt système — voir la section "OBJECTIF DE
  // LA PROSPECTION" de lib/aaron_system_prompt.md pour comment c'est utilisé.
  const PROSPECTING_GOAL_LABELS: Record<string, string> = {
    rdv: 'obtenir un rendez-vous qualifié (téléphonique, physique ou visio)',
    devis: 'obtenir une demande de devis/chiffrage directe, sans passer par un rendez-vous',
    essai_gratuit: "faire s'inscrire ou s'abonner directement au produit/service (essai comme abonnement payant en auto-service), sans passer par un rendez-vous",
    autre: 'un autre objectif, précisé ci-dessous',
  };
  const prospectingGoalKey = sellerCompany?.prospecting_goal || 'rdv';
  const objectifDemarchage = {
    objectif: PROSPECTING_GOAL_LABELS[prospectingGoalKey] || PROSPECTING_GOAL_LABELS.rdv,
    precision: sellerCompany?.prospecting_goal_details || null,
  };

  // Si ce prospect a été trouvé par une campagne de prospection, récupère les
  // notes de contexte laissées par le commercial lors de la création de la
  // campagne (ex: "mes clients habituels sont pressés et vont droit au but")
  // pour qu'Aaron adapte réellement le ton — jusqu'ici ces notes étaient
  // capturées mais jamais transmises à la génération des messages.
  let campaignContext: { zone_label: string | null; context_notes: string | null; langue_cible: string | null } | null = null;
  const foundByCampaignId = (prospect as any).prospect_companies?.found_by_campaign_id;
  if (foundByCampaignId) {
    const { data: campaign } = await supabaseAdmin
      .from('prospecting_campaigns')
      .select('zone_label, context_notes, target_locale')
      .eq('id', foundByCampaignId)
      .maybeSingle();
    if (campaign && (campaign.zone_label || campaign.context_notes || campaign.target_locale)) {
      campaignContext = {
        zone_label: campaign.zone_label || null,
        context_notes: campaign.context_notes || null,
        // Langue explicitement choisie pour cette campagne (voir
        // migration_campaign_target_locale_2026-08-21.sql) — utilisée par le
        // prompt système UNIQUEMENT tant qu'aucun message du prospect n'a
        // encore été reçu (voir section "LANGUE DE LA RÉPONSE" du prompt) ;
        // null si non précisée, auquel cas le comportement reste inchangé
        // (repli sur commercial.langue).
        langue_cible: campaign.target_locale ? LOCALE_NAMES[normalizeLocale(campaign.target_locale)] : null,
      };
    }
  }

  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, messages(direction, body, sent_at)')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true });

  let siblingContacts: any[] = [];
  if (prospect.prospect_company_id) {
    const { data } = await supabaseAdmin
      .from('prospects')
      .select('full_name, job_title, status, is_won')
      .eq('prospect_company_id', prospect.prospect_company_id)
      .neq('id', prospectId);
    siblingContacts = data || [];
  }

  // CHANGEMENTS A FAIRE #89 : ne retient que les documents pris en compte
  // par Aaron (included_in_aaron_context) et rattachés au module Prospect —
  // "général" (linked_category NULL ou 'general') ou explicitement
  // 'prospects'. Un document marqué "Opportunités"/"Clients" uniquement
  // n'est pas envoyé ici.
  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text, commercial_note')
    .eq('company_id', prospect.company_id)
    .eq('included_in_aaron_context', true)
    .not('extracted_text', 'is', null)
    .or('linked_category.is.null,linked_category.eq.general,linked_category.eq.prospects')
    .order('created_at', { ascending: false })
    .limit(MAX_DOCS_IN_CONTEXT);

  const documentsSummary = (documents || []).map((doc) => ({
    nom_fichier: doc.file_name,
    description: doc.description,
    // docx "MES DOCUMENTS" item 26 : note libre du commercial/fondateur sur
    // ce document précis, à prendre en compte en plus de l'extrait — voir
    // migration_document_note_2026-08-20.sql.
    note_commerciale: doc.commercial_note || null,
    extrait: doc.extracted_text ? doc.extracted_text.slice(0, MAX_CHARS_PER_DOC) : null,
  }));

  const { data: validatedAppointment } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type, outcome')
    .eq('prospect_id', prospectId)
    .eq('status', 'validé')
    .eq('purpose', 'commercial')
    .order('proposed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Docx pipeline (Alex, 2026-08-23) : true si le RDV le plus récent est déjà
  // passé et que le commercial n'a pas encore rempli son bilan
  // ("Comment ça s'est passé ?" toujours en attente côté commercial) — voir
  // section "DÉTECTION D'UNE INTENTION D'OPPORTUNITÉ SANS BILAN" du prompt
  // système. Sert à Aaron pour savoir s'il peut légitimement déduire lui-même
  // le passage en opportunité à partir de LA réponse du prospect, plutôt que
  // d'attendre la saisie du commercial.
  const bilanRdvEnAttente = !!(
    validatedAppointment &&
    !validatedAppointment.outcome &&
    new Date(validatedAppointment.proposed_at).getTime() < Date.now()
  );

  return {
    company_id: prospect.company_id,
    // Imputation de l'appel API au commercial du prospect (jauge Mon équipe,
    // 01/09/2026) — préfixé "_" comme les autres champs internes, retiré du
    // contexte envoyé à Claude par la déstructuration dans generateAaronResponse.
    _assignedUserId: prospect.assigned_user_id,
    commercial: {
      nom: prospect.users.full_name,
      email: prospect.users.email,
      societe: sellerCompany?.name || null,
      offre_vendue: sellerCompany?.business_summary || null,
      // Objectif de prospection choisi par le commercial (Préférences) — voir
      // la section "OBJECTIF DE LA PROSPECTION" du prompt système.
      objectif_demarchage: objectifDemarchage,
      // Langue choisie par le commercial (préférences) — voir la section
      // "LANGUE DE LA RÉPONSE" du prompt système : utilisée telle quelle pour
      // les champs internes (aaron_advice, personality_notes), et comme
      // repère par défaut pour email_draft/rescue_proposal tant qu'aucun
      // message du prospect n'a encore été reçu.
      langue: LOCALE_NAMES[normalizeLocale(prospect.users.locale)],
      // Lien public que le commercial autorise Aaron à mentionner (demande
      // Alex, 27/08/2026 — voir migration_public_link_url_2026-08-27.sql et la
      // section LIEN PUBLIC du prompt système). null tant qu'il n'est pas
      // renseigné dans Mon compte > Connexions : Aaron ne doit JAMAIS
      // fabriquer une URL à sa place.
      lien_public_a_mentionner: sellerCompany?.public_link_url || null,
    },
    prospect: {
      nom: prospect.full_name,
      email: prospect.email,
      poste: prospect.job_title,
      societe: prospect.prospect_companies?.name,
      // Recherche web sur la société du prospect (voir
      // lib/prospect-research.ts et la section MAÎTRISE DES DEUX SOCIÉTÉS du
      // prompt système) : null si la fiche n'était pas recherchable (société
      // de test, voir isCompanyResearchable()) ou si aucune info fiable n'a
      // été trouvée — dans les deux cas, null signifie explicitement "ne
      // prétends pas connaître cette société", jamais "cherche toi-même".
      recherche_societe_prospect: prospect.prospect_companies?.research_summary || null,
    },
    statut_actuel: prospect.status,
    // Docx pipeline (Alex, 2026-08-23) : étape actuelle de la pipeline
    // Opportunités (null si le prospect n'y est pas encore entré), et si un
    // bilan de RDV est en attente — voir les deux nouvelles sections du
    // prompt système (score de conviction / opportunité sans bilan).
    etape_pipeline_actuelle: prospect.deal_stage,
    bilan_rdv_en_attente: bilanRdvEnAttente,
    personnalite_detectee: prospect.personality_type,
    historique_conversation: conversations,
    autres_contacts_meme_societe: siblingContacts,
    societe_deja_cliente: prospect.prospect_companies?.is_won_client || false,
    documents_entreprise: documentsSummary,
    rdv_valide_existant: validatedAppointment
      ? { date: validatedAppointment.proposed_at, type: validatedAppointment.type }
      : null,
    contexte_campagne_origine: campaignContext,
    // Préfixé "_" par convention de ce fichier (comme company_id) : usage
    // interne à generateAaronResponse ci-dessous, jamais envoyé à Claude
    // (voir la déstructuration qui l'extrait avant construction du prompt).
    _defaultFirstEmail: sellerCompany?.default_first_email_enabled
      ? {
          subject: sellerCompany.default_first_email_subject || '',
          body: sellerCompany.default_first_email_body || '',
        }
      : null,
  };
}

// Remplace {prenom} par le prénom du prospect (premier mot de son nom
// complet), {societe} par le nom de la société du prospect (demande Alex,
// 2026-08-26), et {lien} par le lien public du commercial (demande Alex,
// 27/08/2026 — voir migration_public_link_url_2026-08-27.sql), si connus —
// sinon retire proprement le jeton plutôt que de le laisser tel quel dans un
// email envoyé.
function fillTemplateTokens(
  text: string,
  prospect: { nom?: string | null; societe?: string | null },
  publicLink?: string | null
): string {
  const firstName = (prospect.nom || '').trim().split(/\s+/)[0] || '';
  const company = (prospect.societe || '').trim();
  return text
    .replace(/\{prenom\}/gi, firstName)
    .replace(/\{societe\}/gi, company)
    .replace(/\{lien\}/gi, (publicLink || '').trim());
}

export async function generateAaronResponse(prospectId: string): Promise<AaronOutput> {
  const { company_id: companyId, _defaultFirstEmail: defaultFirstEmail, _assignedUserId: assignedUserId, ...context } = await buildContext(prospectId);

  // Email de premier contact par défaut (demande Alex, 2026-08-26) : si
  // activé ET qu'il s'agit bien du tout premier contact (aucun message dans
  // aucune conversation existante), on utilise le texte fixe du commercial
  // tel quel plutôt que de générer dynamiquement — la signature est ajoutée
  // automatiquement à l'envoi par lib/messaging.ts, comme pour tout email,
  // donc pas besoin de la gérer ici. Les relances/réponses (dès qu'un
  // message existe, dans un sens ou dans l'autre) restent TOUJOURS générées
  // dynamiquement : elles doivent réagir à ce que le prospect a réellement
  // écrit, un texte fixe n'aurait aucun sens à ce stade.
  const isFirstContact = !(context.historique_conversation || []).some(
    (c: any) => (c.messages || []).length > 0
  );
  if (isFirstContact && defaultFirstEmail && defaultFirstEmail.subject.trim() && defaultFirstEmail.body.trim()) {
    return {
      email_draft: {
        subject: fillTemplateTokens(defaultFirstEmail.subject, context.prospect || {}, context.commercial?.lien_public_a_mentionner),
        body: fillTemplateTokens(defaultFirstEmail.body, context.prospect || {}, context.commercial?.lien_public_a_mentionner),
      },
      prospect_status: 'jaune',
      personality_type: null,
      personality_notes: null,
      aaron_advice: "Premier email envoyé avec le modèle par défaut défini dans Préférences (pas de génération IA pour ce message).",
      detected_phone: null,
      appointment_cancelled: false,
      rescue_proposal: null,
      appointment_proposal: null,
      action_required_from_sales: null,
      quote_requested: false,
      deal_approved: null,
      negotiation_confidence: null,
      opportunity_signal: null,
    };
  }

  // Optimisation coût (04/09/2026, question d'Alex : « qu'est-ce qui
  // consomme en tokens ? »). Le contexte est coupé en deux :
  //   - la partie STABLE pour toute la société (qui est le commercial, ce
  //     qu'il vend — le profil d'entreprise fait ~2 500 tokens — et les
  //     extraits de documents) part dans un second bloc système mis en
  //     cache. Le cron traite les prospects d'une même société à la suite :
  //     dès le deuxième, ce bloc est lu depuis le cache à 10 % du prix.
  //   - la partie propre au prospect (fiche, historique, RDV…) reste dans le
  //     message, elle change à chaque appel de toute façon.
  // Même contenu qu'avant, seul l'emplacement change.
  const { commercial, documents_entreprise, ...prospectContext } = context as any;
  const companyBlock = { commercial, documents_entreprise };

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      // Prompt caching : ce system prompt est identique à chaque appel (un par
      // prospect, à chaque cycle de prospection) — le mettre en cache réduit
      // fortement le coût et la latence sur le plus gros poste d'appels API.
      system: [
        { type: 'text', text: AARON_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `Contexte commercial — identique pour tous les prospects de cette société (clés \`commercial\` et \`documents_entreprise\` du contexte) :\n\n${JSON.stringify(companyBlock, null, 2)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Voici le contexte de la situation pour CE prospect (le contexte commercial — commercial, documents_entreprise — est dans les instructions système), y compris l'éventuel rendez-vous déjà validé (rdv_valide_existant) pour détecter une annulation. Réponds UNIQUEMENT avec l'objet JSON structuré défini dans le prompt système, sans aucun texte avant ou après, sans balises markdown.\n\n${JSON.stringify(prospectContext, null, 2)}`,
        },
      ],
    },
    companyId, 'ap', assignedUserId
  );

  const textBlock = data.content.find((block: any) => block.type === 'text');

  if (!textBlock) {
    throw new Error('Aucune réponse texte reçue de Claude');
  }

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as AaronOutput;
  } catch (e) {
    console.error('Réponse Aaron non parsable:', textBlock.text);
    throw new Error('Réponse Aaron mal formée (JSON invalide)');
  }
}
