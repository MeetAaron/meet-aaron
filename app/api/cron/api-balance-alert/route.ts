// app/api/cron/api-balance-alert/route.ts
// Tous les jours : prévient Alex quand son solde Anthropic ne couvre plus que
// 10 jours, puis 3 jours, de consommation moyenne (22/10/2026) — voir
// lib/api-balance.ts. Une seule alerte par seuil et par solde saisi : une
// nouvelle saisie dans /app/marge (après recharge) remet les compteurs à zéro.
// Notification push sur les appareils du compte fondateur + email système à
// l'adresse d'alerte opérateur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBalanceStatus } from '@/lib/api-balance';
import { sendPushNotification } from '@/lib/push';
import { sendSystemEmail } from '@/lib/google';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const FOUNDER_EMAIL = (process.env.MEETAARON_FOUNDER_EMAIL || 'aaron@meetaaron.app').toLowerCase();
const OPERATOR_EMAIL = process.env.OPERATOR_ALERT_EMAIL || 'aaron@meetaaron.app';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const st = await getBalanceStatus();
    if (!st.configured || st.daysLeft === null || !st.snapshotId) {
      return NextResponse.json({ checked: true, configured: st.configured, daysLeft: st.daysLeft });
    }

    // Seuil le plus grave atteint et pas encore signalé pour ce solde.
    let level: 3 | 10 | null = null;
    if (st.daysLeft <= 3 && !st.alerted3At) level = 3;
    else if (st.daysLeft <= 10 && !st.alerted10At && !st.alerted3At) level = 10;
    if (!level) return NextResponse.json({ checked: true, daysLeft: st.daysLeft });

    const days = Math.max(0, Math.floor(st.daysLeft));
    const remaining = Math.max(0, st.remainingUsd || 0).toFixed(2);
    const title = level === 3 ? 'Solde Anthropic presque vide' : 'Solde Anthropic à recharger';
    const body =
      `Il reste environ ${remaining} $, soit ${days} jour${days > 1 ? 's' : ''} au rythme actuel ` +
      `(${st.avgDailyUsd.toFixed(2)} $/jour). À zéro, Aaron s'arrête pour TOUS les clients. ` +
      `Recharge sur console.anthropic.com, puis saisis le nouveau solde dans /app/marge.`;

    const { data: founder } = await supabaseAdmin.from('users').select('id').ilike('email', FOUNDER_EMAIL).maybeSingle();
    if (founder?.id) {
      await sendPushNotification(founder.id, { title, body, url: '/app/marge', tag: `api-balance-${level}` } as any).catch(() => {});
    }
    await sendSystemEmail(OPERATOR_EMAIL, `Meet Aaron — ${title}`, body, 'fr').catch(() => {});

    await supabaseAdmin
      .from('api_balance_snapshots')
      .update(level === 3 ? { alerted_3_at: new Date().toISOString() } : { alerted_10_at: new Date().toISOString() })
      .eq('id', st.snapshotId);

    return NextResponse.json({ alerted: level, daysLeft: st.daysLeft });
  } catch (err) {
    return serverError(err, '/api/cron/api-balance-alert');
  }
}
