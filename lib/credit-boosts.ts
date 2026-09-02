// lib/credit-boosts.ts
// Catalogue des boosts de crédits (décision Alex, 01/09/2026) et lecture de
// la réserve encore disponible.
//
// TARIFICATION — même équivalence que l'abonnement, à marge constante :
// l'abonnement Aaron délivre 20 crédits pour 30 €, soit 1,50 € le crédit
// (33 % de marge sur un crédit qui coûte ~1 € de budget API). Les boosts
// gardent EXACTEMENT ce ratio : pas de remise au volume, pour que la marge
// ne s'écroule pas sur les gros paniers — la valeur du gros palier est dans
// la capacité débloquée, pas dans le rabais.
//
// Un boost est une COUCHE au-dessus de l'abonnement : il n'entame pas les
// crédits inclus (qui restent étalés sur le mois) et court sur sa propre
// fenêtre d'un mois depuis l'achat. Voir migration_credit_boosts_2026-09-01.sql.

import { supabaseAdmin } from './supabase-admin';

// Budget API (USD) débloqué par crédit vendu. Le suivi de coût est en USD
// (tarifs Anthropic) alors que le prix de vente est en euros : on utilise le
// même taux prudent que DEFAULT_MONTHLY_CAP_USD dans lib/anthropic-client.ts
// (21,5 USD pour 20 crédits).
export const USD_PER_CREDIT = 21.5 / 20;

export interface BoostTier {
  id: string;
  credits: number;
  priceEur: number;
  labelKey: string;
  highlight?: boolean; // palier mis en avant
}

export const BOOST_TIERS: BoostTier[] = [
  { id: 'boost_20', credits: 20, priceEur: 30, labelKey: 'boost.tier20' },
  { id: 'boost_40', credits: 40, priceEur: 60, labelKey: 'boost.tier40', highlight: true },
  { id: 'boost_100', credits: 100, priceEur: 150, labelKey: 'boost.tier100' },
  { id: 'boost_250', credits: 250, priceEur: 375, labelKey: 'boost.tier250' },
];

export function boostTierById(id: string): BoostTier | null {
  return BOOST_TIERS.find((t) => t.id === id) || null;
}

export function capUsdForCredits(credits: number): number {
  return Math.round(credits * USD_PER_CREDIT * 100) / 100;
}

// Fin de validité d'un boost : 1 mois glissant depuis l'achat (et non la fin
// du mois calendaire — un boost acheté le 28 serait sinon perdu d'avance).
export function boostEndsAt(startsAt: Date): Date {
  const end = new Date(startsAt);
  end.setMonth(end.getMonth() + 1);
  return end;
}

export interface ActiveBoost {
  id: string;
  tier: string;
  credits: number;
  cap_usd: number;
  price_eur: number;
  starts_at: string;
  ends_at: string;
}

// Boosts encore actifs d'une société, du plus ancien au plus récent.
// Renvoie [] si la table n'existe pas encore (migration pas passée).
export async function listActiveBoosts(companyId: string): Promise<ActiveBoost[]> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('credit_boosts')
      .select('id, tier, credits, cap_usd, price_eur, starts_at, ends_at')
      .eq('company_id', companyId)
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso)
      .order('starts_at', { ascending: true });
    if (error) return [];
    return (data || []) as ActiveBoost[];
  } catch {
    return [];
  }
}

// ── Estimation de consommation d'une campagne ───────────────────────────────
//
// Sert à prévenir le commercial AVANT qu'il ne lance une campagne trop grosse
// pour ses crédits restants (décision Alex, 01/09/2026) — c'est le seul moment
// vraiment utile pour l'alerter : une fois la campagne partie, s'arrêter à
// mi-parcours laisse des prospects contactés une fois et jamais relancés,
// ce qui est pire que de ne pas les avoir contactés du tout.
//
// Coût moyen constaté par prospect démarché, en USD de budget API. Couvre la
// recherche de l'entreprise, la génération du premier email, et la marge de
// relances/réponses habituelle sur la durée de vie du contact. Volontairement
// prudent : mieux vaut surestimer et voir le commercial acheter un boost dont
// il n'avait pas strictement besoin que le laisser tomber en panne sèche au
// milieu d'une campagne.
export const ESTIMATED_USD_PER_PROSPECT = 0.35;

export function estimateCampaignCostUsd(targetCount: number): number {
  return Math.max(0, targetCount) * ESTIMATED_USD_PER_PROSPECT;
}

export interface CampaignBudgetCheck {
  estimated_usd: number;
  remaining_usd: number;
  sufficient: boolean;
  // Nombre de prospects réellement couverts par ce qu'il reste.
  covered_count: number;
}

export function checkCampaignBudget(targetCount: number, capUsd: number, spentUsd: number): CampaignBudgetCheck {
  const estimated = estimateCampaignCostUsd(targetCount);
  const remaining = Math.max(0, capUsd - spentUsd);
  return {
    estimated_usd: Math.round(estimated * 100) / 100,
    remaining_usd: Math.round(remaining * 100) / 100,
    sufficient: estimated <= remaining,
    covered_count: Math.floor(remaining / ESTIMATED_USD_PER_PROSPECT),
  };
}
