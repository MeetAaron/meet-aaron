// lib/registry-sirene.ts
//
// ANNUAIRE OFFICIEL FRANÇAIS (INSEE Sirene) — MODE PARALLÈLE, NE TOUCHE À RIEN.
//
// Demande Alex (30/10/2026), après le constat de coût : trouver les
// entreprises d'une zone par recherche web coûte environ 9 centimes par appel
// (5 recherches web à 1 centime + la lecture des résultats), alors que l'INSEE
// publie gratuitement et sans limite la liste de TOUTES les entreprises
// françaises avec leur activité déclarée, leur adresse et leur tranche
// d'effectifs. Le constat qui a déclenché ça : 66 sociétés analysées pour
// 28 prospects exploitables, et la découverte représentait 71 % de la facture.
//
// CE FICHIER NE REMPLACE RIEN POUR L'INSTANT. Il est appelé uniquement par
// la route de comparaison app/api/admin/sirene-shadow, réservée au compte
// fondateur. Le sourcing de production (lib/sourcing.ts) est inchangé. On
// bascule seulement si la comparaison sur une vraie campagne montre que la
// liste INSEE vaut celle de la recherche web — pas avant.
//
// POURQUOI UN FILET LARGE PLUTÔT QU'UN FILTRE PRÉCIS.
// Le code d'activité (NAF/APE) est déclaré à la création de l'entreprise et
// presque jamais mis à jour : une agence événementielle peut être en 8230Z,
// en 7311Z, en 9001Z, ou sous un code qui n'a plus rien à voir. Filtrer
// dessus ferait manquer la moitié de la cible et ramènerait des imprimeurs.
// On prend donc VOLONTAIREMENT trop large — ça ne coûte rien puisque l'API
// est gratuite — et le tri se fait après, par un seul appel Haiku groupé qui
// lit les noms et les libellés d'activité (voir classifyCandidates).
//
// AUCUNE CLÉ, AUCUN COMPTE. On passe par recherche-entreprises.api.gouv.fr,
// déjà utilisée ailleurs dans ce code — et non par le portail INSEE, qui
// demande un compte pour exactement la même donnée. REGISTRY_FR_BASE permet
// de corriger l'adresse sans redéployer si elle bouge.

import { callClaude } from './anthropic-client';

// recherche-entreprises.api.gouv.fr : la même API que lib/company-directory.ts
// utilise déjà pour VÉRIFIER une société française par son nom. Gratuite,
// publique, SANS CLÉ — contrairement au portail INSEE, qui demande un compte
// pour la même donnée. Ce fichier s'en sert pour l'usage inverse : DÉCOUVRIR
// les sociétés d'un secteur et d'une zone, ce qu'aucune fonction existante ne
// savait faire.
const REGISTRY_FR_BASE = process.env.REGISTRY_FR_BASE || 'https://recherche-entreprises.api.gouv.fr';

// Pays dont le registre est ouvert ET interrogeable par secteur + zone.
// C'est ce qui décide si une campagne peut constituer toute sa liste le
// premier jour (gratuit) ou doit l'étaler (recherche web payante).
export const REGISTRY_COUNTRIES = ['FR'] as const;

export function registryCoversCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return (REGISTRY_COUNTRIES as readonly string[]).includes(country.toUpperCase());
}

export interface RegistryCandidate {
  registryId: string;        // SIREN
  name: string;
  activityCode: string | null;
  activityLabel: string | null;
  postalCode: string | null;
  city: string | null;
  employeeBracket: string | null;
  createdAt: string | null;
  sourceUrl: string | null;
}

function toCandidate(hit: any): RegistryCandidate | null {
  const siren = hit?.siren;
  if (!siren) return null;
  const siege = hit.siege || {};
  return {
    registryId: String(siren),
    name: hit.nom_complet || hit.nom_raison_sociale || String(siren),
    activityCode: hit.activite_principale || siege.activite_principale || null,
    activityLabel: hit.libelle_activite_principale || null,
    postalCode: siege.code_postal || null,
    city: siege.libelle_commune || null,
    employeeBracket: hit.tranche_effectif_salarie || null,
    createdAt: hit.date_creation || null,
    sourceUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
  };
}

// DÉCOUVERTE : toutes les sociétés d'un ou plusieurs codes d'activité dans un
// ou plusieurs départements. `nafCodes` est volontairement TROP LARGE (voir le
// commentaire en tête de fichier) ; le tri vient après, par classifyCandidates.
//
// L'API pagine à 25 résultats par page au maximum. On enchaîne les pages
// jusqu'à `limit`, en s'arrêtant dès qu'une page revient vide — inutile de
// marteler l'API publique.
export async function discoverFrenchCompanies(opts: {
  nafCodes: string[];
  departments: string[];
  limit?: number;
}): Promise<{ candidates: RegistryCandidate[]; totalAvailable: number | null; error?: string; debugUrl?: string }> {
  if (!opts.nafCodes.length || !opts.departments.length) {
    return { candidates: [], totalAvailable: null, error: 'codes NAF ou départements manquants' };
  }
  const limit = Math.min(opts.limit || 300, 1000);
  const params = new URLSearchParams({
    activite_principale: opts.nafCodes.join(','),
    departement: opts.departments.join(','),
    etat_administratif: 'A',
    per_page: '25',
    page: '1',
  });
  const debugUrl = `${REGISTRY_FR_BASE}/search?${params.toString()}`;

  const candidates: RegistryCandidate[] = [];
  let totalAvailable: number | null = null;

  try {
    for (let page = 1; candidates.length < limit && page <= 40; page++) {
      params.set('page', String(page));
      const res = await fetch(`${REGISTRY_FR_BASE}/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          candidates,
          totalAvailable,
          error: `registre FR ${res.status} ${body.slice(0, 200)}`,
          debugUrl,
        };
      }
      const data: any = await res.json();
      if (totalAvailable === null && typeof data?.total_results === 'number') {
        totalAvailable = data.total_results;
      }
      const results: any[] = data?.results || [];
      if (results.length === 0) break;
      for (const hit of results) {
        const c = toCandidate(hit);
        if (c) candidates.push(c);
        if (candidates.length >= limit) break;
      }
    }
    return { candidates, totalAvailable, debugUrl };
  } catch (err: any) {
    return { candidates, totalAvailable, error: err?.message || String(err), debugUrl };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TRADUCTION DU CIBLAGE EN CRITÈRES INSEE.
// Même découpe que le sourcing web depuis le 30/10 : Sonnet fait le travail de
// jugement (quels codes d'activité, quels départements), sur un prompt
// minuscule et sans aucun outil — quelques dixièmes de centime. Il n'est PAS
// demandé d'être précis sur les codes : on veut un filet large, le tri vient
// après.
export async function planSireneCriteria(
  companyId: string,
  sectorKeywords: string[],
  zoneLabel: string
): Promise<{ nafCodes: string[]; departments: string[]; error?: string }> {
  const prompt = `Tu prépares une requête sur le répertoire Sirene de l'INSEE (entreprises françaises).

Secteur(s) visé(s) : ${sectorKeywords.join(', ')}
Zone géographique : ${zoneLabel}

1. Donne la liste des codes NAF/APE (format 4 chiffres + 1 lettre, ex: 8230Z) sous lesquels ces entreprises PEUVENT être enregistrées. Sois VOLONTAIREMENT LARGE : le code est déclaré à la création et rarement mis à jour, donc inclus les codes voisins et les codes sous lesquels ce métier est souvent déclaré par erreur ou par héritage. Entre 4 et 12 codes.
2. Donne la liste des préfixes de code postal (2 chiffres, ex: 75, 92, 93) couvrant la zone. Si la zone est une ville, donne le ou les départements qui la contiennent.

Réponds UNIQUEMENT avec un objet JSON, sans texte avant ni après, sans balises markdown :
{"naf": ["8230Z", "..."], "departements": ["75", "..."]}`;

  try {
    const data = await callClaude(
      { model: 'claude-sonnet-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
      companyId, 'ap'
    );
    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    if (!textBlock) return { nafCodes: [], departments: [], error: 'réponse vide' };
    const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());
    const nafCodes = (parsed?.naf || []).filter((c: any) => typeof c === 'string' && /^\d{4}[A-Z]$/.test(c.trim())).map((c: string) => c.trim());
    const departments = (parsed?.departements || []).filter((d: any) => typeof d === 'string' && /^\d{2,3}$/.test(d.trim())).map((d: string) => d.trim());
    return { nafCodes, departments };
  } catch (err: any) {
    return { nafCodes: [], departments: [], error: err?.message || String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LE TRI, EN UN SEUL APPEL.
//
// C'est le cœur de l'économie. Aujourd'hui, découvrir qu'une entreprise ne
// correspond pas coûte 3,4 centimes, parce qu'on ne le sait qu'APRÈS avoir
// payé l'enrichissement et la recherche de contact. Ici, 300 candidats sont
// jugés en un seul appel Haiku sans aucune recherche web, sur leur nom et
// leur activité déclarée : quelques milliers de jetons au total, soit environ
// deux dixièmes de centime pour les 300.
//
// Trois piles et pas deux (« sûr », « douteux », « non ») : on ne paie que la
// pile « sûr », et on ne pioche dans les douteux que si la campagne n'atteint
// pas son objectif. Le doute se paie quand il sert, jamais d'avance.
export type CandidatePile = 'sur' | 'douteux' | 'non';

export async function classifyCandidates(
  companyId: string,
  candidates: RegistryCandidate[],
  sectorKeywords: string[]
): Promise<{ piles: Record<string, CandidatePile>; error?: string }> {
  if (candidates.length === 0) return { piles: {} };

  const lines = candidates
    .map((c, i) => `${i}. ${c.name} — ${c.activityLabel || c.activityCode || 'activité inconnue'} — ${c.city || ''} ${c.postalCode || ''}`)
    .join('\n');

  const prompt = `Voici une liste d'entreprises françaises issues du répertoire officiel, avec leur nom et leur activité DÉCLARÉE (souvent obsolète ou approximative).

Cible recherchée : ${sectorKeywords.join(', ')}

Pour chaque entreprise, dis si elle correspond plausiblement à la cible :
- "sur" : le nom ou l'activité déclarée indiquent clairement ce métier.
- "douteux" : rien ne l'exclut, mais rien ne le confirme non plus (nom de personne, activité trop générale).
- "non" : le nom ou l'activité indiquent clairement un autre métier.

Dans le doute entre "sur" et "douteux", choisis "douteux". N'invente rien : tu ne disposes que de ces deux informations, tu ne consultes aucun site.

${lines}

Réponds UNIQUEMENT avec un objet JSON, sans texte avant ni après, sans balises markdown, dont les clés sont les numéros de ligne et les valeurs "sur", "douteux" ou "non" :
{"0": "sur", "1": "non"}`;

  try {
    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] },
      companyId, 'ap'
    );
    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    if (!textBlock) return { piles: {}, error: 'réponse vide' };
    const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());
    const piles: Record<string, CandidatePile> = {};
    for (const [index, pile] of Object.entries(parsed || {})) {
      const candidate = candidates[Number(index)];
      if (!candidate) continue;
      if (pile === 'sur' || pile === 'douteux' || pile === 'non') piles[candidate.registryId] = pile;
    }
    // Un candidat que le modèle a oublié de classer n'est pas perdu : il part
    // dans les douteux, jamais écarté en silence.
    for (const c of candidates) if (!piles[c.registryId]) piles[c.registryId] = 'douteux';
    return { piles };
  } catch (err: any) {
    return { piles: {}, error: err?.message || String(err) };
  }
}
