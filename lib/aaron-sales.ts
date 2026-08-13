// lib/aaron-sales.ts
// Le "cerveau" d'Aaron Sales : prend le relais d'Aaron Prospect (lib/aaron.ts)
// une fois qu'un premier RDV est obtenu. Deux générations distinctes :
//  - generateAppointmentBrief  : fiche de brief avant un RDV (historique,
//    personnalité, objections, angle d'approche, coaching).
//  - generateAppointmentDebrief : à partir de 3 lignes de notes laissées par
//    le commercial juste après le RDV, produit un compte-rendu structuré ET
//    un email de relance prêt à valider/envoyer.
// Réutilise entièrement le moteur d'appel Claude et le plafond de coût par
// société (lib/anthropic-client.ts) — même logique qu'Aaron Prospect.

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';

const MAX_DOCS_IN_CONTEXT = 3;
const MAX_CHARS_PER_DOC = 600;

export interface AppointmentBrief {
  resume_historique: string;
  profil_personnalite: string | null;
  objections_deja_soulevees: string[];
  info_entreprise: string | null;
  angle_approche_suggere: string;
  points_attention: string[];
}

export interface AppointmentDebrief {
  compte_rendu: string;
  email_relance: { subject: string; body: string };
}

export interface Devis {
  objet: string;
  corps_email: string;
  recapitulatif: { poste: string; description: string }[];
}

async function loadAppointmentWithProspect(appointmentId: string) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select(
      `id, type, proposed_at, outcome, prospect_id,
       prospects (
         id, full_name, job_title, company_id, personality_type, personality_notes,
         prospect_company_id, prospect_companies (name, domain)
       )`
    )
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) throw new Error('RDV introuvable');

  const prospect = (appointment as any).prospects;
  if (!prospect) throw new Error("Ce RDV n'est pas rattaché à un prospect suivi par Aaron");

  return { appointment, prospect };
}

async function loadConversationMessages(prospectId: string) {
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospectId)
    .eq('channel', 'email')
    .maybeSingle();

  if (!conversation) return [];

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: true });

  return messages || [];
}

function parseJsonResponse<T>(data: any, errorLabel: string): T {
  const textBlock = data.content.find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('Aucune réponse texte reçue de Claude');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error(`${errorLabel} non parsable:`, textBlock.text);
    throw new Error(`Réponse Aaron mal formée (JSON invalide) — ${errorLabel}`);
  }
}

// Génère (et met en cache sur appointments.pre_brief) la fiche de brief
// pré-RDV : historique résumé, profil détecté, objections déjà rencontrées,
// info entreprise si des documents ont été uploadés, angle d'approche
// suggéré, et 2-3 points de coaching concrets.
export async function generateAppointmentBrief(appointmentId: string): Promise<AppointmentBrief> {
  const { appointment, prospect } = await loadAppointmentWithProspect(appointmentId);
  const companyId = prospect.company_id;

  const messages = await loadConversationMessages(prospect.id);

  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text')
    .eq('company_id', companyId)
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_DOCS_IN_CONTEXT);

  const context = {
    prospect: {
      nom: prospect.full_name,
      poste: prospect.job_title,
      societe: prospect.prospect_companies?.name || null,
    },
    type_rdv: appointment.type,
    date_rdv: appointment.proposed_at,
    historique_echanges: messages,
    personnalite_deja_detectee: prospect.personality_type,
    notes_personnalite: prospect.personality_notes,
    documents_entreprise: (documents || []).map((doc) => ({
      nom_fichier: doc.file_name,
      description: doc.description,
      extrait: doc.extracted_text ? doc.extracted_text.slice(0, MAX_CHARS_PER_DOC) : null,
    })),
  };

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content:
            `Tu es Aaron, copilote commercial IA. Un commercial a un RDV ${appointment.type} bientôt avec ce prospect, ` +
            `et compte sur toi pour préparer une fiche de brief express avant d'y aller.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"resume_historique": "résumé en 3-4 phrases des échanges jusqu'ici, ou une phrase indiquant qu'il n'y a pas encore d'historique", ` +
            `"profil_personnalite": "explication courte du profil détecté et comment s'y adapter en RDV, ou null si aucun profil détecté", ` +
            `"objections_deja_soulevees": ["liste des objections/réticences déjà exprimées par le prospect, tableau vide si aucune"], ` +
            `"info_entreprise": "1-2 phrases sur l'entreprise/le contexte si des infos sont disponibles dans les documents fournis, sinon null", ` +
            `"angle_approche_suggere": "1-2 phrases suggérant un angle d'approche concret pour ce RDV précis", ` +
            `"points_attention": ["2 à 3 points de coaching concrets et courts à garder en tête pendant le RDV"]}\n\n` +
            `Contexte :\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    },
    companyId
  );

  const brief = parseJsonResponse<AppointmentBrief>(data, 'Brief pré-RDV');

  await supabaseAdmin
    .from('appointments')
    .update({ pre_brief: brief, pre_brief_generated_at: new Date().toISOString() })
    .eq('id', appointmentId);

  return brief;
}

// Génère (et enregistre) le compte-rendu structuré + l'email de relance à
// partir des quelques lignes de notes que le commercial laisse juste après
// le RDV. Distinct du bilan rapide (outcome/outcome_note, 4 boutons) déjà
// géré par lib/appointment-outcome.ts — celui-ci reste la source de vérité
// pour la mise à jour automatique du pipeline (deal_stage).
export async function generateAppointmentDebrief(appointmentId: string, notes: string): Promise<AppointmentDebrief> {
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) throw new Error('Notes vides');

  const { appointment, prospect } = await loadAppointmentWithProspect(appointmentId);
  const companyId = prospect.company_id;
  const societe = prospect.prospect_companies?.name;

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content:
            `Tu es Aaron, copilote commercial IA. Le commercial vient d'avoir un RDV ${appointment.type} avec le prospect ` +
            `"${prospect.full_name}"${societe ? ` (${societe})` : ''}, et t'a laissé ces notes rapides juste après :\n` +
            `"${trimmedNotes}"\n\n` +
            `À partir de ces notes UNIQUEMENT (n'invente pas de détails qui n'y figurent pas), rédige :\n` +
            `1) un compte-rendu structuré et professionnel du RDV (points clés abordés, besoins exprimés, prochaines étapes)\n` +
            `2) un email de relance prêt à envoyer au prospect pour le remercier et faire avancer l'affaire, ton professionnel et chaleureux, en français, sans balises HTML.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"compte_rendu": "compte-rendu structuré en plusieurs courts paragraphes séparés par des sauts de ligne", ` +
            `"email_relance": {"subject": "objet de l'email", "body": "corps de l'email"}}`,
        },
      ],
    },
    companyId
  );

  const debrief = parseJsonResponse<AppointmentDebrief>(data, 'Compte-rendu post-RDV');

  await supabaseAdmin
    .from('appointments')
    .update({
      debrief_notes: trimmedNotes,
      debrief_summary: debrief.compte_rendu,
      debrief_email_subject: debrief.email_relance.subject,
      debrief_email_body: debrief.email_relance.body,
      debrief_generated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);

  return debrief;
}

// Aaron Sales v2 — génère (et met en cache sur prospects.devis_*) l'email
// d'accompagnement d'un devis + un récapitulatif de l'offre par postes, à
// partir de l'historique des échanges et du résumé métier de la société
// (companies.business_summary, voir app/api/business-summary). Aaron ne
// connaît pas les tarifs exacts pratiqués par la société : le récapitulatif
// ne contient volontairement AUCUN prix — c'est au commercial de les
// compléter avant d'envoyer (instruction explicite donnée au modèle).
export async function generateDevis(prospectId: string): Promise<Devis> {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, job_title, company_id, prospect_company_id, prospect_companies (name, domain)')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');

  const companyId = prospect.company_id;
  const societe = (prospect as any).prospect_companies?.name;

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', companyId)
    .maybeSingle();

  const messages = await loadConversationMessages(prospectId);

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content:
            `Tu es Aaron, copilote commercial IA. Le commercial doit envoyer un devis/proposition au prospect ` +
            `"${prospect.full_name}"${societe ? ` (${societe})` : ''} suite aux échanges ci-dessous.\n` +
            (company?.business_summary ? `Activité de la société qui vend : ${company.business_summary}\n\n` : '') +
            `Historique des échanges avec ce prospect :\n${JSON.stringify(messages, null, 2)}\n\n` +
            `Rédige :\n1) un email d'accompagnement du devis, professionnel et chaleureux, qui rappelle le contexte ` +
            `et la valeur pour ce prospect précis, en français, sans balises HTML.\n` +
            `2) un récapitulatif de l'offre sous forme de postes (nom du poste + description courte). ` +
            `IMPORTANT : n'invente ET n'écris AUCUN prix ni chiffre — tu ne connais pas les tarifs pratiqués par la ` +
            `société, c'est au commercial de les ajouter lui-même avant l'envoi.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"objet": "objet de l'email", "corps_email": "corps de l'email", ` +
            `"recapitulatif": [{"poste": "nom du poste", "description": "1 phrase, sans prix"}]}`,
        },
      ],
    },
    companyId
  );

  const devis = parseJsonResponse<Devis>(data, 'Devis');

  await supabaseAdmin
    .from('prospects')
    .update({
      devis_subject: devis.objet,
      devis_body: devis.corps_email,
      devis_recap: devis.recapitulatif,
      devis_generated_at: new Date().toISOString(),
    })
    .eq('id', prospectId);

  return devis;
}
