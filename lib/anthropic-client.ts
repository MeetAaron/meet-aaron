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
import { getSubscriptionState } from './subscription-status';
// Module payant concerné par un appel (ap = Aaron Prospect, as = Aaron
// Opportunités, ac = Aaron Clients) — sert au suivi d'usage par module.
// Rapatrié ici le 01/09/2026 : c'était le dernier usage de lib/credits.ts,
// supprimé avec l'ancien système de solde de crédits.
export type CreditModule = 'ap' | 'as' | 'ac';

const INPUT_COST_PER_MTOK_USD = 3;   // Claude Sonnet — $ par million de tokens en entrée
const OUTPUT_COST_PER_MTOK_USD = 15; // Claude Sonnet — $ par million de tokens en sortie
// Docx Modifs Aaron (AJOUTS 30/08/26, item 2) : "la limite par mois PAR
// UTILISATEUR soit de 20 €. Pas dollars, euros. Et donc répartis sur 30
// jours." — le suivi de coût reste en USD (tarifs Anthropic), donc 20 € sont
// convertis avec un taux prudent (~1.075) : 21.5 USD ≈ 20 €. Le plafond de
// la société = cette base × son nombre d'utilisateurs (voir
// getMonthlyCapUsd) ; l'utilisateur, lui, ne voit jamais ces montants —
// uniquement des crédits (décision Alex, même item).
const DEFAULT_MONTHLY_CAP_USD = 21.5; // = 20 € par utilisateur et par mois
const DAILY_CAP_DIVISOR = 30; // "répartis sur 30 jours" : plafond quotidien = mensuel / 30
// Recherche web en direct pour Aaron (demande Alex, 29/08/2026 : "il peut
// utiliser cette fiche profil d'entreprise ainsi qu'internet") — tarif
// Anthropic pour l'outil web_search natif : 10 $ pour 1000 recherches, EN
// PLUS du coût normal des tokens (les résultats de recherche sont eux-mêmes
// facturés comme des tokens d'entrée classiques, déjà couverts par
// INPUT_COST_PER_MTOK_USD ci-dessus — seul le forfait par recherche est
// spécifique et doit être ajouté à part). Voir app/api/chat/route.ts pour
// l'outil lui-même (CHAT_WEB_SEARCH_TOOL) ; voir callClaude plus bas pour la
// lecture de usage.server_tool_use.web_search_requests dans la réponse.
const WEB_SEARCH_COST_PER_SEARCH_USD = 0.01;

// Abonnement impayé au-delà de la période de grâce (01/09/2026) : les
// fonctions d'IA sont suspendues, l'application reste consultable et aucune
// donnée n'est touchée. Voir lib/subscription-status.ts.
export class SubscriptionUnpaidError extends Error {
  constructor(companyId: string) {
    super(
      `Abonnement impayé pour la société ${companyId} : la période de grâce est écoulée. Les fonctions d'IA sont suspendues jusqu'à la régularisation du paiement.`
    );
    this.name = 'SubscriptionUnpaidError';
  }
}

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
//
// Docx Modifs Aaron (AJOUTS 30/08/26, item 2) : le plafond est PAR
// UTILISATEUR (20 €/mois chacun) — une société de 3 commerciaux paie 3
// abonnements et dispose donc de 3 × 20 € de budget API mensuel, partagé au
// niveau société (le suivi d'usage reste par société, inchangé). La valeur
// éventuellement configurée dans companies.monthly_api_cap_usd est elle
// aussi traitée comme une base PAR UTILISATEUR, pour garder une seule
// sémantique.
async function getMonthlyCapUsd(companyId: string): Promise<number | null> {
  const [{ data: company }, { count: userCount }] = await Promise.all([
    supabaseAdmin
      .from('companies')
      .select('monthly_api_cap_usd')
      .eq('id', companyId)
      .maybeSingle(),
    supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
  ]);

  const perUserCap = !company || company.monthly_api_cap_usd === undefined
    ? DEFAULT_MONTHLY_CAP_USD
    : company.monthly_api_cap_usd;
  if (perUserCap === null) return null; // plafond désactivé pour cette société

  return perUserCap * Math.max(1, userCount || 0);
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

// Boosts de crédits actifs (migration_credit_boosts_2026-09-01.sql).
//
// Un boost est une COUCHE au-dessus de l'abonnement : il ne touche pas aux
// crédits inclus, qui restent étalés sur le mois, et court sur sa PROPRE
// fenêtre d'un mois depuis son achat (un boost pris le 12 vaut jusqu'au 12
// du mois suivant, pas jusqu'au 31). Plusieurs boosts se cumulent.
//
// Renvoie 0 si la table n'existe pas encore (migration pas passée) : le
// plafond retombe simplement sur celui de l'abonnement, sans rien casser.
export async function getActiveBoostCapUsd(companyId: string): Promise<number> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('credit_boosts')
      .select('cap_usd')
      .eq('company_id', companyId)
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso);
    if (error) return 0;
    return (data || []).reduce((sum: number, row: any) => sum + Number(row.cap_usd || 0), 0);
  } catch {
    return 0;
  }
}

async function getBudgetStatus(companyId: string): Promise<{ exceeded: boolean; reason?: 'monthly' | 'daily' }> {
  const subscriptionCap = await getMonthlyCapUsd(companyId);
  if (subscriptionCap === null) return { exceeded: false }; // plafond désactivé pour cette société

  // Le boost s'ajoute au plafond mensuel ET au plafond quotidien : sans ça,
  // un commercial qui vient d'acheter un boost pour lancer une grosse
  // campagne resterait bloqué par la limite journalière de son abonnement —
  // exactement ce qu'il cherchait à débloquer en payant.
  const boostCap = await getActiveBoostCapUsd(companyId);
  const monthlyCap = subscriptionCap + boostCap;

  const monthSpend = await getCurrentMonthSpendUsd(companyId);
  if (monthSpend >= monthlyCap) return { exceeded: true, reason: 'monthly' };

  const dailyCap = monthlyCap / DAILY_CAP_DIVISOR;
  const daySpend = await getCurrentDaySpendUsd(companyId);
  if (daySpend >= dailyCap) return { exceeded: true, reason: 'daily' };

  return { exceeded: false };
}

function computeCostUsd(inputTokens: number, outputTokens: number, webSearches: number = 0): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK_USD +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK_USD +
    webSearches * WEB_SEARCH_COST_PER_SEARCH_USD
  );
}

// userId (01/09/2026) : optionnel. Quand l'appel est déclenché pour un
// commercial identifié (chat, email de prospection, devis…), on enregistre
// aussi sa part dans api_usage_user_monthly — c'est ce qui alimente la jauge
// de crédits par commercial dans Mon équipe. Les appels non rattachables
// (crons société) restent comptés au niveau société uniquement.
async function recordUsage(companyId: string, inputTokens: number, outputTokens: number, webSearches: number = 0, userId?: string | null) {
  const costUsd = computeCostUsd(inputTokens, outputTokens, webSearches);

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

  // Part du commercial — best-effort et jamais bloquant : si la migration
  // migration_api_usage_per_user_2026-09-01.sql n'est pas encore passée
  // (42P01 : table absente), on ignore silencieusement, l'appel API a déjà
  // eu lieu et le compteur société est à jour.
  if (userId) {
    try {
      const { data: existing } = await supabaseAdmin
        .from('api_usage_user_monthly')
        .select('cost_usd')
        .eq('user_id', userId)
        .eq('year_month', currentYearMonth())
        .maybeSingle();
      await supabaseAdmin.from('api_usage_user_monthly').upsert(
        {
          company_id: companyId,
          user_id: userId,
          year_month: currentYearMonth(),
          cost_usd: Number(existing?.cost_usd || 0) + costUsd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,year_month' }
      );
    } catch {
      // table absente ou indisponible : on n'alimente pas la jauge, c'est tout.
    }
  }
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
  module?: CreditModule,
  // userId (01/09/2026) : le commercial à qui imputer cet appel dans la
  // jauge de Mon équipe. Optionnel — omis pour les traitements société.
  userId?: string | null
): Promise<any> {

  if (companyId) {
    // Paiement en échec au-delà de la grâce de 7 jours : on s'arrête AVANT
    // de dépenser de l'API. Pendant la grâce, aiAllowed reste true et rien
    // ne change pour le client (voir lib/subscription-status.ts).
    const subscription = await getSubscriptionState(companyId);
    if (!subscription.aiAllowed) {
      throw new SubscriptionUnpaidError(companyId);
    }

    const status = await getBudgetStatus(companyId);
    if (status.exceeded) {
      // Plafond atteint — boosts actifs COMPRIS (getBudgetStatus additionne
      // déjà getActiveBoostCapUsd au plafond de l'abonnement). Il n'y a donc
      // plus rien à débiter en dernier recours : on bloque.
      //
      // 01/09/2026 : l'ancien mécanisme de solde (lib/credits.ts,
      // credit_balance_*_eur) qui prenait le relais ici a été retiré sur
      // décision d'Alex. Il faisait doublon avec les boosts et suivait une
      // logique différente (solde débité à l'appel, sans étalement ni date
      // de fin), ce qui rendait impossible d'expliquer simplement au client
      // ce qu'il lui restait.
      throw new MonthlyCapExceededError(companyId, 'credits_exhausted');
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
    // Nombre de recherches web réellement effectuées par Aaron sur CET appel
    // (l'outil web_search est "server-side" : Anthropic peut faire plusieurs
    // recherches en une seule requête, jusqu'à max_uses défini sur l'outil —
    // voir app/api/chat/route.ts) — 0 si l'outil n'a pas été utilisé sur ce
    // tour, ou pour tout appel qui ne l'a pas dans ses `tools`.
    const webSearches = data.usage.server_tool_use?.web_search_requests || 0;

    await recordUsage(companyId, inputTokens, outputTokens, webSearches, userId);

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
