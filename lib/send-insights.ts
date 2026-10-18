// lib/send-insights.ts
// « Aaron apprend de tes résultats » (validé par Alex le 18/10/2026).
//
// Aujourd'hui tout le monde envoie dans la même fenêtre (lun→ven 8 h–12 h,
// lib/send-window.ts). Ce module regarde ce qui se passe RÉELLEMENT sur un
// compte : pour chaque email sortant des 90 derniers jours, l'heure et le
// jour d'envoi (heure locale du commercial) et si une réponse est arrivée
// dans les 7 jours. On en tire un taux de réponse par tranche horaire et par
// jour, comparé à la moyenne du compte (« lift »). Quand une tranche sort du
// lot avec assez de volume, elle devient le créneau appris du compte :
// Aaron y concentre ses envois, et Mes résultats le dit en clair.
//
// Garde-fous, parce qu'un petit échantillon raconte n'importe quoi :
//   - au moins MIN_SAMPLE envois sur la période, sinon pas d'apprentissage ;
//   - une tranche n'est retenue qu'avec MIN_BUCKET envois et un lift ≥ MIN_LIFT ;
//   - le créneau appris reste dans 7 h–19 h, lundi→vendredi (on n'apprend
//     jamais à envoyer le dimanche soir, même si deux réponses y sont arrivées).
// Aucune table nouvelle n'est lue : messages, conversations, prospects.
// Résultat écrit dans send_insights (migration_apprentissage_envois_2026-10-18.sql).

import { supabaseAdmin } from './supabase-admin';
import { resolveUserTimeZone, localParts } from './user-timezone';

export const WINDOW_DAYS = 90;
export const REPLY_WITHIN_DAYS = 7;
export const MIN_SAMPLE = 40;
export const MIN_BUCKET = 15;
export const MIN_LIFT = 1.25;

export const HOUR_BUCKETS: { key: string; from: number; to: number }[] = [
  { key: '5-8', from: 5, to: 8 },
  { key: '8-10', from: 8, to: 10 },
  { key: '10-12', from: 10, to: 12 },
  { key: '12-14', from: 12, to: 14 },
  { key: '14-17', from: 14, to: 17 },
  { key: '17-20', from: 17, to: 20 },
  { key: 'autre', from: 20, to: 29 }, // 20 h → 5 h
];

export interface BucketStat {
  bucket?: string;
  weekday?: number;
  sent: number;
  replied: number;
  rate: number;
  lift: number | null;
}

export interface LearnedWindow {
  hours: [number, number][]; // tranches [from, to) locales retenues, fusionnées
  weekdays: number[]; // 1 = lundi … 7 = dimanche
}

export interface SendInsights {
  user_id: string;
  computed_at: string;
  window_days: number;
  sample_size: number;
  overall_reply_rate: number | null;
  by_hour: BucketStat[];
  by_weekday: BucketStat[];
  learned_window: LearnedWindow | null;
  timezone: string | null;
}

function bucketForHour(h: number): string {
  if (h < 5) return 'autre';
  for (const b of HOUR_BUCKETS) if (h >= b.from && h < b.to) return b.key;
  return 'autre';
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export async function computeSendInsightsForUser(userId: string, now: Date = new Date()): Promise<SendInsights> {
  let tzRes: any = await supabaseAdmin.from('users').select('timezone, billing_country').eq('id', userId).maybeSingle();
  if (tzRes.error?.code === '42703') tzRes = { data: {} };
  const tz = resolveUserTimeZone(tzRes.data || {});

  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data: prospects } = await supabaseAdmin.from('prospects').select('id').eq('assigned_user_id', userId);
  const prospectIds = (prospects || []).map((p) => p.id);

  const empty: SendInsights = {
    user_id: userId,
    computed_at: now.toISOString(),
    window_days: WINDOW_DAYS,
    sample_size: 0,
    overall_reply_rate: null,
    by_hour: [],
    by_weekday: [],
    learned_window: null,
    timezone: tz,
  };
  if (prospectIds.length === 0) return empty;

  const { data: conversations } = await supabaseAdmin.from('conversations').select('id').in('prospect_id', prospectIds);
  const convIds = (conversations || []).map((c) => c.id);
  if (convIds.length === 0) return empty;

  // Les réponses peuvent arriver jusqu'à 7 jours après la fin de fenêtre
  // d'envoi — on lit les messages jusqu'à maintenant, sans borne haute.
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, direction, sent_at')
    .in('conversation_id', convIds)
    .gte('sent_at', since.toISOString())
    .order('sent_at', { ascending: true })
    .limit(10000);

  const inboundByConv = new Map<string, number[]>();
  const outbound: { conv: string; at: number }[] = [];
  for (const m of messages || []) {
    if (!m.sent_at) continue;
    const t = new Date(m.sent_at).getTime();
    if (m.direction === 'inbound') {
      const list = inboundByConv.get(m.conversation_id) || [];
      list.push(t);
      inboundByConv.set(m.conversation_id, list);
    } else if (m.direction === 'outbound') {
      // Un envoi des 7 derniers jours n'a pas encore eu sa chance de
      // réponse : on l'exclut pour ne pas tirer les taux vers le bas.
      if (now.getTime() - t < REPLY_WITHIN_DAYS * 24 * 60 * 60 * 1000) continue;
      outbound.push({ conv: m.conversation_id, at: t });
    }
  }

  const hourStats = new Map<string, { sent: number; replied: number }>();
  const dayStats = new Map<number, { sent: number; replied: number }>();
  let sent = 0;
  let replied = 0;
  for (const o of outbound) {
    const { hour, weekday } = localParts(new Date(o.at), tz);
    const b = bucketForHour(hour);
    const ins = inboundByConv.get(o.conv) || [];
    const gotReply = ins.some((t) => t > o.at && t <= o.at + REPLY_WITHIN_DAYS * 24 * 60 * 60 * 1000);
    sent += 1;
    if (gotReply) replied += 1;
    const hs = hourStats.get(b) || { sent: 0, replied: 0 };
    hs.sent += 1;
    if (gotReply) hs.replied += 1;
    hourStats.set(b, hs);
    const ds = dayStats.get(weekday) || { sent: 0, replied: 0 };
    ds.sent += 1;
    if (gotReply) ds.replied += 1;
    dayStats.set(weekday, ds);
  }

  const overall = sent > 0 ? replied / sent : null;
  const lift = (rate: number) => (overall && overall > 0 ? Math.round((rate / overall) * 100) / 100 : null);

  const by_hour: BucketStat[] = HOUR_BUCKETS.map((b) => {
    const s = hourStats.get(b.key) || { sent: 0, replied: 0 };
    const rate = s.sent > 0 ? s.replied / s.sent : 0;
    return { bucket: b.key, sent: s.sent, replied: s.replied, rate: Math.round(rate * 10000) / 10000, lift: s.sent > 0 ? lift(rate) : null };
  });
  const by_weekday: BucketStat[] = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const s = dayStats.get(d) || { sent: 0, replied: 0 };
    const rate = s.sent > 0 ? s.replied / s.sent : 0;
    return { weekday: d, sent: s.sent, replied: s.replied, rate: Math.round(rate * 10000) / 10000, lift: s.sent > 0 ? lift(rate) : null };
  });

  let learned_window: LearnedWindow | null = null;
  if (sent >= MIN_SAMPLE && overall && overall > 0) {
    const goodHours = HOUR_BUCKETS.filter((b) => {
      const st = by_hour.find((x) => x.bucket === b.key)!;
      return b.key !== 'autre' && b.from >= 7 && b.to <= 19 && st.sent >= MIN_BUCKET && (st.lift || 0) >= MIN_LIFT;
    }).map((b) => [b.from, b.to] as [number, number]);
    const goodDays = by_weekday
      .filter((d) => (d.weekday as number) <= 5 && d.sent >= MIN_BUCKET && (d.lift || 0) >= MIN_LIFT)
      .map((d) => d.weekday as number);
    if (goodHours.length > 0 || goodDays.length > 0) {
      learned_window = {
        hours: goodHours.length > 0 ? mergeRanges(goodHours) : [[8, 12]],
        weekdays: goodDays.length > 0 ? goodDays : [1, 2, 3, 4, 5],
      };
    }
  }

  return {
    user_id: userId,
    computed_at: now.toISOString(),
    window_days: WINDOW_DAYS,
    sample_size: sent,
    overall_reply_rate: overall === null ? null : Math.round(overall * 10000) / 10000,
    by_hour,
    by_weekday,
    learned_window,
    timezone: tz,
  };
}

export async function saveSendInsights(ins: SendInsights): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.from('send_insights').upsert(
    {
      user_id: ins.user_id,
      computed_at: ins.computed_at,
      window_days: ins.window_days,
      sample_size: ins.sample_size,
      overall_reply_rate: ins.overall_reply_rate,
      by_hour: ins.by_hour,
      by_weekday: ins.by_weekday,
      learned_window: ins.learned_window,
      timezone: ins.timezone,
    },
    { onConflict: 'user_id' }
  );
  // Table absente (migration pas jouée) : on ne fait rien, sans bruit.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { ok: false, error: 'table_missing' };
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function getSendInsights(userId: string): Promise<SendInsights | null> {
  const { data, error } = await supabaseAdmin.from('send_insights').select('*').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return data as SendInsights;
}

// Créneau appris, lu par lib/send-window.ts. null = créneau par défaut.
// Lecture légère (une ligne), appelée au plus une fois par commercial et
// par passage de cron.
export async function getLearnedWindow(userId: string): Promise<LearnedWindow | null> {
  const ins = await getSendInsights(userId);
  const lw = ins?.learned_window;
  if (!lw || !Array.isArray(lw.hours) || !Array.isArray(lw.weekdays)) return null;
  return lw;
}
