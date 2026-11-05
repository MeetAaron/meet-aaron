// lib/api-balance.ts
// ALERTE DE RECHARGE DU COMPTE ANTHROPIC (22/10/2026, option A validée par
// Alex — voir claude/a-reprendre-plus-tard.md, chantier 2).
//
// Le risque : le solde Anthropic d'Alex sert TOUS les clients à la fois. S'il
// tombe à zéro, Aaron s'arrête partout en même temps — la panne la plus
// grave possible, et rien ne la surveillait.
//
// Il n'existe pas d'API publique du solde restant (vérifié le 09/10/2026).
// Alex saisit donc, dans sa vue fondateur /app/marge, le solde affiché par la
// console Anthropic (après chaque recharge). On en déduit :
//   reste = solde saisi − dépense comptée depuis cette saisie
//   autonomie = reste ÷ dépense moyenne des 7 derniers jours complets
// La dépense vient de api_usage_daily (toutes sociétés). Elle inclut la petite
// part OpenAI quand OPENAI_API_KEY est posée : l'estimation est donc
// PRUDENTE (elle surestime légèrement la dépense Anthropic), ce qu'on veut
// pour une alerte. Le jour de la saisie est compté en entier : même logique.

import { supabaseAdmin } from './supabase-admin';
import { realSpendSince, adminApiConfigured, adminLastError } from './anthropic-admin';
import {
  realSpendSince as openAiRealSpendSince,
  openAiAdminConfigured,
  openAiAdminLastError,
} from './openai-admin';

// Deux fournisseurs depuis le 03/11/2026 : Aaron envoie le palier « cheap »
// chez OpenAI quand OPENAI_API_KEY est posée (c'est le cas en production).
// Chaque fournisseur a son solde, sa dépense et ses alertes.
export type BalanceProvider = 'anthropic' | 'openai';

export const BALANCE_PROVIDERS: BalanceProvider[] = ['anthropic', 'openai'];

export const PROVIDER_LABELS: Record<BalanceProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export const PROVIDER_CONSOLES: Record<BalanceProvider, string> = {
  anthropic: 'https://platform.claude.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
};

export interface BalanceStatus {
  provider: BalanceProvider;
  configured: boolean;
  snapshotId: string | null;
  balanceUsd: number | null;
  asOf: string | null;
  spentSinceUsd: number;
  // 'anthropic' = dépense réelle lue chez Anthropic ; 'estimation' = calcul
  // maison, volontairement prudent donc légèrement surestimé. Affiché au
  // fondateur : une alerte fondée sur une estimation ne se lit pas comme une
  // alerte fondée sur la facture.
  spentSource: 'fournisseur' | 'estimation';
  // La clé d'administration est-elle POSÉE ? (jamais sa valeur, juste oui/non)
  // Ajouté le 03/11/2026 : sans ça, « dépense estimée » peut vouloir dire deux
  // choses très différentes — clé absente, ou clé présente mais appel en
  // échec — et on ne peut pas savoir laquelle sans lire les journaux Vercel.
  adminKeyPresent: boolean;
  // Dernière erreur de lecture chez le fournisseur (statut HTTP + début du
  // corps), ou null. Réservé à l'écran fondateur.
  adminLastError: string | null;
  // true = on ne sait PAS combien a été dépensé (clé d'administration
  // absente ou API muette) et aucun repli crédible n'existe. Dans ce cas on
  // n'annonce ni reste ni autonomie : un chiffre inventé est pire que pas de
  // chiffre, c'est toute la leçon du 31/10/2026.
  spendUnknown: boolean;
  // Ancienneté du solde saisi, en jours. Au-delà de STALE_AFTER_DAYS, le
  // chiffre « il reste X » n'a plus de sens : un rechargement a pu avoir lieu
  // sans être ressaisi, ce qui est exactement ce qui a produit la fausse
  // alerte du 31/10/2026 (1,43 $ annoncés, 9,48 $ réels).
  balanceAgeDays: number | null;
  stale: boolean;
  remainingUsd: number | null;
  avgDailyUsd: number;
  daysLeft: number | null;
  alerted10At: string | null;
  alerted3At: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function sumUsageSince(fromDay: string, toDayExclusive?: string): Promise<number> {
  let total = 0;
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    let q = supabaseAdmin.from('api_usage_daily').select('cost_usd').gte('date', fromDay);
    if (toDayExclusive) q = q.lt('date', toDayExclusive);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error || !data) break;
    for (const row of data) total += Number((row as any).cost_usd) || 0;
    if (data.length < pageSize) break;
  }
  return total;
}

// Au-delà de ce délai sans nouvelle saisie, on cesse d'annoncer un chiffre.
// Un solde faux est pire que pas de solde : il fait paniquer, puis il fait
// ignorer l'alerte suivante.
const STALE_AFTER_DAYS = 10;

export async function getBalanceStatus(
  provider: BalanceProvider = 'anthropic'
): Promise<BalanceStatus> {
  const now = new Date();
  const today = isoDay(now);
  const weekAgo = isoDay(new Date(now.getTime() - 7 * 86400000));

  const { data: snap, error } = await supabaseAdmin
    .from('api_balance_snapshots')
    .select('id, balance_usd, as_of, alerted_10_at, alerted_3_at')
    .eq('provider', provider)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !snap) {
    return {
      provider, configured: false, snapshotId: null, balanceUsd: null, asOf: null,
      spentSinceUsd: 0, spentSource: 'estimation', spendUnknown: false,
      adminKeyPresent: provider === 'anthropic' ? adminApiConfigured() : openAiAdminConfigured(),
      adminLastError: provider === 'anthropic' ? adminLastError() : openAiAdminLastError(),
      balanceAgeDays: null, stale: false, remainingUsd: null, avgDailyUsd: 0,
      daysLeft: null, alerted10At: null, alerted3At: null,
    };
  }

  // Dépense réelle d'abord, estimation maison en repli. L'estimation
  // surestime volontairement par prudence : sur plusieurs jours, l'écart
  // cumulé suffit à annoncer un solde presque vide alors qu'il ne l'est pas.
  const asOfDate = new Date(snap.as_of);

  // Dépense réelle chez le fournisseur d'abord. Pour Anthropic, l'estimation
  // maison reste un repli acceptable (elle surestime par prudence). Pour
  // OpenAI il n'y a PAS de repli : api_usage_daily additionne les deux
  // fournisseurs, donc s'en servir pour OpenAI attribuerait à OpenAI la
  // dépense Anthropic. Mieux vaut dire « je ne sais pas ».
  const realSpend =
    provider === 'anthropic'
      ? adminApiConfigured()
        ? await realSpendSince(asOfDate)
        : null
      : openAiAdminConfigured()
        ? await openAiRealSpendSince(asOfDate)
        : null;

  const spendUnknown = realSpend === null && provider !== 'anthropic';
  const spentSinceUsd = realSpend !== null
    ? realSpend
    : spendUnknown
      ? 0
      : await sumUsageSince(isoDay(asOfDate));
  const spentSource: 'fournisseur' | 'estimation' = realSpend !== null ? 'fournisseur' : 'estimation';

  // Rythme quotidien : chez le fournisseur quand on l'a, sinon l'estimation
  // maison (Anthropic seulement, même raison que ci-dessus).
  const avgDailyUsd = spendUnknown ? 0 : (await sumUsageSince(weekAgo, today)) / 7;

  const balanceUsd = Number(snap.balance_usd) || 0;
  const balanceAgeDays = Math.max(0, Math.floor((Date.now() - asOfDate.getTime()) / 86400000));
  const stale = balanceAgeDays > STALE_AFTER_DAYS;

  // Solde périmé : on n'annonce plus ni reste ni autonomie. L'écran et
  // l'alerte diront « solde à revérifier » au lieu d'un chiffre inventé.
  const remainingUsd = stale || spendUnknown ? null : balanceUsd - spentSinceUsd;
  const daysLeft =
    remainingUsd !== null && avgDailyUsd > 0 ? Math.max(0, remainingUsd) / avgDailyUsd : null;

  return {
    provider,
    configured: true,
    spendUnknown,
    adminKeyPresent: provider === 'anthropic' ? adminApiConfigured() : openAiAdminConfigured(),
    adminLastError: provider === 'anthropic' ? adminLastError() : openAiAdminLastError(),
    snapshotId: snap.id,
    balanceUsd,
    asOf: snap.as_of,
    spentSinceUsd,
    spentSource,
    balanceAgeDays,
    stale,
    remainingUsd,
    avgDailyUsd,
    daysLeft,
    alerted10At: snap.alerted_10_at || null,
    alerted3At: snap.alerted_3_at || null,
  };
}
