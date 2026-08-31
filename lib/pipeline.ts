// lib/pipeline.ts
// Socle de la fusion Prospects + Opportunités (validée par Alex, docx « mon
// avis » du 31/08/2026) : UN SEUL tableau de contacts et UNE SEULE ligne de
// progression à 6 points, sur laquelle la catégorie (🎯 prospect / 🤝
// opportunité / ⭐ client) n'est qu'une lecture de l'étape atteinte.
//
//   🎯 en_cours → en_bonne_voie
//   🤝 rdv_obtenu → proposition_demandee → en_negociation
//   ⭐ client
//
// Choix d'Alex : pas d'étape « à contacter » (« ça peut aller dans en
// cours ») ni « proposition envoyée » (« le moment où on envoie le devis ça
// passe en négociation ; si le client refuse le devis ça retombe en RDV
// obtenu »). « Risque de perdre » n'est pas une étape mais un drapeau posé
// sur n'importe quelle étape ; « Perdu » est un état terminal unique qui
// garde l'étape où ça s'est arrêté (point rouge sur la ligne) et le motif —
// ce qui permettra plus tard une réactivation ciblée.
//
// Ce module est PUR (aucun import serveur) : il est importé aussi bien par
// les pages 'use client' (tableau, cartes mobile, fiche) que par les routes
// API et les crons. Il sait dériver la position d'un contact à partir des
// colonnes EXISTANTES de la table prospects (status jaune/vert/bleu/orange/
// rouge, deal_stage, is_won, first_order_confirmed_at, is_lost, devis_*…) —
// donc la nouvelle interface fonctionne même avant la migration, et la
// persistance dédiée (prospects.pipeline_stage, voir
// migration_pipeline_fusion_2026-09-01.sql) ne sert qu'à figer/forcer une
// étape choisie à la main (bouton « Déplacer » de la fiche).

export type PipelineStage =
  | 'en_cours'
  | 'en_bonne_voie'
  | 'rdv_obtenu'
  | 'proposition_demandee'
  | 'en_negociation'
  | 'client';

export type PipelineCategory = 'prospect' | 'opportunite' | 'client';

export interface PipelineStageDef {
  key: PipelineStage;
  category: PipelineCategory;
  order: number; // 0..5
  // Clé i18n du libellé et de l'explication (lib/i18n.js, pipeline.*)
  labelKey: string;
  hintKey: string;
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  { key: 'en_cours', category: 'prospect', order: 0, labelKey: 'pipeline.stage.enCours', hintKey: 'pipeline.hint.enCours' },
  { key: 'en_bonne_voie', category: 'prospect', order: 1, labelKey: 'pipeline.stage.enBonneVoie', hintKey: 'pipeline.hint.enBonneVoie' },
  { key: 'rdv_obtenu', category: 'opportunite', order: 2, labelKey: 'pipeline.stage.rdvObtenu', hintKey: 'pipeline.hint.rdvObtenu' },
  { key: 'proposition_demandee', category: 'opportunite', order: 3, labelKey: 'pipeline.stage.propositionDemandee', hintKey: 'pipeline.hint.propositionDemandee' },
  { key: 'en_negociation', category: 'opportunite', order: 4, labelKey: 'pipeline.stage.enNegociation', hintKey: 'pipeline.hint.enNegociation' },
  { key: 'client', category: 'client', order: 5, labelKey: 'pipeline.stage.client', hintKey: 'pipeline.hint.client' },
];

export const PIPELINE_STAGE_KEYS: PipelineStage[] = PIPELINE_STAGES.map((s) => s.key);

export const CATEGORY_ICONS: Record<PipelineCategory, string> = {
  prospect: '🎯',
  opportunite: '🤝',
  client: '⭐',
};

// Couleurs de la ligne de progression (une par catégorie) + états.
export const PIPELINE_COLORS = {
  prospect: '#4B9EF0',
  opportunite: '#B07CF5',
  client: '#3DD68C',
  risk: '#F0914E',
  lost: '#E5484D',
  wonPending: '#D4A017',
};

const STAGE_BY_KEY: Record<string, PipelineStageDef> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]));

export function stageDef(stage: PipelineStage): PipelineStageDef {
  return STAGE_BY_KEY[stage];
}

export function stageOrder(stage: PipelineStage): number {
  return STAGE_BY_KEY[stage]?.order ?? 0;
}

export function categoryOfStage(stage: PipelineStage): PipelineCategory {
  return STAGE_BY_KEY[stage]?.category || 'prospect';
}

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && value in STAGE_BY_KEY;
}

// Motifs de perte (un seul « Perdu », le motif fait la différence entre un
// prospect qui n'a jamais répondu, un devis refusé et un client résilié).
export type LostReason =
  | 'pas_interesse'
  | 'sans_reponse'
  | 'trop_cher'
  | 'concurrent'
  | 'timing'
  | 'devis_refuse'
  | 'resilie'
  | 'autre';

export const LOST_REASONS: LostReason[] = ['pas_interesse', 'sans_reponse', 'trop_cher', 'concurrent', 'timing', 'devis_refuse', 'resilie', 'autre'];

// Colonnes de la table prospects utilisées pour dériver la position (toutes
// existent déjà ; `pipeline_*` et `quote_requested_at` sont ajoutées par la
// migration de la fusion, optionnelles ici).
export interface PipelineSourceRow {
  status?: string | null; // jaune | vert | bleu | orange | rouge
  deal_stage?: string | null; // rdv_fait | devis_envoye | en_negociation | signe | perdu
  is_won?: boolean | null;
  first_order_confirmed_at?: string | null;
  is_lost?: boolean | null;
  lost_at?: string | null;
  quote_requested_at?: string | null; // demande de devis détectée/déclarée (migration fusion)
  devis_generated_at?: string | null;
  devis_sent_at?: string | null;
  pipeline_stage?: string | null; // étape forcée à la main (migration fusion)
  pipeline_lost_at_stage?: string | null;
  pipeline_lost_reason?: string | null;
  pipeline_risk?: boolean | null;
}

export interface PipelinePosition {
  stage: PipelineStage; // étape atteinte (ou étape d'arrêt si perdu)
  category: PipelineCategory;
  lost: boolean;
  lostReason: LostReason | null;
  risk: boolean; // drapeau « risque de perdre »
  // Client déclaré gagné mais 1ère commande pas encore confirmée
  // (first_order_confirmed_at null) : affiché sur le point Client, en ambre.
  wonPendingFirstOrder: boolean;
}

function stageFromDealStage(p: PipelineSourceRow): PipelineStage | null {
  switch (p.deal_stage) {
    case 'rdv_fait':
      // Devis demandé mais pas encore envoyé → proposition demandée.
      return p.quote_requested_at || (p.devis_generated_at && !p.devis_sent_at) ? 'proposition_demandee' : 'rdv_obtenu';
    case 'devis_envoye':
      // Règle d'Alex : le devis part → on est en négociation.
      return 'en_negociation';
    case 'en_negociation':
      return 'en_negociation';
    case 'signe':
      return 'client';
    default:
      return null;
  }
}

function stageFromStatus(p: PipelineSourceRow): PipelineStage {
  switch (p.status) {
    case 'vert':
      return 'en_bonne_voie';
    case 'bleu':
      return p.quote_requested_at ? 'proposition_demandee' : 'rdv_obtenu';
    case 'jaune':
    case 'orange':
    case 'rouge':
    default:
      return p.quote_requested_at ? 'proposition_demandee' : 'en_cours';
  }
}

// Position d'un contact sur la ligne, à partir de ses colonnes. Règles :
//  1. Étape forcée (pipeline_stage) > étape déduite.
//  2. Perdu (is_lost, deal_stage 'perdu' ou status 'rouge') : on garde
//     l'étape la plus avancée connue comme étape d'arrêt.
//  3. Client : is_won ou deal_stage 'signe' (1ère commande confirmée ou non).
//  4. Opportunité : deal_stage rdv_fait/devis_envoye/en_negociation, ou
//     status 'bleu' (RDV obtenu sans bilan encore) ; devis demandé →
//     proposition demandée ; devis envoyé → en négociation.
//  5. Prospect : status vert → en bonne voie ; sinon en cours.
//     status 'orange' = drapeau risque.
export function derivePipelinePosition(p: PipelineSourceRow): PipelinePosition {
  const forced = isPipelineStage(p.pipeline_stage) ? p.pipeline_stage : null;
  const lost = p.is_lost === true || p.deal_stage === 'perdu' || p.status === 'rouge';
  const won = p.is_won === true || p.deal_stage === 'signe';

  let stage: PipelineStage;
  if (forced) {
    stage = forced;
  } else if (won) {
    stage = 'client';
  } else {
    stage = stageFromDealStage(p) || stageFromStatus(p);
  }

  if (lost) {
    const stopStage = isPipelineStage(p.pipeline_lost_at_stage) ? p.pipeline_lost_at_stage : stage;
    return {
      stage: stopStage,
      category: categoryOfStage(stopStage),
      lost: true,
      lostReason: (LOST_REASONS as string[]).includes(p.pipeline_lost_reason || '') ? (p.pipeline_lost_reason as LostReason) : null,
      risk: false,
      wonPendingFirstOrder: false,
    };
  }

  return {
    stage,
    category: categoryOfStage(stage),
    lost: false,
    lostReason: null,
    risk: p.pipeline_risk === true || p.status === 'orange',
    wonPendingFirstOrder: stage === 'client' && !p.first_order_confirmed_at,
  };
}

// Compteurs par étape (pour la barre de progression-filtre) + risque/perdus.
export interface PipelineCounts {
  byStage: Record<PipelineStage, number>;
  byCategory: Record<PipelineCategory, number>;
  risk: number;
  lost: number;
}

export function countPipeline(rows: PipelineSourceRow[]): PipelineCounts {
  const byStage = Object.fromEntries(PIPELINE_STAGE_KEYS.map((k) => [k, 0])) as Record<PipelineStage, number>;
  const byCategory: Record<PipelineCategory, number> = { prospect: 0, opportunite: 0, client: 0 };
  let risk = 0;
  let lost = 0;
  for (const row of rows) {
    const pos = derivePipelinePosition(row);
    if (pos.lost) {
      lost += 1;
      continue;
    }
    byStage[pos.stage] += 1;
    byCategory[pos.category] += 1;
    if (pos.risk) risk += 1;
  }
  return { byStage, byCategory, risk, lost };
}

// Colonnes « historiques » à écrire quand on force une étape à la main, pour
// que les crons et pages qui lisent encore status/deal_stage/is_won restent
// cohérents avec ce que le commercial voit sur la ligne de progression.
export function legacyColumnsForStage(stage: PipelineStage, nowIso: string): Record<string, any> {
  switch (stage) {
    case 'en_cours':
      return { status: 'jaune', status_updated_at: nowIso, deal_stage: null, deal_stage_updated_at: nowIso, is_won: false, is_lost: false, quote_requested_at: null };
    case 'en_bonne_voie':
      return { status: 'vert', status_updated_at: nowIso, deal_stage: null, deal_stage_updated_at: nowIso, is_won: false, is_lost: false, quote_requested_at: null };
    case 'rdv_obtenu':
      return { status: 'bleu', status_updated_at: nowIso, deal_stage: 'rdv_fait', deal_stage_updated_at: nowIso, is_won: false, is_lost: false, quote_requested_at: null };
    case 'proposition_demandee':
      return { status: 'bleu', status_updated_at: nowIso, deal_stage: 'rdv_fait', deal_stage_updated_at: nowIso, is_won: false, is_lost: false, quote_requested_at: nowIso };
    case 'en_negociation':
      return { status: 'bleu', status_updated_at: nowIso, deal_stage: 'en_negociation', deal_stage_updated_at: nowIso, is_won: false, is_lost: false };
    case 'client':
      return { deal_stage: 'signe', deal_stage_updated_at: nowIso, is_won: true, won_at: nowIso, is_lost: false, lost_at: null };
    default:
      return {};
  }
}
