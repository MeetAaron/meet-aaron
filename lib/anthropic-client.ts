// lib/anthropic-client.ts
// Point d'entrée UNIQUE pour appeler l'API Anthropic (Claude), à la place des
// fetch() directs qui étaient dispersés dans lib/aaron.ts, lib/sourcing.ts et
// plusieurs routes API. Deux raisons de centraliser :
//
// 1. Garde-fou de dépense : chaque société a un plafond mensuel (par défaut
//    20 €, configurable via companies.monthly_api_cap_usd) au-delà duquel les
//    appels Claude pour CETTE société sont bloqués plutôt que de continuer à
//    consommer de l'API sans limite (ex: une campagne de prospection en
//    boucle, ou un compte compromis qui spammerait le chat).
// 2. Fiabilité de la mesure : si on enregistrait l'usage à chaque site
//    d'appel séparément, il suffirait d'en oublier un pour que le plafond
//    devienne inexact silencieusement.
//
// Important : ceci reste une ESTIMATION de coût basée sur les tarifs publics
// de Claude Sonnet et sur les tokens renvoyés par l'API — ce n'est pas une
// facturation exacte. La source de vérité pour la facturation réelle reste
// console.anthropic.com (Anthropic peut avoir des tarifs différents selon le
// contrat). Ce garde-fou sert à éviter un dérapage, pas à facturer le client.

import { supabaseAdmin } from './supabase-admin';

const INPUT_COST_PER_MTOK_USD = 3;   // Claude Sonnet — $ par million de tokens en entrée
const OUTPUT_COST_PER_MTOK_USD = 15; // Claude Sonnet — $ par million de tokens en sortie
const DEFAULT_MONTHLY_CAP_USD = 20;

export class MonthlyCapExceededError extends Error {
  constructor(companyId: string) {
    super(`Plafond de dépense API mensuel atteint pour la société ${companyId}.`);
    this.name = 'MonthlyCapExceededError';
  }
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Un cap à `null` en base désactive volontairement le plafond pour cette
// société (ex: compte interne Open X) — distinct de "colonne absente/0".
async function getMonthlyCapUsd(companyId: string): Promise<number | null> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('monthly_api_cap_usd')
    .eq('id', companyId)
    .maybeSingle();

  if (!company) return DEFAULT_MONTHLY_CAP_USD;
  return company.monthly_api_cap_usd === undefined ? DEFAULT_MONTHLY_CAP_USD : company.monthly_api_cap_usd;
}

async function getCurrentMonthSpendUsd(companyId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('api_usage_monthly')
    .select('cost_usd')
    .eq('company_id', companyId)
    .eq('year_month', currentYearMonth())
    .maybeSingle();

  return data?.cost_usd || 0;
}

export async function isOverMonthlyCap(companyId: string): Promise<boolean> {
  const cap = await getMonthlyCapUsd(companyId);
  if (cap === null) return false; // plafond désactivé pour cette société
  const spend = await getCurrentMonthSpendUsd(companyId);
  return spend >= cap;
}

async function recordUsage(companyId: string, inputTokens: number, outputTokens: number) {
  const costUsd =
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK_USD + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK_USD;
  const yearMonth = currentYearMonth();
  const currentSpend = await getCurrentMonthSpendUsd(companyId);

  // Pas d'increment atomique côté DB (pas de RPC SQL dédiée) : sous un pic
  // d'appels strictement simultanés pour la même société, une petite fraction
  // du coût pourrait ne pas être comptée. Acceptable pour un garde-fou de
  // sécurité, pas pour une facturation exacte.
  await supabaseAdmin.from('api_usage_monthly').upsert(
    { company_id: companyId, year_month: yearMonth, cost_usd: currentSpend + costUsd },
    { onConflict: 'company_id,year_month' }
  );
}

// Remplace fetch('https://api.anthropic.com/v1/messages', ...) partout dans le
// code. `companyId` peut être null pour un appel qui n'est rattachable à
// aucune société (ne devrait normalement pas arriver côté produit) — dans ce
// cas, ni le plafond ni l'enregistrement d'usage ne s'appliquent : on
// préfère laisser passer l'appel plutôt que de bloquer une fonctionnalité par
// excès de prudence sur un cas qui ne devrait pas exister.
export async function callClaude(body: Record<string, any>, companyId: string | null): Promise<any> {
  if (companyId && (await isOverMonthlyCap(companyId))) {
    throw new MonthlyCapExceededError(companyId);
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erreur API Anthropic: ${errText}`);
  }

  const data = await response.json();

  if (companyId && data.usage) {
    await recordUsage(companyId, data.usage.input_tokens || 0, data.usage.output_tokens || 0);
  }

  return data;
}
