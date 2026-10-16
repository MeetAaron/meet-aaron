// app/api/activity/route.ts
// GET ?user_id= -> le FIL D'ACTIVITÉ du commercial : ce qu'Aaron a fait
// pendant son absence, les évènements les plus récents en premier.
//
// Pourquoi ce fil existe (Alex, 16/10/2026) : « que le client soit impatient
// d'ouvrir l'app ». Instagram donne envie parce qu'il s'est TOUJOURS passé
// quelque chose depuis la dernière fois. Un tableau de bord montre des
// compteurs ; un compteur ne donne pas envie, une nouvelle oui. Ce fil
// raconte donc : « 14 entreprises contactées, Dupont a répondu, Martin a
// ouvert ton devis ».
//
// Aucune table nouvelle : tout est dérivé de ce qui existe (messages,
// prospects, appointments). Les envois sortants sont AGRÉGÉS par jour —
// quarante lignes « email envoyé » noieraient la seule qui compte, la
// réponse. Les réponses, devis ouverts, rendez-vous et clients signés
// restent une ligne chacun : ce sont les nouvelles.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export type ActivityKind =
  | 'contacted' // agrégé par jour : N entreprises contactées
  | 'replied' // un prospect a répondu
  | 'quote_requested'
  | 'quote_sent'
  | 'quote_opened'
  | 'appointment_proposed'
  | 'appointment_confirmed'
  | 'won' // 🎉
  | 'found'; // agrégé par jour : N nouvelles entreprises trouvées

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  at: string;
  prospect_id: string | null;
  prospect_name: string | null;
  company_name: string | null;
  count: number; // > 1 seulement pour les évènements agrégés
}

const WINDOW_DAYS = 7;
const MAX_EVENTS = 60;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Colonnes optionnelles (migrations devis_ouverture) : deuxième lecture
  // sans elles sur 42703, comme partout ailleurs.
  const baseCols = 'id, full_name, created_at, quote_requested_at, devis_sent_at, won_at, is_won, prospect_companies(name)';
  let res: any = await supabaseAdmin
    .from('prospects')
    .select(baseCols + ', devis_opened_at')
    .eq('assigned_user_id', userId);
  if (res.error && res.error.code === '42703') {
    res = await supabaseAdmin.from('prospects').select(baseCols).eq('assigned_user_id', userId);
  }
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  const prospects: any[] = res.data || [];
  const byId = new Map<string, any>();
  for (const p of prospects) byId.set(p.id, p);
  const ids = prospects.map((p) => p.id);

  const events: ActivityEvent[] = [];
  const name = (p: any) => p?.full_name || null;
  const company = (p: any) => p?.prospect_companies?.name || null;

  // --- Prospects : trouvés (agrégé), devis demandé / envoyé / ouvert, client
  const foundByDay = new Map<string, { count: number; at: string }>();
  for (const p of prospects) {
    if (p.created_at && p.created_at >= since) {
      const k = dayKey(p.created_at);
      const cur = foundByDay.get(k) || { count: 0, at: p.created_at };
      cur.count += 1;
      if (p.created_at > cur.at) cur.at = p.created_at;
      foundByDay.set(k, cur);
    }
    if (p.quote_requested_at && p.quote_requested_at >= since) {
      events.push({ id: `qr:${p.id}`, kind: 'quote_requested', at: p.quote_requested_at, prospect_id: p.id, prospect_name: name(p), company_name: company(p), count: 1 });
    }
    if (p.devis_sent_at && p.devis_sent_at >= since) {
      events.push({ id: `qs:${p.id}`, kind: 'quote_sent', at: p.devis_sent_at, prospect_id: p.id, prospect_name: name(p), company_name: company(p), count: 1 });
    }
    if (p.devis_opened_at && p.devis_opened_at >= since) {
      events.push({ id: `qo:${p.id}`, kind: 'quote_opened', at: p.devis_opened_at, prospect_id: p.id, prospect_name: name(p), company_name: company(p), count: 1 });
    }
    if (p.is_won && p.won_at && p.won_at >= since) {
      events.push({ id: `won:${p.id}`, kind: 'won', at: p.won_at, prospect_id: p.id, prospect_name: name(p), company_name: company(p), count: 1 });
    }
  }
  foundByDay.forEach((v, k) => {
    events.push({ id: `found:${k}`, kind: 'found', at: v.at, prospect_id: null, prospect_name: null, company_name: null, count: v.count });
  });

  // --- Messages : sortants agrégés par jour, entrants un par un
  if (ids.length > 0) {
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id, prospect_id')
      .in('prospect_id', ids);
    const convToProspect = new Map<string, string>();
    for (const c of conversations || []) convToProspect.set(c.id, c.prospect_id);
    const convIds = Array.from(convToProspect.keys());

    if (convIds.length > 0) {
      const { data: messages } = await supabaseAdmin
        .from('messages')
        .select('id, conversation_id, direction, sent_at')
        .in('conversation_id', convIds)
        .gte('sent_at', since)
        .order('sent_at', { ascending: false })
        .limit(500);

      const contactedByDay = new Map<string, { count: number; at: string }>();
      for (const m of messages || []) {
        const pid = convToProspect.get(m.conversation_id);
        const p = pid ? byId.get(pid) : null;
        if (!m.sent_at) continue;
        if (m.direction === 'inbound') {
          events.push({ id: `in:${m.id}`, kind: 'replied', at: m.sent_at, prospect_id: pid || null, prospect_name: name(p), company_name: company(p), count: 1 });
        } else {
          const k = dayKey(m.sent_at);
          const cur = contactedByDay.get(k) || { count: 0, at: m.sent_at };
          cur.count += 1;
          if (m.sent_at > cur.at) cur.at = m.sent_at;
          contactedByDay.set(k, cur);
        }
      }
      contactedByDay.forEach((v, k) => {
        events.push({ id: `out:${k}`, kind: 'contacted', at: v.at, prospect_id: null, prospect_name: null, company_name: null, count: v.count });
      });
    }
  }

  // --- Rendez-vous : proposés et confirmés
  let appts: any = await supabaseAdmin
    .from('appointments')
    .select('id, prospect_id, proposed_at, status, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (appts.error && appts.error.code === '42703') {
    appts = await supabaseAdmin
      .from('appointments')
      .select('id, prospect_id, proposed_at, status')
      .eq('user_id', userId)
      .gte('proposed_at', since)
      .limit(100);
  }
  for (const a of appts.data || []) {
    const p = byId.get(a.prospect_id);
    const at = a.created_at || a.proposed_at;
    if (!at) continue;
    if (a.status === 'validé') {
      events.push({ id: `ac:${a.id}`, kind: 'appointment_confirmed', at, prospect_id: a.prospect_id, prospect_name: name(p), company_name: company(p), count: 1 });
    } else if (a.status === 'proposé') {
      events.push({ id: `ap:${a.id}`, kind: 'appointment_proposed', at, prospect_id: a.prospect_id, prospect_name: name(p), company_name: company(p), count: 1 });
    }
  }

  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return NextResponse.json({ events: events.slice(0, MAX_EVENTS), since });
}
