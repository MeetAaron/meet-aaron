// lib/anthropic-client.ts
// Point d'entrée UNIQUE pour appeler l'API Anthropic (Claude), à la place des
// fetch() directs qui étaient dispersés dans lib/aaron.ts, lib/sourcing.ts et
// plusieurs routes API. Raisons de centraliser :
//
// 1. Garde-fou de dépense : chaque société a un plafond MENSUEL (par défaut
//    20 €, configurable via companies.monthly_api_cap_usd).
// 2. Lissage : un plafond mensuel seul ne "dose" pas — une grosse campagne de
//    prospection ou un pic d'usage pourrait consommer tout le budget du mois
//    en une seule journée. On ajoute donc un plafond QUOTIDIEN dérivé
//    (mensuel / DAILY_CAP_DIVISOR) : même si le mois entier n'est pas encore
//    consommé, on bloque pour la société si SA journée en cours dépasse cette
//    part. Ça garantit que le budget mensuel tient au moins DAILY_CAP_DIVISOR
//    jours d'usage intensif, même en cas de pic un jour donné.
//    Contrepartie assumée : un jour où le plafond quotidien est atteint,
//    Aaron peut cesser de répondre aux prospects pour CETTE société jusqu'au
//    lendemain (minuit UTC) — c'est le prix du lissage. Si ce compromis pose
//    problème, augmenter DAILY_CAP_DIVISOR (plafond quotidien plus généreux,
//    mais moins de protection contre un pic) ou le réduire (plus prudent).
// 3. Fiabilité de la mesure : si on enregistrait l'usage à chaque site
//    d'appel séparément, il suffirait d'en oublier un pour que les plafonds
//    deviennent inexacts silencieusement.
//
// Important : ceci reste une ESTIMATION de coût basée sur les tarifs publics
// de Claude Sonnet (en dollars) et sur les tokens renvoyés par l'API — pas une
// facturation exacte, et le plafond est configuré en euros alors que le coût
// réel est en dollars (écart de change ignoré, de l'ordre de quelques %). La
// source de vérité pour la facturation réelle reste console.anthropic.com. Ce
// garde-fou sert à éviter un dérapage, pas à facturer le client au centime.
//
// Crédits ("boost", décision produit du 14/08/2026 — voir lib/credits.ts) :
// une fois le plafond mensuel/quotidien inclus dans l'abonnement atteint, on
// ne bloque plus automatiquement une société qui a acheté des crédits — on
// laisse l'appel passer et on débite le coût réel de CET appel de son solde
// de crédits. Le blocage (MonthlyCapExceededError) n'intervient que si le
// solde de crédits est également épuisé.

import { supabaseAdmin } from './supabase-admin';
import { getCreditBalance, spendCredits, CreditModule } from './credits';

const INPUT_COST_PER_MTOK_USD = 3;   // Claude Sonnet — $ par million de tokens en entrée
const OUTPUT_COST_PER_MTOK_USD = 15; // Claude Sonnet — $ par million de tokens en sortie
const DEFAULT_MONTHLY_CAP_USD = 20;
const DAILY_CAP_DIVISOR = 15; // le budget mensuel doit tenir au moins 15 jours d'usage intensif

export class MonthlyCapExceededError extends Error {
  reason: 'monthly' | 'daily' | 'credits_exhausted';

  constructor(companyId: string, reason: 'monthly' | 'daily' | 'credits_exhausted' = 'monthly') {
    super(
      reason === 'daily'
        ? `Plafond de dépense API QUOTIDIEN atteint pour la société ${companyId} (protection anti-pic — le plafond mensuel, lui, n'est pas encore atteint). Réessayez demain, ou augmentez la part quotidienne dans lib/anthropic-client.ts.`
        : reason === 'credits_exhausted'
        ? `Plafond de dépense API atteint pour la société ${companyId}, et le solde de crédits achetés est épuisé (ou nul).`
        : `Plafond de dépense API mensuel atteint pour la société ${companyId}.`
    );
    this.name = 'MonthlyCapExceededError';
    this.reason = reason;
  }
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentDateUTC(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// Un cap à `null` en base désactive volontairement le plafond (mensuel ET
// quotidien) pour cette société (ex: compte interne Open X) — distinct de
// "colonne absente/0".
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

async function getCurrentDaySpendUsd(companyId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('api_usage_daily')
    .select('cost_usd')
    .eq('company_id', companyId)
    .eq('date', currentDateUTC())
    .maybeSingle();

  return data?.cost_usd || 0;
}

async function getBudgetStatus(companyId: string): Promise<{ exceeded: boolean; reason?: 'monthly' | 'daily' }> {
  const monthlyCap = await getMonthlyCapUsd(companyId);
  if (monthlyCap === null) return { exceeded: false }; // plafond désactivé pour cette société

  const monthSpend = await getCurrentMonthSpendUsd(companyId);
  if (monthSpend >= monthlyCap) return { exceeded: true, reason: 'monthly' };

  const dailyCap = monthlyCap / DAILY_CAP_DIVISOR;
  const daySpend = await getCurrentDaySpendUsd(companyId);
  if (daySpend >= dailyCap) return { exceeded: true, reason: 'daily' };

  return { exceeded: false };
}

function computeCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK_USD + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK_USD;
}

async function recordUsage(companyId: string, inputTokens: number, outputTokens: number) {
  const costUsd = computeCostUsd(inputTokens, outputTokens);

  // Pas d'increment atomique côté DB (pas de RPC SQL dédiée) : sous un pic
  // d'appels strictement simultanés pour la même société, une petite fraction
  // du coût pourrait ne pas être comptée sur l'une des deux tables (ou les
  // deux). Acceptable pour un garde-fou de sécurité, pas pour une facturation
  // exacte.
  const [currentMonthSpend, currentDaySpend] = await Promise.all([
    getCurrentMonthSpendUsd(companyId),
    getCurrentDaySpendUsd(companyId),
  ]);

  await Promise.all([
    supabaseAdmin.from('api_usage_monthly').upsert(
      { company_id: companyId, year_month: currentYearMonth(), cost_usd: currentMonthSpend + costUsd },
      { onConflict: 'company_id,year_month' }
    ),
    supabaseAdmin.from('api_usage_daily').upsert(
      { company_id: companyId, date: currentDateUTC(), cost_usd: currentDaySpend + costUsd },
      { onConflict: 'company_id,date' }
    ),
  ]);
}

// Remplace fetch('https://api.anthropic.com/v1/messages', ...) partout dans le
// code. `companyId` peut être null pour un appel qui n'est rattachable à
// aucune société (ne devrait normalement pas arriver côté produit) — dans ce
// cas, ni les plafonds ni l'enregistrement d'usage ne s'appliquent : on
// préfère laisser passer l'appel plutôt que de bloquer une fonctionnalité par
// excès de prudence sur un cas qui ne devrait pas exister.
//
// `module` (tâche #140) : optionnel, 'ap'|'as'|'ac'. Le plafond
// mensuel/quotidien inclus dans l'abonnement reste TOUJOURS transverse
// (partagé par toute la société, indépendamment du module) — seul le solde
// de crédits utilisé en dépassement change selon ce paramètre : omis, on
// utilise le pool général historique ; renseigné, on utilise le solde propre
// à ce module.
export async function callClaude(
  body: Record<string, any>,
  companyId: string | null,
  module?: CreditModule
): Promise<any> {
  let usingCredits = false;

  if (companyId) {
    const status = await getBudgetStatus(companyId);
    if (status.exceeded) {
      // Plafond inclus dans l'abonnement atteint : on continue quand même SI
      // la société a un solde de crédits ("boost", voir lib/credits.ts), en
      // débitant le coût réel de CET appel de ce solde. Sinon on bloque comme
      // avant.
      const creditBalance = await getCreditBalance(companyId, module);
      if (creditBalance <= 0) {
        throw new MonthlyCapExceededError(companyId, 'credits_exhausted');
      }
      usingCredits = true;
    }
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
    const inputTokens = data.usage.input_tokens || 0;
    const outputTokens = data.usage.output_tokens || 0;

    await recordUsage(companyId, inputTokens, outputTokens);

    if (usingCredits) {
      // Écart de change ignoré (coût calculé en $, crédits en €), comme
      // documenté plus haut pour le plafond mensuel — tolérance acceptée pour
      // un garde-fou, pas pour une facturation exacte.
      const costUsd = computeCostUsd(inputTokens, outputTokens);
      await spendCredits(companyId, costUsd, 'Appel API au-delà du plafond inclus dans l’abonnement', module);
    }
  }

  return data;
}

// Optimisation coût API (demande Alex, 28/08/2026 : "optimise le code pour
// minimiser mes coûts API sans que ça crée des erreurs") : point de coupure
// de "prompt caching" Anthropic (cache_control ephemeral) posé sur le
// DERNIER message d'un historique de conversation déjà construit — à utiliser
// juste avant d'y ajouter le nouveau tour de l'utilisateur (voir
// app/api/chat/route.ts, app/api/campaigns/chat/route.ts,
// app/api/crm-connections/custom-chat/route.ts, qui renvoient tout
// l'historique affiché à chaque message plutôt qu'un résumé). Convention
// Anthropic : un appel qui renvoie exactement ce même préfixe (même contenu,
// même point de coupure) dans les ~5 minutes qui suivent bénéficie d'un tarif
// réduit sur tout ce qui précède la coupure — seul le nouveau tour reste
// facturé plein tarif. Aucune incidence fonctionnelle si le cache a expiré
// ou n'a jamais été écrit (première réponse, conversation reprise après une
// pause...) : le comportement de l'appel est strictement identique, seul le
// coût/latence change selon que le cache est touché ou non — donc rien à
// craindre côté fiabilité en l'ajoutant largement sur les conversations
// multi-tours.
export function withCacheBreakpoint<T extends { role: string; content: any }>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const result = messages.slice();
  const last = result[result.length - 1];

  const blocks = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : Array.isArray(last.content)
    ? last.content.slice()
    : null;

  // Forme de contenu inattendue (ni string ni tableau de blocs) : on renvoie
  // l'historique tel quel plutôt que de risquer de casser l'appel pour un
  // simple gain de coût.
  if (!blocks || blocks.length === 0) return messages;

  const lastBlockIndex = blocks.length - 1;
  blocks[lastBlockIndex] = { ...blocks[lastBlockIndex], cache_control: { type: 'ephemeral' } };
  result[result.length - 1] = { ...last, content: blocks } as T;

  return result;
}
