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
// AUTHENTIFICATION : nouveau portail INSEE (portail-api.insee.fr), une clé
// d'API envoyée dans l'en-tête `X-INSEE-Api-Key-Integration`, pas d'OAuth.
// La clé se crée en s'abonnant à l'API Sirene au plan « Public » ; elle
// n'expire pas. Variable d'environnement : INSEE_API_KEY.
// L'URL de base est dans INSEE_API_BASE pour pouvoir la corriger sans
// redéployer si l'INSEE la fait bouger.

import { callClaude } from './anthropic-client';

const INSEE_BASE = process.env.INSEE_API_BASE || 'https://api.insee.fr/api-sirene/3.11';

export interface SireneCandidate {
  siret: string;
  name: string;              // dénomination, ou enseigne si plus parlante
  activityCode: string | null;
  activityLabel: string | null;
  postalCode: string | null;
  city: string | null;
  employeeBracket: string | null;  // code tranche d'effectifs INSEE
  createdAt: string | null;
}

export function sireneConfigured(): boolean {
  return !!process.env.INSEE_API_KEY;
}

// Un champ peut manquer ou changer de place d'une version à l'autre de l'API :
// on lit défensivement plutôt que de supposer une forme exacte.
function pick(obj: any, ...paths: string[]): string | null {
  for (const path of paths) {
    let cur = obj;
    for (const part of path.split('.')) {
      if (cur == null) break;
      cur = Array.isArray(cur) ? cur[0]?.[part] : cur[part];
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  return null;
}

function toCandidate(etab: any): SireneCandidate | null {
  const siret = pick(etab, 'siret');
  if (!siret) return null;
  const denomination = pick(
    etab,
    'uniteLegale.denominationUniteLegale',
    'uniteLegale.denominationUsuelle1UniteLegale'
  );
  const enseigne = pick(etab, 'periodesEtablissement.enseigne1Etablissement');
  const nom = pick(etab, 'uniteLegale.nomUniteLegale');
  const prenom = pick(etab, 'uniteLegale.prenom1UniteLegale');
  // Entreprise individuelle : pas de dénomination, seulement un nom de personne.
  const personne = nom ? [prenom, nom].filter(Boolean).join(' ') : null;

  return {
    siret,
    name: enseigne || denomination || personne || siret,
    activityCode: pick(etab, 'periodesEtablissement.activitePrincipaleEtablissement', 'uniteLegale.activitePrincipaleUniteLegale'),
    activityLabel: pick(etab, 'periodesEtablissement.activitePrincipaleEtablissementLibelle'),
    postalCode: pick(etab, 'adresseEtablissement.codePostalEtablissement'),
    city: pick(etab, 'adresseEtablissement.libelleCommuneEtablissement'),
    employeeBracket: pick(etab, 'trancheEffectifsEtablissement', 'uniteLegale.trancheEffectifsUniteLegale'),
    createdAt: pick(etab, 'dateCreationEtablissement'),
  };
}

// Interroge Sirene. `nafCodes` est volontairement large, `departments` est une
// liste de préfixes de code postal (« 75 », « 92 »…). On ne garde que les
// établissements ACTIFS (etatAdministratifEtablissement:A) : un établissement
// fermé n'a aucun intérêt en prospection et coûterait une recherche de contact
// pour rien.
export async function searchSireneCandidates(opts: {
  nafCodes: string[];
  departments: string[];
  limit?: number;
}): Promise<{ candidates: SireneCandidate[]; error?: string }> {
  const key = process.env.INSEE_API_KEY;
  if (!key) return { candidates: [], error: 'INSEE_API_KEY absente' };
  if (!opts.nafCodes.length || !opts.departments.length) {
    return { candidates: [], error: 'codes NAF ou départements manquants' };
  }

  const naf = opts.nafCodes.map((c) => `activitePrincipaleEtablissement:${c}`).join(' OR ');
  const cp = opts.departments.map((d) => `codePostalEtablissement:${d}*`).join(' OR ');
  const q = `(${naf}) AND (${cp}) AND etatAdministratifEtablissement:A`;

  const url = `${INSEE_BASE}/siret?q=${encodeURIComponent(q)}&nombre=${Math.min(opts.limit || 300, 1000)}`;

  try {
    const res = await fetch(url, {
      headers: { 'X-INSEE-Api-Key-Integration': key, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { candidates: [], error: `INSEE ${res.status} ${body.slice(0, 200)}` };
    }
    const data: any = await res.json();
    const etablissements: any[] = data?.etablissements || [];
    const candidates = etablissements.map(toCandidate).filter(Boolean) as SireneCandidate[];
    return { candidates };
  } catch (err: any) {
    return { candidates: [], error: err?.message || String(err) };
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
  candidates: SireneCandidate[],
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
      if (pile === 'sur' || pile === 'douteux' || pile === 'non') piles[candidate.siret] = pile;
    }
    // Un candidat que le modèle a oublié de classer n'est pas perdu : il part
    // dans les douteux, jamais écarté en silence.
    for (const c of candidates) if (!piles[c.siret]) piles[c.siret] = 'douteux';
    return { piles };
  } catch (err: any) {
    return { piles: {}, error: err?.message || String(err) };
  }
}
