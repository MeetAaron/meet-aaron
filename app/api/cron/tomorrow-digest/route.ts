// app/api/cron/tomorrow-digest/route.ts
// Exécuté toutes les heures (vercel.json). « Ta journée de demain » : à 20 h
// dans le fuseau du commercial, un email et une notification listant ses
// rendez-vous du lendemain — le premier des deux rappels voulus par Alex
// (docx 08/11/2026 ; le second est appointment-reminders, juste avant).
// Rien n'est envoyé quand il n'y a aucun rendez-vous demain.
//
// Sans migration : la déduplication s'appuie sur notifications_log
// (type 'tomorrow_digest', un enregistrement par rendez-vous de la liste) —
// un rendez-vous confirmé après 20 h sera couvert par le rappel juste avant.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { resolveUserTimeZone } from '@/lib/user-timezone';
import { reminderTexts, typeLabel, fmtTime, fmtDay, DIGEST_HOUR } from '@/lib/reminder-texts';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d);
  return Number(h) % 24;
}

// Début et fin du jour « demain » dans le fuseau, en ISO UTC.
function tomorrowBounds(now: Date, tz: string): { start: string; end: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const offsetMin = (() => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(probe);
    const hh = Number(p.find((x) => x.type === 'hour')?.value || 0) % 24;
    const mm = Number(p.find((x) => x.type === 'minute')?.value || 0);
    return hh * 60 + mm - 12 * 60;
  })();
  const startLocalMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offsetMin * 60000;
  return { start: new Date(startLocalMidnight).toISOString(), end: new Date(startLocalMidnight + 24 * 3600 * 1000).toISOString() };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const now = new Date();
  let usersRes: any = await supabaseAdmin.from('users').select('id, first_name, full_name, email, locale, timezone, billing_country, notify_channel');
  if (usersRes.error) return NextResponse.json({ error: usersRes.error.message }, { status: 500 });

  const sent: string[] = [];
  for (const user of (usersRes.data || []) as any[]) {
    try {
      const tz = resolveUserTimeZone(user);
      if (localHour(now, tz) !== DIGEST_HOUR) continue;
      const { start, end } = tomorrowBounds(now, tz);
      const { data: appts } = await supabaseAdmin
        .from('appointments')
        .select('id, proposed_at, type, meet_link, contact_name, prospects(full_name, prospect_companies(name))')
        .eq('user_id', user.id)
        .eq('status', 'validé')
        .gte('proposed_at', start)
        .lt('proposed_at', end)
        .order('proposed_at', { ascending: true });
      if (!appts || appts.length === 0) continue;

      // Déduplication : on tente d'enregistrer chaque rendez-vous ; si aucun
      // n'est nouveau, le récap est déjà parti.
      let fresh = 0;
      for (const a of appts) {
        const { error } = await supabaseAdmin.from('notifications_log').insert({ user_id: user.id, appointment_id: a.id, channel: 'email', type: 'tomorrow_digest' });
        if (!error) fresh++;
        else if (error.code !== '23505') console.error('[tomorrow-digest] log:', error.message);
      }
      if (fresh === 0) continue;

      const locale = user.locale || 'fr';
      const T = reminderTexts(locale);
      const lines = (appts as any[]).map((a) =>
        T.digestLine
          .replace('{time}', fmtTime(a.proposed_at, locale, tz))
          .replace('{name}', a.prospects?.full_name || a.contact_name || '')
          .replace('{company}', a.prospects?.prospect_companies?.name || '—')
          .replace('{type}', typeLabel(locale, a.type)) + (a.meet_link ? ` · ${a.meet_link}` : '')
      );
      const first = user.first_name || (user.full_name || '').split(' ')[0] || '';
      const body = [T.digestIntro.replace('{first}', first).replace('{date}', fmtDay(appts[0].proposed_at, locale, tz)), '', ...lines, '', T.digestFoot].join('\n');
      const channel = user.notify_channel || 'both';
      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(user.id, user.email, T.digestSubject, body);
      }
      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, {
          title: T.digestTitle,
          body: T.digestPush.replace('{n}', String(appts.length)).replace('{first_line}', lines[0].split(' · ').slice(0, 2).join(' · ')),
          url: `/app/agenda?user_id=${user.id}`,
          tag: `digest:${start.slice(0, 10)}`,
        });
      }
      sent.push(user.id);
    } catch (err: any) {
      console.error(`[tomorrow-digest] ${user.id}:`, err?.message || err);
    }
  }
  return NextResponse.json({ sent: sent.length });
}
