// lib/credit-boosts.ts
// Accès base pour les boosts de crédits. RÉSERVÉ AU SERVEUR : ce module
// importe supabaseAdmin (service_role).
//
// Le catalogue et les fonctions pures vivent dans lib/boost-tiers.ts et sont
// ré-exportés ici pour ne casser aucun import existant côté serveur. Un
// composant client doit importer depuis '@/lib/boost-tiers' — voir
// l'explication du bug de page blanche en tête de ce fichier-là.

import { supabaseAdmin } from './supabase-admin';

export {
  USD_PER_CREDIT,
  BOOST_TIERS,
  boostTierById,
  capUsdForCredits,
  boostEndsAt,
  ESTIMATED_USD_PER_PROSPECT,
  estimateCampaignCostUsd,
  checkCampaignBudget,
} from './boost-tiers';
export type { BoostTier, CampaignBudgetCheck } from './boost-tiers';

export interface ActiveBoost {
  id: string;
  tier: string;
  credits: number;
  cap_usd: number;
  price_eur: number;
  starts_at: string;
  ends_at: string;
  // Consommation réelle (migration_credit_boosts_consumed_2026-09-05.sql).
  consumed_usd: number;
  remaining_usd: number;
}

// Boosts encore UTILISABLES d'une société, du plus ancien au plus récent :
// tout boost déjà commencé dont il reste du budget, quelle que soit sa date
// de fin (décision Alex 05/09/2026 : « le client a payé pour le boost donc il
// aura jusqu'au dernier crédit » — le reste d'un boost se consomme les jours
// d'après, il n'expire pas). ends_at n'est plus qu'une date visée : Aaron
// essaie de tout consommer avant, voir getPacing dans lib/anthropic-client.
// Renvoie [] si la table n'existe pas encore (migration pas passée).
export async function listActiveBoosts(companyId: string): Promise<ActiveBoost[]> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('credit_boosts')
      .select('id, tier, credits, cap_usd, price_eur, starts_at, ends_at, consumed_usd')
      .eq('company_id', companyId)
      .lte('starts_at', nowIso)
      .order('starts_at', { ascending: true });
    if (error) return [];
    return (data || [])
      .map((b: any) => {
        const consumed = Number(b.consumed_usd || 0);
        const cap = Number(b.cap_usd || 0);
        return { ...b, cap_usd: cap, consumed_usd: consumed, remaining_usd: Math.max(0, cap - consumed) } as ActiveBoost;
      })
      .filter((b) => b.remaining_usd > 0.005);
  } catch {
    return [];
  }
}

// Budget de boost encore disponible (somme des restes).
export async function getBoostRemainingUsd(companyId: string): Promise<number> {
  const boosts = await listActiveBoosts(companyId);
  return boosts.reduce((sum, b) => sum + b.remaining_usd, 0);
}

// Impute `usd` de dépense aux boosts, du plus ancien au plus récent (celui
// acheté en premier s'épuise en premier — c'est aussi celui dont la date
// visée est la plus proche). Appelé par recordUsage (lib/anthropic-client)
// pour la part d'un appel qui dépasse l'abonnement du mois. Best-effort :
// pas d'incrément atomique, même compromis que les compteurs d'usage.
export async function consumeBoosts(companyId: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  let left = usd;
  const boosts = await listActiveBoosts(companyId);
  for (const b of boosts) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining_usd);
    const { error } = await supabaseAdmin
      .from('credit_boosts')
      .update({ consumed_usd: Math.round((b.consumed_usd + take) * 10000) / 10000 })
      .eq('id', b.id);
    if (error) return; // colonne absente (migration pas passée) : on n'insiste pas
    left -= take;
  }
}
