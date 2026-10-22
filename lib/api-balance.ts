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

export interface BalanceStatus {
  configured: boolean;
  snapshotId: string | null;
  balanceUsd: number | null;
  asOf: string | null;
  spentSinceUsd: number;
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

export async function getBalanceStatus(): Promise<BalanceStatus> {
  const now = new Date();
  const today = isoDay(now);
  const weekAgo = isoDay(new Date(now.getTime() - 7 * 86400000));
  const avgDailyUsd = (await sumUsageSince(weekAgo, today)) / 7;

  const { data: snap, error } = await supabaseAdmin
    .from('api_balance_snapshots')
    .select('id, balance_usd, as_of, alerted_10_at, alerted_3_at')
    .eq('provider', 'anthropic')
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !snap) {
    return {
      configured: false, snapshotId: null, balanceUsd: null, asOf: null, spentSinceUsd: 0,
      remainingUsd: null, avgDailyUsd, daysLeft: null, alerted10At: null, alerted3At: null,
    };
  }

  const spentSinceUsd = await sumUsageSince(isoDay(new Date(snap.as_of)));
  const balanceUsd = Number(snap.balance_usd) || 0;
  const remainingUsd = balanceUsd - spentSinceUsd;
  const daysLeft = avgDailyUsd > 0 ? Math.max(0, remainingUsd) / avgDailyUsd : null;
  return {
    configured: true,
    snapshotId: snap.id,
    balanceUsd,
    asOf: snap.as_of,
    spentSinceUsd,
    remainingUsd,
    avgDailyUsd,
    daysLeft,
    alerted10At: snap.alerted_10_at || null,
    alerted3At: snap.alerted_3_at || null,
  };
}
