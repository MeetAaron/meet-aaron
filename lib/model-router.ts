// lib/model-router.ts
//
// Aiguilleur de modèles (plan « coûts et données » validé par Alex le
// 06/09/2026).
//
// Constat qui a déclenché ce fichier : tout l'app appelait Anthropic en dur,
// sur un seul modèle, pour des tâches dont l'exigence varie d'un facteur cent.
// Classer « je suis absent jusqu'au 15 » et écrire le premier email à un
// dirigeant ne demandent pas la même intelligence, et ne doivent donc pas
// coûter le même prix.
//
// Trois niveaux, choisis par le SENS de la tâche et jamais par un nom de
// modèle écrit dans le code appelant :
//
//   'cheap'    — tri, classification, extraction, normalisation, relances.
//                GPT-5.6 Luna (0,10 $ / 0,60 $ le million) quand OPENAI_API_KEY
//                est présente, sinon Claude Haiku 4.5 (1 $ / 5 $).
//   'standard' — premier email, vraie réponse humaine, avis de campagne.
//                Claude Sonnet 5 (2 $ / 10 $) — remplace Sonnet 4.6 (3 $ / 15 $),
//                soit −33 % à qualité au moins égale.
//   'deep'     — réservé : analyses longues. Sonnet 5 aujourd'hui.
//
// Règles non négociables inscrites ici plutôt que dans un document :
//   - AUCUN modèle hébergé hors UE/US n'est proposé. DeepSeek et Kimi
//     stockent en Chine et entraînent sur les contenus par défaut ; nos
//     emails contiennent des données personnelles de prospects européens, et
//     la politique Limited Use de Google interdit par ailleurs d'entraîner un
//     modèle sur des données Gmail. Ce n'est pas une question de prix : à
//     l'usage, Luna est de toute façon deux fois moins cher que DeepSeek.
//   - Tout est réversible par variable d'environnement, sans redéploiement de
//     code : AARON_CHEAP_PROVIDER=anthropic force le retour à Haiku.
//   - Toute panne du fournisseur bon marché retombe silencieusement sur
//     Anthropic. Un email non écrit coûte plus cher qu'un email écrit trop
//     cher.

import {
  callClaude,
  recordUsage,
  assertBudgetAllows,
  MonthlyCapExceededError,
  SubscriptionUnpaidError,
  type CreditModule,
} from './anthropic-client';

export type ModelTier = 'cheap' | 'standard' | 'deep';

// Modèles Anthropic par niveau. Un seul endroit à modifier quand une
// génération sort.
export const ANTHROPIC_MODEL_BY_TIER: Record<ModelTier, string> = {
  cheap: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  deep: 'claude-sonnet-5',
};

// Modèle OpenAI utilisé pour le niveau « cheap ». Surchargeable sans toucher
// au code (une nouvelle génération sort tous les trimestres).
const OPENAI_CHEAP_MODEL = process.env.OPENAI_CHEAP_MODEL || 'gpt-5.6-luna';

export function openAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.AARON_CHEAP_PROVIDER !== 'anthropic';
}

// Prix publics au 06/09/2026, en $ par million de tokens. Sert au décompte
// des crédits : un appel OpenAI doit débiter le client comme un appel
// Anthropic, sinon la jauge ment.
const OPENAI_PRICING_USD: Record<string, { input: number; output: number; cachedInput: number }> = {
  'gpt-5.6-luna': { input: 0.1, output: 0.6, cachedInput: 0.01 },
  'gpt-5.6-terra': { input: 1, output: 6, cachedInput: 0.1 },
};

export interface SimpleCallInput {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  // Format JSON strict attendu — utilisé par le triage des entrants.
  json?: boolean;
}

export interface SimpleCallResult {
  text: string;
  provider: 'openai' | 'anthropic';
  model: string;
}

// ── OpenAI ──────────────────────────────────────────────────────────────────
async function callOpenAi(
  input: SimpleCallInput,
  companyId: string | null,
  module: CreditModule,
  userId?: string | null
): Promise<SimpleCallResult> {
  // Plafonds AVANT dépense : la voie OpenAI ne passe pas par callClaude, donc
  // sans ce contrôle elle ignorerait complètement le plafond de la société
  // (corrigé le 08/09/2026, voir assertBudgetAllows).
  if (companyId) await assertBudgetAllows(companyId, module);

  const model = OPENAI_CHEAP_MODEL;
  const messages = [
    ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
    ...input.messages,
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: input.maxTokens || 512,
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Erreur API OpenAI: ${res.status} ${await res.text().catch(() => '')}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';

  // Décompte des crédits : on convertit le coût réel OpenAI en dollars, puis
  // on l'impute via recordUsage comme n'importe quel appel. Le multiplicateur
  // vaut le rapport entre le prix OpenAI et le prix Anthropic du modèle de
  // référence, pour que la comptabilité existante n'ait pas à connaître
  // OpenAI (voir recordUsage, lib/anthropic-client.ts).
  try {
    const usage = data?.usage || {};
    const cachedIn = usage.prompt_tokens_details?.cached_tokens || 0;
    const freshIn = Math.max(0, (usage.prompt_tokens || 0) - cachedIn);
    const out = usage.completion_tokens || 0;
    const price = OPENAI_PRICING_USD[model] || OPENAI_PRICING_USD['gpt-5.6-luna'];
    const costUsd =
      (freshIn / 1_000_000) * price.input +
      (cachedIn / 1_000_000) * price.cachedInput +
      (out / 1_000_000) * price.output;

    if (companyId) {
      // On impute le coût EXACT en le présentant comme un appel Haiku dont on
      // corrige le montant par un multiplicateur — c'est le seul point
      // d'entrée comptable existant, et ça évite de dupliquer la logique de
      // plafonds/boosts.
      const haiku = { input: 1, output: 5 };
      const asHaikuUsd = (freshIn / 1_000_000) * haiku.input + (out / 1_000_000) * haiku.output;
      const multiplier = asHaikuUsd > 0 ? costUsd / asHaikuUsd : 0;
      await recordUsage(
        companyId,
        'claude-haiku-4-5',
        { inputTokens: freshIn, outputTokens: out, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: cachedIn, webSearches: 0 },
        userId,
        multiplier
      );
    }
  } catch (err: any) {
    // Une erreur de comptabilité ne doit jamais faire échouer un envoi.
    console.error('Décompte OpenAI:', err?.message);
  }

  return { text, provider: 'openai', model };
}

// ── Anthropic ───────────────────────────────────────────────────────────────
async function callAnthropicSimple(
  input: SimpleCallInput,
  tier: ModelTier,
  companyId: string | null,
  module: CreditModule,
  userId?: string | null
): Promise<SimpleCallResult> {
  const model = ANTHROPIC_MODEL_BY_TIER[tier];
  const data = await callClaude(
    {
      model,
      max_tokens: input.maxTokens || 512,
      ...(input.system ? { system: input.system } : {}),
      messages: input.messages,
    },
    companyId,
    module,
    userId
  );
  const text = (data?.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
  return { text, provider: 'anthropic', model };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
// Appel texte simple, aiguillé par niveau. Les appels complexes (outils,
// cache 1 h, lots) restent sur callClaude directement : ils dépendent de
// fonctionnalités propres à Anthropic.
export async function callModel(
  tier: ModelTier,
  input: SimpleCallInput,
  companyId: string | null,
  module: CreditModule = 'ap',
  userId?: string | null
): Promise<SimpleCallResult> {
  if (tier === 'cheap' && openAiEnabled()) {
    try {
      return await callOpenAi(input, companyId, module, userId);
    } catch (err: any) {
      // Un refus de BUDGET n'est pas une panne OpenAI : se replier sur
      // Anthropic ferait juste échouer le même contrôle une seconde plus tard,
      // en laissant dans les logs un « OpenAI indisponible » trompeur. On
      // remonte tel quel.
      if (err instanceof MonthlyCapExceededError || err instanceof SubscriptionUnpaidError) throw err;
      // Repli silencieux : quota, panne, clé révoquée… Aaron continue.
      console.error('OpenAI indisponible, repli Anthropic :', err?.message);
    }
  }
  return callAnthropicSimple(input, tier, companyId, module, userId);
}
