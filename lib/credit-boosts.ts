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
