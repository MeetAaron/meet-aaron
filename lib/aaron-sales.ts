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
import { localeInstruction, normalizeLocale } from './locale-instruction';

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

export interface DevisLineItem {
  poste: string;
  description: string;
  produit_id: string | null;
  prix_unitaire_eur: number | null;
  quantite: number;
  total_ligne_eur: number | null;
}

export interface Devis {
  objet: string;
  corps_email: string;
  recapitulatif: DevisLineItem[];
  total_eur: number | null;
  a_des_postes_sans_prix: boolean;
}

interface CatalogProduct {
  id: string;
  reference: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  unit_price_eur: number;
}

// Somme des lignes chiffrées d'un récapitulatif + indicateur "reste des
// postes à chiffrer" — factorisé pour être utilisé aussi bien à la
// génération (ci-dessous) qu'à la relecture d'un devis déjà en cache
// (voir app/api/prospects/[id]/devis/route.ts).
export function summarizeDevisRecap(recapitulatif: DevisLineItem[]): { total_eur: number | null; a_des_postes_sans_prix: boolean } {
  const priced = recapitulatif.filter((r) => r.total_ligne_eur !== null && r.total_ligne_eur !== undefined);
  const total_eur = priced.length > 0 ? Math.round(priced.reduce((sum, r) => sum + (r.total_ligne_eur as number), 0) * 100) / 100 : null;
  const a_des_postes_sans_prix = recapitulatif.some((r) => r.total_ligne_eur === null || r.total_ligne_eur === undefined);
  return { total_eur, a_des_postes_sans_prix };
}

async function loadAppointmentWithProspect(appointmentId: string) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select(
      `id, type, proposed_at, outcome, prospect_id,
       prospects (
         id, full_name, job_title, company_id, personality_type, personality_notes,
         prospect_company_id, prospect_companies (name, domain), assigned_user_id, users (locale)
       )`
    )
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) throw new Error('RDV introuvable');

  const prospect = (appointment as any).prospects;
  if (!prospect) throw new Error("Ce RDV n'est pas rattaché à un prospect suivi par Aaron");

  return { appointment, prospect };
}

// Langue du commercial assigné — voir la note équivalente dans
// lib/aaron-customer.ts : ici aussi, le prospect n'a pas de langue détectée
// séparément pour le brief/compte-rendu/devis (contenu interne ou déjà en
// aval d'un RDV obtenu), donc on retombe sur celle du commercial.
function prospectLocale(prospect: any): string {
  return normalizeLocale(prospect?.users?.locale);
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
  const locale = prospectLocale(prospect);

  const messages = await loadConversationMessages(prospect.id);

  // CHANGEMENTS A FAIRE #89 : ne retient que les documents pris en compte
  // par Aaron et rattachés au module Opportunité — "général" (NULL/'general')
  // ou explicitement 'opportunites'.
  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text, commercial_note')
    .eq('company_id', companyId)
    .eq('included_in_aaron_context', true)
    .not('extracted_text', 'is', null)
    .or('linked_category.is.null,linked_category.eq.general,linked_category.eq.opportunites')
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
      // docx "MES DOCUMENTS" item 26 : note libre du commercial/fondateur.
      note_commerciale: doc.commercial_note || null,
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
            `et compte sur toi pour préparer une fiche de brief express avant d'y aller. Rédige tout ce qui suit ` +
            `${localeInstruction(locale)} — c'est une fiche interne, lue uniquement par le commercial.\n` +
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
    companyId, 'as'
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
  const locale = prospectLocale(prospect);

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
            `1) un compte-rendu structuré et professionnel du RDV (points clés abordés, besoins exprimés, prochaines étapes) — usage interne, ${localeInstruction(locale)} (langue du commercial)\n` +
            `2) un email de relance prêt à envoyer au prospect pour le remercier et faire avancer l'affaire, ton professionnel et chaleureux, ${localeInstruction(locale)}, sans balises HTML.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"compte_rendu": "compte-rendu structuré en plusieurs courts paragraphes séparés par des sauts de ligne", ` +
            `"email_relance": {"subject": "objet de l'email", "body": "corps de l'email"}}`,
        },
      ],
    },
    companyId, 'as'
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

async function loadActiveCatalog(companyId: string): Promise<CatalogProduct[]> {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, reference, name, description, category, unit, unit_price_eur')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(300);

  return (data || []) as CatalogProduct[];
}

// Les 3 derniers devis déjà envoyés/générés pour CE prospect précis — donné
// à Aaron comme contexte pour rester cohérent avec ce qui a déjà été
// proposé (ex: mêmes prix pour un même poste), voir demande Alex "aaron
// doit s'appuyer sur l'historique de devis déjà envoyé à ce client".
async function loadRecentQuotesForProspect(prospectId: string) {
  const { data: quotes } = await supabaseAdmin
    .from('quotes')
    .select('created_at, total_eur, quote_line_items (label, quantity, unit_price_eur)')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false })
    .limit(3);

  return (quotes || []).map((q: any) => ({
    date: q.created_at,
    total_eur: q.total_eur,
    postes: (q.quote_line_items || []).map((li: any) => ({
      libelle: li.label,
      quantite: li.quantity,
      prix_unitaire_eur: li.unit_price_eur,
    })),
  }));
}

// Aaron Sales v2 — génère (et met en cache sur prospects.devis_*, + un
// enregistrement historisé dans quotes/quote_line_items) l'email
// d'accompagnement d'un devis + un récapitulatif de l'offre par postes, à
// partir de l'historique des échanges et du résumé métier de la société
// (companies.business_summary, voir app/api/business-summary).
//
// Si la société a rempli son catalogue produits (table `products`, voir
// app/api/products), Aaron chiffre directement les postes qu'il reconnaît
// avec CONFIANCE dans ce catalogue — en reprenant le prix exact, jamais en
// l'inventant ni en le modifiant (vérifié après coup côté serveur, voir le
// garde-fou `catalogById` ci-dessous : on ne fait confiance qu'à un prix
// qui correspond réellement à un produit_id existant du catalogue). Les
// postes non reconnus (ou si le catalogue est vide) restent sans prix,
// exactement comme avant — c'est toujours au commercial de les compléter.
export async function generateDevis(prospectId: string): Promise<Devis> {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, job_title, company_id, prospect_company_id, prospect_companies (name, domain), assigned_user_id, users (locale)')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');

  const companyId = prospect.company_id;
  const societe = (prospect as any).prospect_companies?.name;
  const locale = prospectLocale(prospect);

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', companyId)
    .maybeSingle();

  const messages = await loadConversationMessages(prospectId);
  const catalog = await loadActiveCatalog(companyId);
  const previousQuotes = await loadRecentQuotesForProspect(prospectId);
  const hasCatalog = catalog.length > 0;

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content:
            `Tu es Aaron, copilote commercial IA. Le commercial doit envoyer un devis/proposition au prospect ` +
            `"${prospect.full_name}"${societe ? ` (${societe})` : ''} suite aux échanges ci-dessous.\n` +
            (company?.business_summary ? `Activité de la société qui vend : ${company.business_summary}\n\n` : '') +
            `Historique des échanges avec ce prospect :\n${JSON.stringify(messages, null, 2)}\n\n` +
            (previousQuotes.length
              ? `Devis déjà proposés précédemment à ce même prospect (reste cohérent, notamment sur les prix déjà annoncés pour un même poste) :\n${JSON.stringify(previousQuotes, null, 2)}\n\n`
              : '') +
            (hasCatalog
              ? `Catalogue des produits/prestations et tarifs RÉELS de la société (chaque entrée a un "id") :\n${JSON.stringify(catalog, null, 2)}\n\n` +
                `Pour chaque poste du récapitulatif, si tu identifies AVEC CONFIANCE une correspondance dans ce catalogue ` +
                `(même nom ou description clairement équivalente à ce que le prospect a demandé), renseigne "produit_id" ` +
                `(l'id EXACT du catalogue) et "quantite" (déduite des échanges si une quantité est mentionnée, sinon 1). ` +
                `Si un poste ne correspond à AUCUN produit du catalogue, ou si le doute est réel, laisse "produit_id" à ` +
                `null et "quantite" à 1 — n'invente JAMAIS un prix, le backend s'occupe de reprendre le prix exact du ` +
                `catalogue à partir du "produit_id" que tu fournis, tu n'as toi-même aucun prix à écrire.\n\n`
              : `Cette société n'a pas encore renseigné de catalogue de produits/tarifs — laisse "produit_id" à null et ` +
                `"quantite" à 1 pour chaque poste, tu ne connais aucun prix.\n\n`) +
            `Rédige :\n1) un email d'accompagnement du devis, professionnel et chaleureux, qui rappelle le contexte ` +
            `et la valeur pour ce prospect précis, ${localeInstruction(locale)}, sans balises HTML.\n` +
            `2) un récapitulatif de l'offre sous forme de postes (usage interne, ${localeInstruction(locale)}).\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"objet": "objet de l'email", "corps_email": "corps de l'email", ` +
            `"recapitulatif": [{"poste": "nom du poste", "description": "1 phrase", "produit_id": "id du catalogue ou null", "quantite": 1}]}`,
        },
      ],
    },
    companyId, 'as'
  );

  const raw = parseJsonResponse<{
    objet: string;
    corps_email: string;
    recapitulatif: { poste: string; description: string; produit_id: string | null; quantite: number }[];
  }>(data, 'Devis');

  // Garde-fou : le prix ne vient JAMAIS du texte généré par le modèle, mais
  // uniquement d'une correspondance vérifiée avec un produit_id réel du
  // catalogue chargé côté serveur — protège contre un prix halluciné ou
  // altéré malgré la consigne du prompt.
  const catalogById = new Map(catalog.map((p) => [p.id, p]));
  const recapitulatif: DevisLineItem[] = raw.recapitulatif.map((item) => {
    const matched = item.produit_id ? catalogById.get(item.produit_id) : null;
    const quantite = Number(item.quantite) > 0 ? Number(item.quantite) : 1;

    if (!matched) {
      return {
        poste: item.poste,
        description: item.description,
        produit_id: null,
        prix_unitaire_eur: null,
        quantite,
        total_ligne_eur: null,
      };
    }

    return {
      poste: item.poste,
      description: item.description,
      produit_id: matched.id,
      prix_unitaire_eur: matched.unit_price_eur,
      quantite,
      total_ligne_eur: Math.round(matched.unit_price_eur * quantite * 100) / 100,
    };
  });

  const { total_eur, a_des_postes_sans_prix } = summarizeDevisRecap(recapitulatif);

  const devis: Devis = {
    objet: raw.objet,
    corps_email: raw.corps_email,
    recapitulatif,
    total_eur,
    a_des_postes_sans_prix,
  };

  await supabaseAdmin
    .from('prospects')
    .update({
      devis_subject: devis.objet,
      devis_body: devis.corps_email,
      devis_recap: devis.recapitulatif,
      devis_generated_at: new Date().toISOString(),
    })
    .eq('id', prospectId);

  // Historique structuré : une NOUVELLE ligne à chaque génération (jamais un
  // écrasement) — sert de base à loadRecentQuotesForProspect ci-dessus, et
  // prépare le futur export Excel/PDF (colonnes storage_path, vides pour
  // l'instant). Best-effort : ne doit jamais faire échouer la génération du
  // devis lui-même si l'écriture de l'historique échoue.
  try {
    const { data: quoteRow } = await supabaseAdmin
      .from('quotes')
      .insert({
        company_id: companyId,
        prospect_id: prospectId,
        status: 'brouillon',
        total_eur,
        has_unpriced_items: a_des_postes_sans_prix,
      })
      .select('id')
      .single();

    if (quoteRow?.id && recapitulatif.length > 0) {
      await supabaseAdmin.from('quote_line_items').insert(
        recapitulatif.map((item) => ({
          quote_id: quoteRow.id,
          product_id: item.produit_id,
          label: item.poste,
          quantity: item.quantite,
          unit_price_eur: item.prix_unitaire_eur,
          line_total_eur: item.total_ligne_eur,
        }))
      );
    }
  } catch (err: any) {
    console.error('Erreur enregistrement historique devis:', err.message);
  }

  return devis;
}
