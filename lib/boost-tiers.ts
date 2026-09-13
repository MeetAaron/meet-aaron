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
// Coût moyen par prospect démarché, en USD de budget API. Couvre la recherche
// de l'entreprise, la génération du premier email, les relances et la part
// habituelle de réponses traitées.
//
// RECALIBRÉ le 06/09/2026, après le lot d'optimisation. La valeur précédente
// (0,35 $) datait d'avant Sonnet 5, le cache 1 h, le Batch API, le pré-filtre
// des entrants et l'annuaire gratuit : elle disait à un utilisateur à 20 €/mois
// qu'il ne pouvait démarcher que 61 prospects, et surtout elle divisait
// d'autant le lot de sourcing quotidien (voir getPacing, prospectsAllowedToday
// dans lib/anthropic-client.ts). Autrement dit, une estimation trop prudente
// ne protégeait rien : elle bridait Aaron.
//
// Décomposition de la nouvelle valeur, aux prix du 06/09/2026 :
//   - recherche société : ~0,012 $ la première fois, ~0 ensuite
//     (company_research_cache, 90 jours, partagé entre tous les comptes)
//   - premier email, Sonnet 5 en lot avec cache 1 h : ~0,006 $
//   - trois relances sur l'étage bon marché : ~0,003 $
//   - tri des entrants : ~0,001 $
//   - vraies réponses (Sonnet 5), pondérées par le taux de réponse : ~0,005 $
//   → ~0,02 $ quand l'annuaire couvre la zone.
//
// On retient 0,10 $, soit cinq fois la mesure : la marge couvre le cas où
// l'annuaire ne couvre pas encore la zone et où le sourcing retombe sur la
// recherche web IA (~0,03 $ de recherches web par prospect). À re-mesurer sur
// les chiffres réels après les tests Open X et TeamSystem — c'est une
// estimation, pas une facture.
//
// 08/09/2026 — la valeur n'est plus posée à la main : elle DÉCOULE du quota de
// prospects vendu au client (voir PROSPECTS_PER_SEAT_PER_MONTH ci-dessous).
//
// 13/09/2026 — le quota passe de 300 à 150 : la valeur double donc toute
// seule (21,5 $ / 150 = ~0,143 $ par prospect), et c'est VOULU. Un prospect
// ne coûte plus ce qu'il coûtait : avec les séquences de relances
// (J0, J+3, J+8, J+15), il reçoit quatre emails rédigés au lieu d'un, et
// génère davantage de réponses entrantes à traiter. Diviser le quota par deux
// ne divise donc PAS la facture API par deux — elle reste du même ordre. Le
// calcul est déplacé sous PROSPECTS_PER_CREDIT pour qu'il suive
// automatiquement toute future révision du quota, au lieu du 15 codé en dur
// qui aurait menti dès aujourd'hui.
// (la constante elle-même est déclarée plus bas, juste après
// PROSPECTS_PER_CREDIT dont elle dépend — une const ne peut pas être lue
// avant sa ligne de déclaration.)

// ── Quota de prospects (décision Alex, 08/09/2026) ──────────────────────────
//
// Ce que le client achète, c'est un nombre de NOUVEAUX PROSPECTS par mois, pas
// des crédits : « les 300 sont la limite max, s'il crée 2 campagnes de 150
// c'est pareil, s'il en ajoute manuellement ça compte aussi ». Un commercial
// comprend « 150 prospects », il ne comprend pas « 20 crédits ».
//
// Les boosts gardent leurs produits Stripe existants (20/40/100/250 crédits)
// mais s'affichent et se comptent en prospects : 1 crédit = 15 prospects, donc
// le boost de base (20 credits) = +150 prospects = exactement un mois de
// siege en plus.
//
// 13/09/2026 — ATTENTION, arbitrage a trancher : le boost de base reste a
// 30 EUR pour ce qui est desormais 150 prospects, alors que l'abonnement les
// vend 59 EUR. Le boost revient donc a moitie prix pour le meme volume, et ne
// laisse que ~10 EUR de marge. Les prix Stripe des boosts doivent monter avec
// l'abonnement (39 / 78 / 195 / 487 EUR) au moment de recreer les produits sur
// le compte Stripe Australie. Le budget API sous-jacent (USD_PER_CREDIT) ne change pas —
// c'est la même valeur présentée dans l'unité que le client comprend.
//
// Ce qui compte dans le quota : tout prospect CRÉÉ dans le mois pour la
// société, quelle que soit la source (campagne, ajout manuel, import CSV).
// Voir lib/prospect-quota.ts pour le calcul et l'application.
// 13/09/2026 (objection du père d'Alex : « à 300 par mois, en six ou sept mois
// il n'y a plus personne à contacter dans le secteur »). Le quota passe à 150,
// et l'effort libéré part dans les RELANCES : quatre touches par prospect au
// lieu d'une seule. Un prospect travaillé quatre fois vaut mieux que deux
// prospects effleurés une fois — et la base du client dure deux fois plus
// longtemps.
export const PROSPECTS_PER_SEAT_PER_MONTH = 150;
export const PROSPECTS_PER_CREDIT = PROSPECTS_PER_SEAT_PER_MONTH / 20; // 7,5 — 20 crédits = un mois de siège

// Coût API estimé d'un prospect — voir le long commentaire plus haut.
export const ESTIMATED_USD_PER_PROSPECT = USD_PER_CREDIT / PROSPECTS_PER_CREDIT;

export function prospectsForTier(tier: BoostTier): number {
  return tier.credits * PROSPECTS_PER_CREDIT;
}

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
