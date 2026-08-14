// lib/aaron.ts
// Le "cerveau" d'Aaron : construit le contexte, appelle Claude (API Anthropic),
// et parse la réponse structurée en JSON pour que le reste du backend l'exploite.

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';
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
}

async function buildContext(prospectId: string) {
  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('*, users(full_name, email), prospect_companies(name, domain, is_won_client, found_by_campaign_id)')
    .eq('id', prospectId)
    .single();

  if (!prospect) throw new Error('Prospect introuvable');

  // Ce qu'Aaron vend réellement — INDISPENSABLE pour écrire un premier
  // message et des relances qui parlent de la bonne offre plutôt que de
  // rester vague. Renseigné par le commercial dans Préférences (voir
  // app/api/business-summary).
  const { data: sellerCompany } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary')
    .eq('id', prospect.company_id)
    .maybeSingle();

  // Si ce prospect a été trouvé par une campagne de prospection, récupère les
  // notes de contexte laissées par le commercial lors de la création de la
  // campagne (ex: "mes clients habituels sont pressés et vont droit au but")
  // pour qu'Aaron adapte réellement le ton — jusqu'ici ces notes étaient
  // capturées mais jamais transmises à la génération des messages.
  let campaignContext: { zone_label: string | null; context_notes: string | null } | null = null;
  const foundByCampaignId = (prospect as any).prospect_companies?.found_by_campaign_id;
  if (foundByCampaignId) {
    const { data: campaign } = await supabaseAdmin
      .from('prospecting_campaigns')
      .select('zone_label, context_notes')
      .eq('id', foundByCampaignId)
      .maybeSingle();
    if (campaign && (campaign.zone_label || campaign.context_notes)) {
      campaignContext = { zone_label: campaign.zone_label || null, context_notes: campaign.context_notes || null };
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

  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text')
    .eq('company_id', prospect.company_id)
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_DOCS_IN_CONTEXT);

  const documentsSummary = (documents || []).map((doc) => ({
    nom_fichier: doc.file_name,
    description: doc.description,
    extrait: doc.extracted_text ? doc.extracted_text.slice(0, MAX_CHARS_PER_DOC) : null,
  }));

  const { data: validatedAppointment } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type')
    .eq('prospect_id', prospectId)
    .eq('status', 'validé')
    .order('proposed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    company_id: prospect.company_id,
    commercial: {
      nom: prospect.users.full_name,
      email: prospect.users.email,
      societe: sellerCompany?.name || null,
      offre_vendue: sellerCompany?.business_summary || null,
    },
    prospect: {
      nom: prospect.full_name,
      email: prospect.email,
      poste: prospect.job_title,
      societe: prospect.prospect_companies?.name,
    },
    statut_actuel: prospect.status,
    personnalite_detectee: prospect.personality_type,
    historique_conversation: conversations,
    autres_contacts_meme_societe: siblingContacts,
    societe_deja_cliente: prospect.prospect_companies?.is_won_client || false,
    documents_entreprise: documentsSummary,
    rdv_valide_existant: validatedAppointment
      ? { date: validatedAppointment.proposed_at, type: validatedAppointment.type }
      : null,
    contexte_campagne_origine: campaignContext,
  };
}

export async function generateAaronResponse(prospectId: string): Promise<AaronOutput> {
  const { company_id: companyId, ...context } = await buildContext(prospectId);

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      // Prompt caching : ce system prompt est identique à chaque appel (un par
      // prospect, à chaque cycle de prospection) — le mettre en cache réduit
      // fortement le coût et la latence sur le plus gros poste d'appels API.
      system: [{ type: 'text', text: AARON_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Voici le contexte complet de la situation, y compris un extrait des documents de l'entreprise si disponibles, et l'éventuel rendez-vous déjà validé (rdv_valide_existant) pour détecter une annulation. Réponds UNIQUEMENT avec l'objet JSON structuré défini dans le prompt système, sans aucun texte avant ou après, sans balises markdown.\n\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    },
    companyId
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
