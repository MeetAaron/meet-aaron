// lib/prospect-research.ts
// Recherche web sur l'entreprise d'UN prospect avant qu'Aaron ne le contacte
// pour la première fois (demande Alex, 2026-08-26 : "avant de contacter un
// prospect il faut qu'aaron s'assure également de parfaitement maîtriser [...]
// la société qu'il contacte [...] Et si par exemple le prospect est un poseur
// de portes dans le bâtiment alors aaron doit parfaitement maîtriser le
// métier, ainsi que la société du gars").
//
// Étendu le même jour (demande Alex : "quand j'entre le prospect manuellement
// aaron doit essayer de compléter la fiche prospect par lui-même (trouver le
// site web, trouver le siret, maîtriser parfaitement)") pour renvoyer, EN
// PLUS du résumé métier, les champs structurés de la fiche encore vides —
// site web, SIRET, adresse, secteur — dans le même appel de recherche web
// (pas d'appel supplémentaire : le coût reste celui d'une seule recherche par
// société, voir max_uses ci-dessous).
//
// Réutilise la même infrastructure que lib/sourcing.ts (outil web_search de
// l'API Anthropic, voir migration_credits... / lib/anthropic-client.ts pour
// le suivi de coût), mais orientée vers UNE société déjà identifiée plutôt
// qu'une découverte par zone/secteur.
//
// Exécutée UNE SEULE FOIS par fiche prospect_companies (jamais par contact
// individuel : plusieurs prospects de la même société partagent le même
// research_summary) et mise en cache en base
// (prospect_companies.research_summary / research_checked_at, voir
// migration_prospect_company_research_2026-08-26.sql) pour ne jamais repayer
// cette recherche à chaque nouveau contact de la même société, ni à chaque
// message généré ensuite par Aaron (lib/aaron.ts se contente de relire la
// valeur déjà stockée en base).
//
// Exception explicite demandée par Alex : les sociétés de test n'existent pas
// réellement (souvent un simple prénom saisi comme "société", ou un domaine
// email grand public type gmail.com) — inutile et risqué de lancer une
// recherche web dessus (coût API pour rien, et risque qu'Aaron rattache par
// erreur les résultats d'une société existante homonyme à un prospect fictif).
// isCompanyResearchable() ci-dessous filtre ce cas.

import { callClaude, MonthlyCapExceededError } from './anthropic-client';
import { isGenericEmailDomain } from './csv-import';
import { supabaseAdmin } from './supabase-admin';
import { guessCountry, lookupCompanyRegistry, type LegalRecord } from './company-directory';
import { normalizeInstagramUrl, normalizeLinkedInCompanyUrl } from './social-urls';
import { localeInstruction, normalizeLocale } from './locale-instruction';

export interface ProspectCompanyResearchInput {
  name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  // Indices de localisation (05/09/2026) : servent à choisir le registre
  // officiel (SIRENE en France, ABN Lookup en Australie) avant toute IA.
  address?: string | null;
  city?: string | null;
}

// Champs structurés que la recherche peut compléter EN PLUS du résumé — un
// champ n'est renvoyé que si une source fiable l'a confirmé ; le SIRET est en
// plus validé côté code (14 chiffres, espaces tolérés) avant d'être retenu,
// pour ne jamais enregistrer une valeur inventée qui aurait échappé à la
// consigne "n'invente rien" du prompt.
export interface ProspectCompanyResearchResult {
  summary: string | null;
  website: string | null;
  siret: string | null;
  address: string | null;
  industry: string | null;
  // Pages PUBLIQUES de l'entreprise (22/10/2026) : liens que le commercial
  // ouvre lui-même, jamais de connexion automatisée à ces réseaux. Validés
  // par lib/social-urls.ts (forme exacte d'une page entreprise / d'un compte).
  linkedin_url: string | null;
  instagram_url: string | null;
  // true quand cette recherche a réellement cherché les pages publiques
  // (recherche du jour, ou cache écrit après leur ajout le 22/10/2026) :
  // la fiche est alors marquée socials_checked_at même si RIEN n'a été
  // trouvé, pour ne jamais repayer une seconde recherche (relecture 22/10).
  socials_searched?: boolean;
}

// Mise en ligne de la recherche des pages publiques (lot 22/10/2026).
const SOCIALS_SEARCH_SINCE = Date.parse('2026-10-22T07:00:00Z');

const EMPTY_RESULT: ProspectCompanyResearchResult = {
  summary: null, website: null, siret: null, address: null, industry: null, linkedin_url: null, instagram_url: null,
};

// Une fiche est jugée "réelle" (donc recherchable) si elle a un site web ou
// un domaine email qui n'est pas un domaine grand public (gmail.com, etc. —
// voir lib/csv-import.ts), OU un nom de société qui ressemble à un vrai nom
// d'entreprise plutôt qu'un simple prénom/mot isolé. Un prospect test saisi
// avec un email @gmail.com et sans nom de société (ou juste un prénom) ne
// passera pas ce filtre, conformément à l'exception demandée par Alex.
export function isCompanyResearchable(input: ProspectCompanyResearchInput): boolean {
  const hasRealWebsite = !!(
    input.website ||
    (input.domain && !isGenericEmailDomain(`contact@${input.domain}`))
  );
  // Un vrai nom de société contient le plus souvent au moins 2 mots (raison
  // sociale + forme juridique, ex: "Dupont SAS") ou un mot assez long pour ne
  // pas être un simple prénom de test ("fabrice éboué" saisi comme société
  // ne doit pas déclencher de recherche, mais "Menuiserie Lefevre" oui).
  const trimmedName = (input.name || '').trim();
  const hasPlausibleCompanyName = trimmedName.length >= 4 && (trimmedName.includes(' ') || trimmedName.length >= 8);
  return hasRealWebsite || hasPlausibleCompanyName;
}

function isPlausibleSiret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const digitsOnly = value.replace(/\s+/g, '');
  return /^\d{14}$/.test(digitsOnly);
}

// Renvoie le résumé + les champs structurés trouvés (chacun null si non
// trouvé/non fiable), ou null si la fiche n'était pas recherchable (société
// de test, voir isCompanyResearchable()) ou si l'appel a totalement échoué —
// dans tous les cas de null/champ null, Aaron doit rester sur une approche
// générique plutôt que de prétendre connaître le métier du prospect (voir
// lib/aaron_system_prompt.md, section MAÎTRISE DES DEUX SOCIÉTÉS), et
// l'appelant ne doit compléter que les champs de la fiche encore vides
// (jamais écraser une valeur déjà renseignée par le commercial). N'interrompt
// jamais la création du prospect en cas d'erreur : une recherche ratée
// dégrade la qualité du premier message / la complétude de la fiche, elle ne
// doit jamais bloquer la fonctionnalité principale.
export async function researchProspectCompany(
  companyId: string,
  input: ProspectCompanyResearchInput
): Promise<ProspectCompanyResearchResult | null> {
  if (!isCompanyResearchable(input)) return null;

  // ── Cache PARTAGÉ entre tous les comptes (05/09/2026) ────────────────────
  // prospect_companies est par société cliente : la même plomberie démarchée
  // par deux clients de Meet Aaron était recherchée deux fois. Une société =
  // une recherche, valable 90 jours, pour tout le monde. Voir
  // migration_company_research_cache_2026-09-05.sql. Best-effort : table
  // absente → on continue sans cache.
  const cacheKey = (input.domain || input.website ? domainOf(input.website) || input.domain : null)?.toLowerCase() || null;
  if (cacheKey) {
    try {
      const { data: cached } = await supabaseAdmin
        .from('company_research_cache')
        .select('*')
        .eq('domain', cacheKey)
        .maybeSingle();
      if (cached && cached.checked_at && Date.now() - new Date(cached.checked_at).getTime() < 90 * 86_400_000) {
        return {
          summary: cached.summary || null,
          website: cached.website || null,
          siret: cached.siret || null,
          address: cached.address || null,
          industry: cached.industry || null,
          // select('*') : tolère un cache créé avant l'ajout de ces colonnes.
          linkedin_url: normalizeLinkedInCompanyUrl(cached.linkedin_url),
          instagram_url: normalizeInstagramUrl(cached.instagram_url),
          socials_searched: new Date(cached.checked_at).getTime() >= SOCIALS_SEARCH_SINCE,
        };
      }
    } catch {
      // pas de cache disponible
    }
  }

  // ── Registre officiel avant l'IA ─────────────────────────────────────────
  // Numéro d'immatriculation, adresse du siège, code d'activité : des faits
  // d'état civil d'entreprise, gratuits et exacts. L'IA ne sert plus qu'au
  // résumé métier. Cinq pays couverts (06/09/2026) : France (SIRENE),
  // Royaume-Uni (Companies House), Australie (ABN Lookup) ; la Belgique et le
  // Canada n'ont pas d'API de recherche par nom et renvoient null, ce qui
  // fait simplement retomber Aaron sur la recherche classique.
  let registry: LegalRecord | null = null;
  const country = guessCountry([input.address, input.city].filter(Boolean).join(' '), input.domain);
  if (input.name) registry = await lookupCompanyRegistry(country, input.name, input.city);

  const identifiers = [
    input.name ? `Nom de la société : ${input.name}` : null,
    input.website ? `Site web : ${input.website}` : input.domain ? `Domaine email : ${input.domain}` : null,
    input.industry ? `Secteur déclaré par le commercial : ${input.industry}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt =
    `Tu prépares un commercial B2B à contacter cette entreprise pour la toute première fois, et tu complètes sa ` +
    `fiche CRM. Cherche sur le web (son site officiel en priorité, sinon LinkedIn, annuaires professionnels type ` +
    `societe.com/pappers.fr/infogreffe.fr, ou pages presse) des informations réelles et vérifiables sur elle :\n\n` +
    `${identifiers}\n\n` +
    `Réponds UNIQUEMENT avec un objet JSON (sans texte avant/après, sans balises markdown) au format :\n` +
    `{\n` +
    `  "summary": "résumé factuel en 3 à 5 phrases : ce que fait CONCRÈTEMENT cette entreprise (son métier précis, ` +
    `pas juste un secteur générique comme \\"BTP\\" ou \\"services\\"), son marché ou ses clients typiques si tu les ` +
    `identifies, et un ou deux termes de vocabulaire propres à son métier qui montreraient une vraie connaissance ` +
    `du secteur dans un email (ex: pour un poseur de portes de garage, des termes comme \\"motorisation\\", ` +
    `\\"portail battant/coulissant\\", \\"mise aux normes\\"), ou null si tu ne trouves aucune information fiable ` +
    `sur CETTE entreprise précise (à distinguer d'une société homonyme)",\n` +
    `  "website": "URL du site officiel ou null",\n` +
    `  "siret": "numéro SIRET (14 chiffres) trouvé sur une source fiable (societe.com, pappers.fr, infogreffe.fr, ` +
    `mentions légales du site officiel...) ou null si non trouvé avec certitude",\n` +
    `  "address": "adresse postale du siège ou de l'établissement principal ou null",\n` +
    `  "industry": "secteur d'activité précis (pas juste \\"BTP\\" ou \\"services\\") ou null",\n` +
    `  "linkedin_url": "URL de la page entreprise LinkedIn OFFICIELLE de cette société (forme ` +
    `https://www.linkedin.com/company/...), souvent en lien dans le pied de page de son site, ou null",\n` +
    `  "instagram_url": "URL du compte Instagram OFFICIEL de cette société (forme https://www.instagram.com/compte/), ` +
    `ou null"\n` +
    `}\n\n` +
    `N'INVENTE RIEN : chaque champ doit être null plutôt que deviné si tu n'as pas trouvé de source fiable.`;

  try {
    const data = await callClaude(
      {
        // Haiku + 1 recherche (05/09/2026, plan de coûts validé par Alex) :
        // le résumé métier est une lecture-synthèse d'une page (le site de
        // l'entreprise), pas une rédaction commerciale. Les champs d'état
        // civil viennent du registre officiel quand on l'a (voir plus haut).
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: prompt }],
      },
      companyId,
      'ap'
    );

    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    const text = textBlock?.text?.trim();
    if (!text) return { ...EMPTY_RESULT };

    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Réponse recherche société prospect non parsable:', text);
      return { ...EMPTY_RESULT };
    }

    const result: ProspectCompanyResearchResult = {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null,
      website: typeof parsed.website === 'string' && parsed.website.trim() ? parsed.website.trim() : null,
      // Le registre officiel prime sur ce que l'IA a lu.
      siret: registry?.registryId || (isPlausibleSiret(parsed.siret) ? parsed.siret.replace(/\s+/g, '') : null),
      address: registry?.address || (typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null),
      industry: typeof parsed.industry === 'string' && parsed.industry.trim() ? parsed.industry.trim() : registry?.industry || null,
      linkedin_url: normalizeLinkedInCompanyUrl(parsed.linkedin_url),
      instagram_url: normalizeInstagramUrl(parsed.instagram_url),
      socials_searched: true,
    };
    await writeResearchCache(cacheKey, result);
    return result;
  } catch (err: any) {
    // Plafond / impayé : remonté pour que la fiche ne soit PAS marquée comme
    // recherchée — elle le sera au prochain contact, une fois le budget revenu.
    if (err?.name === 'MonthlyCapExceededError' || err?.name === 'SubscriptionUnpaidError') throw err;
    console.error('Erreur recherche web société prospect:', err.message);
    return null;
  }
}


function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

async function writeResearchCache(domain: string | null, result: ProspectCompanyResearchResult): Promise<void> {
  if (!domain || !result.summary) return;
  try {
    await supabaseAdmin.from('company_research_cache').upsert(
      {
        domain,
        summary: result.summary,
        website: result.website,
        siret: result.siret,
        address: result.address,
        industry: result.industry,
        linkedin_url: result.linkedin_url,
        instagram_url: result.instagram_url,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'domain' }
    );
  } catch {
    // table absente : tant pis, la fiche prospect_companies garde son résumé
  }
}

// ── Mise à jour de la fiche à partir d'une recherche (22/10/2026) ──────────
// Les trois appelants (ajout manuel, premier message, campagne) recopiaient la
// même logique ; elle vit désormais ici. Règle inchangée : un champ n'est
// complété que s'il est encore VIDE — jamais écraser ce que le commercial a
// saisi. research_checked_at est toujours posé (fiche « vérifiée »).
export function buildResearchUpdate(
  existing: Record<string, any>,
  research: ProspectCompanyResearchResult | null
): Record<string, any> {
  const update: Record<string, any> = { research_checked_at: new Date().toISOString() };
  if (!research) return update;
  if (research.summary) update.research_summary = research.summary;
  for (const key of ['website', 'siret', 'address', 'industry', 'linkedin_url', 'instagram_url'] as const) {
    if (research[key] && !existing?.[key]) update[key] = research[key];
  }
  if (research.socials_searched || research.linkedin_url || research.instagram_url) update.socials_checked_at = update.research_checked_at;
  return update;
}

// Écrit la mise à jour ; si la migration du 22/10 (colonnes linkedin_url,
// instagram_url, socials_checked_at) n'est pas encore jouée, réessaie sans
// ces colonnes plutôt que de perdre tout le résultat de la recherche.
export async function saveResearchUpdate(prospectCompanyId: string, update: Record<string, any>): Promise<void> {
  const { error } = await supabaseAdmin.from('prospect_companies').update(update).eq('id', prospectCompanyId);
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    const { linkedin_url, instagram_url, socials_checked_at, ...rest } = update;
    await supabaseAdmin.from('prospect_companies').update(rest).eq('id', prospectCompanyId);
  }
}

// ── Pages publiques d'une société DÉJÀ recherchée (22/10/2026) ─────────────
// Les fiches recherchées avant l'ajout de LinkedIn/Instagram n'ont pas ces
// liens. Plutôt que de relancer toute la recherche, une petite recherche
// dédiée, lancée À LA DEMANDE depuis la fiche (bouton du commercial), une
// seule fois par société (socials_checked_at).
export async function findCompanySocials(
  clientCompanyId: string,
  input: { name: string | null; website: string | null; domain: string | null }
): Promise<{ linkedin_url: string | null; instagram_url: string | null }> {
  const empty = { linkedin_url: null, instagram_url: null };
  if (!input.name && !input.website && !input.domain) return empty;
  const prompt =
    `Trouve les pages PUBLIQUES officielles de cette entreprise sur LinkedIn et Instagram :\n` +
    (input.name ? `Nom : ${input.name}\n` : '') +
    (input.website ? `Site web : ${input.website}\n` : input.domain ? `Domaine : ${input.domain}\n` : '') +
    `\nLe plus fiable est souvent le pied de page de son site officiel. Ne confonds pas avec une société homonyme.\n` +
    `Réponds UNIQUEMENT avec un objet JSON, sans texte autour :\n` +
    `{"linkedin_url": "https://www.linkedin.com/company/... ou null", "instagram_url": "https://www.instagram.com/compte/ ou null"}\n` +
    `N'INVENTE RIEN : null plutôt qu'une URL devinée.`;
  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: prompt }],
      },
      clientCompanyId,
      'ap'
    );
    const text = data.content.filter((b: any) => b.type === 'text').pop()?.text?.trim() || '';
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) return empty;
    const parsed = JSON.parse(match[0]);
    return {
      linkedin_url: normalizeLinkedInCompanyUrl(parsed.linkedin_url),
      instagram_url: normalizeInstagramUrl(parsed.instagram_url),
    };
  } catch (err: any) {
    // Plafond atteint ou abonnement impayé : on remonte l'erreur pour que
    // l'appelant ne marque PAS la fiche comme vérifiée (relecture 22/10).
    if (err?.name === 'MonthlyCapExceededError' || err?.name === 'SubscriptionUnpaidError' || err instanceof MonthlyCapExceededError) throw err;
    console.error('Erreur recherche pages publiques société:', err?.message);
    return empty;
  }
}

// ── Avis d'Aaron sur l'entreprise (22/10/2026) ─────────────────────────────
// Validé par Alex : en plus du résumé factuel (ce que fait la société), Aaron
// donne SON avis de commercial : est-ce une bonne cible pour CE que vend le
// client, par quel angle l'aborder, à quoi faire attention. Un second appel
// Haiku SANS recherche web (tout est déjà en base : résumé + fiche + offre du
// client), donc ~1/10 de centime. Mis en cache sur la fiche société, dans la
// langue du commercial qui l'a demandé ; régénéré seulement si la langue
// change ou si le commercial clique « Actualiser ».
export type OpinionFit = 'strong' | 'medium' | 'weak';
export interface CompanyOpinion {
  opinion: string;
  fit: OpinionFit | null;
}

export async function generateCompanyOpinion(
  clientCompanyId: string,
  prospectCompany: Record<string, any>,
  locale: string | null | undefined,
  userId?: string | null
): Promise<CompanyOpinion | null> {
  const loc = normalizeLocale(locale);
  const { data: seller } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary, prospecting_goal, prospecting_goal_details')
    .eq('id', clientCompanyId)
    .maybeSingle();

  const facts = [
    prospectCompany.name ? `Nom : ${prospectCompany.name}` : null,
    prospectCompany.industry ? `Secteur : ${prospectCompany.industry}` : null,
    prospectCompany.company_size ? `Taille : ${prospectCompany.company_size}` : null,
    prospectCompany.estimated_revenue ? `CA estimé : ${prospectCompany.estimated_revenue}` : null,
    prospectCompany.address ? `Adresse : ${prospectCompany.address}` : null,
    prospectCompany.website ? `Site : ${prospectCompany.website}` : null,
    prospectCompany.research_summary ? `Ce que fait l'entreprise (recherche web) : ${prospectCompany.research_summary}` : null,
    prospectCompany.news_signal ? `Actualité récente : ${prospectCompany.news_signal}` : null,
  ].filter(Boolean).join('\n');
  if (!prospectCompany.research_summary && !prospectCompany.industry) return null;

  const prompt =
    `Tu es Aaron, copilote commercial B2B. Donne ton AVIS de commercial expérimenté sur cette entreprise ` +
    `comme cible pour la société qui démarche.\n\n` +
    `SOCIÉTÉ QUI DÉMARCHE : ${seller?.name || 'non précisé'}\n` +
    (seller?.business_summary ? `Ce qu'elle vend : ${seller.business_summary}\n` : '') +
    (seller?.prospecting_goal ? `Objectif de prospection : ${seller.prospecting_goal}${seller.prospecting_goal_details ? ` (${seller.prospecting_goal_details})` : ''}\n` : '') +
    `\nENTREPRISE CIBLE :\n${facts}\n\n` +
    `Rédige ${localeInstruction(loc)}, 3 à 4 phrases courtes, tutoiement, sans flatterie ni jargon : ` +
    `1) est-ce une bonne cible pour cette offre et pourquoi, 2) l'angle d'approche le plus prometteur, ` +
    `3) un point de vigilance. Base-toi UNIQUEMENT sur les faits ci-dessus ; si l'information manque, dis-le ` +
    `plutôt que d'inventer.\n\n` +
    `Réponds UNIQUEMENT avec un objet JSON, sans texte autour :\n` +
    `{"opinion": "...", "fit": "strong" | "medium" | "weak"}`;

  try {
    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] },
      clientCompanyId,
      'ap',
      userId || null
    );
    const text = data.content.filter((b: any) => b.type === 'text').pop()?.text?.trim() || '';
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const opinion = typeof parsed.opinion === 'string' ? parsed.opinion.trim() : '';
    if (!opinion) return null;
    const fit: OpinionFit | null = ['strong', 'medium', 'weak'].includes(parsed.fit) ? parsed.fit : null;
    return { opinion: opinion.slice(0, 1200), fit };
  } catch (err: any) {
    console.error("Erreur avis d'Aaron sur l'entreprise:", err?.message);
    return null;
  }
}

// ── Enrichissement automatique d'une fiche société (22/10/2026) ────────────
// Demande d'Alex : « je veux qu'Aaron le fasse lui-même quand on ajoute un
// contact manuellement, en lançant une campagne ou quand on importe un
// fichier : Aaron doit remplir les cases vides ». Un seul point d'entrée pour
// les trois chemins (app/api/prospects, generate-first-contact, sourcing) :
//   - fiche jamais recherchée → recherche complète (résumé, site, SIRET,
//     adresse, secteur, LinkedIn, Instagram), une fois ;
//   - fiche recherchée AVANT l'ajout de LinkedIn/Instagram (socials_checked_at
//     vide, aucun lien) → petite recherche des seules pages publiques, une
//     fois.
// Ne remplit QUE les cases vides, ne bloque jamais la création du contact.
// `existing` doit contenir les colonnes de la fiche (select('*')).
export async function ensureCompanyEnriched(
  clientCompanyId: string,
  existing: Record<string, any>,
  input: ProspectCompanyResearchInput
): Promise<Record<string, any>> {
  try {
    if (!existing.research_summary && !existing.research_checked_at) {
      const research = await researchProspectCompany(clientCompanyId, input);
      const update = buildResearchUpdate(existing, research);
      await saveResearchUpdate(existing.id, update);
      return update;
    }
    const socialsKnown = 'socials_checked_at' in existing;
    if (socialsKnown && !existing.socials_checked_at && !existing.linkedin_url && !existing.instagram_url
        && isCompanyResearchable(input)) {
      const found = await findCompanySocials(clientCompanyId, {
        name: input.name,
        website: input.website,
        domain: input.domain,
      });
      const update: Record<string, any> = { socials_checked_at: new Date().toISOString() };
      if (found.linkedin_url) update.linkedin_url = found.linkedin_url;
      if (found.instagram_url) update.instagram_url = found.instagram_url;
      await supabaseAdmin.from('prospect_companies').update(update).eq('id', existing.id);
      return update;
    }
  } catch (err: any) {
    console.error('Erreur enrichissement société (non bloquant):', err?.message);
  }
  return {};
}
