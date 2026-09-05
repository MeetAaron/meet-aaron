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

import { callClaude } from './anthropic-client';
import { isGenericEmailDomain } from './csv-import';
import { supabaseAdmin } from './supabase-admin';
import { guessCountry, lookupFrenchCompany, lookupAustralianCompany } from './company-directory';

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
}

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
        .select('summary, website, siret, address, industry, checked_at')
        .eq('domain', cacheKey)
        .maybeSingle();
      if (cached && cached.checked_at && Date.now() - new Date(cached.checked_at).getTime() < 90 * 86_400_000) {
        return {
          summary: cached.summary || null,
          website: cached.website || null,
          siret: cached.siret || null,
          address: cached.address || null,
          industry: cached.industry || null,
        };
      }
    } catch {
      // pas de cache disponible
    }
  }

  // ── Registre officiel avant l'IA (SIRENE / ABN) ──────────────────────────
  // SIRET, adresse du siège, code NAF : des faits d'état civil d'entreprise,
  // gratuits et exacts. L'IA ne sert plus qu'au résumé métier.
  let registry: Awaited<ReturnType<typeof lookupFrenchCompany>> = null;
  const country = guessCountry([input.address, input.city].filter(Boolean).join(' ')) || (input.domain?.endsWith('.fr') ? 'FR' : input.domain?.endsWith('.au') ? 'AU' : null);
  try {
    if (input.name && country === 'FR') registry = await lookupFrenchCompany(input.name, input.city);
    else if (input.name && country === 'AU') registry = await lookupAustralianCompany(input.name);
  } catch {
    registry = null;
  }

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
    `  "industry": "secteur d'activité précis (pas juste \\"BTP\\" ou \\"services\\") ou null"\n` +
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
        max_tokens: 700,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: prompt }],
      },
      companyId,
      'ap'
    );

    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    const text = textBlock?.text?.trim();
    if (!text) return { summary: null, website: null, siret: null, address: null, industry: null };

    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Réponse recherche société prospect non parsable:', text);
      return { summary: null, website: null, siret: null, address: null, industry: null };
    }

    const result: ProspectCompanyResearchResult = {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null,
      website: typeof parsed.website === 'string' && parsed.website.trim() ? parsed.website.trim() : null,
      // Le registre officiel prime sur ce que l'IA a lu.
      siret: registry?.registryId || (isPlausibleSiret(parsed.siret) ? parsed.siret.replace(/\s+/g, '') : null),
      address: registry?.address || (typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null),
      industry: typeof parsed.industry === 'string' && parsed.industry.trim() ? parsed.industry.trim() : registry?.industry || null,
    };
    await writeResearchCache(cacheKey, result);
    return result;
  } catch (err: any) {
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
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'domain' }
    );
  } catch {
    // table absente : tant pis, la fiche prospect_companies garde son résumé
  }
}
