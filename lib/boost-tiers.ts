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

// ── Devise selon le pays de l'entreprise ────────────────────────────────────
//
// Demande Alex (04/09/2026) : « quand l'utilisateur paye un abonnement ou un
// boost, la monnaie doit dépendre de son entreprise (€ si entreprise en
// europe, aud si australie, etc.) ».
//
// Ce ne sont PAS des conversions de change : ce sont des prix commerciaux
// arrêtés par devise, arrondis pour être lisibles en rayon. Un taux de change
// appliqué en direct donnerait « 49,73 AUD » et changerait tous les jours —
// personne ne vend comme ça. Ils sont donc à revoir à la main de temps en
// temps, pas à recalculer.
//
// Le pays vient de l'adresse de facturation Stripe enregistrée au premier
// paiement (companies.billing_country, voir
// migration_billing_country_2026-09-04.sql et le webhook Stripe). Tant qu'on
// ne le connaît pas, l'euro sert de repli.
export type BoostCurrency = 'eur' | 'aud' | 'usd' | 'gbp' | 'cad' | 'chf' | 'nzd';

const EUROZONE = [
  'AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'HR', 'MC', 'AD',
];

export function currencyForCountry(country?: string | null): BoostCurrency {
  const c = (country || '').trim().toUpperCase();
  if (c === 'AU') return 'aud';
  if (c === 'NZ') return 'nzd';
  if (c === 'GB') return 'gbp';
  if (c === 'US') return 'usd';
  if (c === 'CA') return 'cad';
  if (c === 'CH' || c === 'LI') return 'chf';
  if (EUROZONE.includes(c)) return 'eur';
  return 'eur';
}

// Prix par palier et par devise, dans l'ordre des BOOST_TIERS
// (20 / 40 / 100 / 250 crédits).
const PRICE_TABLE: Record<BoostCurrency, number[]> = {
  eur: [30, 60, 150, 375],
  aud: [50, 100, 250, 625],
  usd: [35, 70, 175, 435],
  gbp: [26, 52, 130, 325],
  cad: [45, 90, 225, 560],
  chf: [30, 60, 150, 375],
  nzd: [55, 110, 275, 685],
};

export const CURRENCY_SYMBOLS: Record<BoostCurrency, string> = {
  eur: '€',
  aud: 'A$',
  usd: '$',
  gbp: '£',
  cad: 'C$',
  chf: 'CHF',
  nzd: 'NZ$',
};

export function boostPrice(tierId: string, currency: BoostCurrency): number {
  const index = BOOST_TIERS.findIndex((t) => t.id === tierId);
  if (index < 0) return 0;
  const table = PRICE_TABLE[currency] || PRICE_TABLE.eur;
  return table[index] ?? BOOST_TIERS[index].priceEur;
}

export function formatBoostPrice(amount: number, currency: BoostCurrency): string {
  const symbol = CURRENCY_SYMBOLS[currency] || '€';
  // L'euro et le franc se lisent « 30 € » ; les devises à préfixe se lisent
  // « A$50 ». On respecte l'usage de chacune plutôt qu'un format unique.
  return currency === 'eur' || currency === 'chf' ? `${amount} ${symbol}` : `${symbol}${amount}`;
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
