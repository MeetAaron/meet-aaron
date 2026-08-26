// lib/prospect-research.ts
// Recherche web sur l'entreprise d'UN prospect avant qu'Aaron ne le contacte
// pour la première fois (demande Alex, 2026-08-26 : "avant de contacter un
// prospect il faut qu'aaron s'assure également de parfaitement maîtriser [...]
// la société qu'il contacte [...] Et si par exemple le prospect est un poseur
// de portes dans le bâtiment alors aaron doit parfaitement maîtriser le
// métier, ainsi que la société du gars").
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

export interface ProspectCompanyResearchInput {
  name: string | null;
  domain: string | null;
  website: string | null;
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

// Renvoie le résumé de recherche (string) si une info fiable a été trouvée,
// ou null si rien de fiable n'a été trouvé / la fiche n'était pas
// recherchable / l'appel a échoué — dans tous les cas de null, Aaron doit
// rester sur une approche générique plutôt que de prétendre connaître le
// métier du prospect (voir lib/aaron_system_prompt.md, section MAÎTRISE DES
// DEUX SOCIÉTÉS). N'interrompt jamais la création du prospect en cas
// d'erreur : une recherche ratée dégrade la qualité du premier message, elle
// ne doit jamais bloquer la fonctionnalité principale.
export async function researchProspectCompany(
  companyId: string,
  input: ProspectCompanyResearchInput
): Promise<string | null> {
  if (!isCompanyResearchable(input)) return null;

  const identifiers = [
    input.name ? `Nom de la société : ${input.name}` : null,
    input.website ? `Site web : ${input.website}` : input.domain ? `Domaine email : ${input.domain}` : null,
    input.industry ? `Secteur déclaré par le commercial : ${input.industry}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt =
    `Tu prépares un commercial B2B à contacter cette entreprise pour la toute première fois. Cherche sur le web ` +
    `(son site officiel en priorité, sinon LinkedIn, annuaires professionnels ou pages presse) des informations ` +
    `réelles et vérifiables sur son activité :\n\n${identifiers}\n\n` +
    `Rédige un résumé factuel en 3 à 5 phrases : ce que fait CONCRÈTEMENT cette entreprise (son métier précis, ` +
    `pas juste un secteur générique comme "BTP" ou "services"), son marché ou ses clients typiques si tu les ` +
    `identifies, et un ou deux termes de vocabulaire propres à son métier qui montreraient une vraie connaissance ` +
    `du secteur dans un email (ex: pour un poseur de portes de garage, des termes comme "motorisation", "portail ` +
    `battant/coulissant", "mise aux normes"). N'INVENTE RIEN : si tu ne trouves aucune information fiable sur ` +
    `CETTE entreprise précise (à distinguer d'une société homonyme), réponds uniquement le mot ` +
    `"AUCUNE_INFO_FIABLE" sans rien ajouter d'autre.`;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        // max_uses borne le coût de cette recherche ponctuelle, même logique
        // que lib/sourcing.ts (searchContactAtCompany) pour une entreprise
        // déjà identifiée : moins de recherches nécessaires qu'une découverte
        // de zone complète.
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }],
      },
      companyId,
      'ap'
    );

    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    const text = textBlock?.text?.trim();
    if (!text || text.includes('AUCUNE_INFO_FIABLE')) return null;
    return text;
  } catch (err: any) {
    console.error('Erreur recherche web société prospect:', err.message);
    return null;
  }
}
