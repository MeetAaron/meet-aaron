// lib/boost-tiers.ts
// Catalogue des boosts de crédits — CONSTANTES PURES, sans aucune dépendance.
//
// Séparé de lib/credit-boosts.ts le 03/09/2026 après un bug bloquant : la page
// Mon compte (composant client) importait BOOST_TIERS depuis credit-boosts.ts,
// qui importe supabaseAdmin — le client Supabase à service_role, réservé au
// serveur. Ce simple import tirait le module admin dans le bundle navigateur,
// où SUPABASE_SERVICE_ROLE_KEY n'existe pas : le module levait une exception à
// l'import et TOUTE la page restait blanche.
//
// Règle à retenir : tout ce qu'un composant `'use client'` importe doit être
// exempt de dépendance serveur. Ce fichier ne contient donc que des données et
// des fonctions pures ; les accès base vivent dans lib/credit-boosts.ts.
//
// TARIFICATION (décision Alex, 01/09/2026) — même équivalence que
// l'abonnement, à marge constante : l'abonnement délivre 20 crédits pour 30 €,
// soit 1,50 € le crédit (33 % de marge sur un crédit qui coûte ~1 € de budget
// API). Les boosts gardent EXACTEMENT ce ratio : pas de remise au volume, pour
// que la marge ne s'écroule pas sur les gros paniers — la valeur du gros
// palier est dans la capacité débloquée, pas dans un rabais.

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

// ── Estimation de consommation d'une campagne ───────────────────────────────
//
// Coût moyen constaté par prospect démarché, en USD de budget API. Couvre la
// recherche de l'entreprise, la génération du premier email, et la marge de
// relances/réponses habituelle. Volontairement prudent : mieux vaut
// surestimer que laisser une campagne tomber en panne sèche à mi-parcours.
export const ESTIMATED_USD_PER_PROSPECT = 0.35;

export function estimateCampaignCostUsd(targetCount: number): number {
  return Math.max(0, targetCount) * ESTIMATED_USD_PER_PROSPECT;
}

export interface CampaignBudgetCheck {
  estimated_usd: number;
  remaining_usd: number;
  sufficient: boolean;
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
