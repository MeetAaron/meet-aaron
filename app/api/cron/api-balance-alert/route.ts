// app/api/cron/api-balance-alert/route.ts
// Tous les jours : prévient Alex quand son solde Anthropic ne couvre plus que
// 10 jours, puis 3 jours, de consommation moyenne (22/10/2026) — voir
// lib/api-balance.ts. Une seule alerte par seuil et par solde saisi : une
// nouvelle saisie dans /app/marge (après recharge) remet les compteurs à zéro.
// Notification push sur les appareils du compte fondateur + email système à
// l'adresse d'alerte opérateur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { FOUNDER_EMAILS } from '@/lib/founder';
import { getBalanceStatus } from '@/lib/api-balance';
import { sendPushNotification } from '@/lib/push';
import { sendSystemEmail } from '@/lib/google';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

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
    if (!st.configured || !st.snapshotId) {
      return NextResponse.json({ checked: true, configured: st.configured, daysLeft: st.daysLeft });
    }

    // SOLDE PÉRIMÉ (31/10/2026). Au-delà de dix jours sans nouvelle saisie, on
    // n'annonce plus de chiffre — un rechargement a pu avoir lieu entre-temps
    // sans être ressaisi, et c'est exactement ce qui a produit une alerte
    // « il reste 1,43 $ » alors que le solde réel était de 9,48 $.
    //
    // Mais se taire serait pire : le filet de sécurité disparaîtrait
    // silencieusement. On alerte donc sur l'ANCIENNETÉ au lieu du montant, une
    // seule fois par solde (on réutilise alerted_10_at comme marqueur).
    if (st.stale) {
      if (st.alerted10At || st.alerted3At) {
        return NextResponse.json({ checked: true, stale: true, alreadyAlerted: true });
      }
      const title = 'Solde Anthropic à revérifier';
      const body =
        `Le dernier solde saisi date d'il y a ${st.balanceAgeDays} jours, il n'est plus fiable — ` +
        `je ne peux plus dire combien il reste. Ouvre platform.claude.com (Facturation), ` +
        `lis le solde réel et saisis-le dans /app/marge. ` +
        `Dépense constatée depuis la dernière saisie : ${st.spentSinceUsd.toFixed(2)} $.`;
      const { data: staleFounders } = await supabaseAdmin.from('users').select('id, email').in('email', FOUNDER_EMAILS);
      for (const founder of staleFounders || []) {
        await sendPushNotification((founder as any).id, { title, body, url: '/app/marge', tag: 'api-balance-stale' } as any).catch(() => {});
      }
      await sendSystemEmail(OPERATOR_EMAIL, `Meet Aaron — ${title}`, body, 'fr').catch(() => {});
      await supabaseAdmin
        .from('api_balance_snapshots')
        .update({ alerted_10_at: new Date().toISOString() })
        .eq('id', st.snapshotId);
      return NextResponse.json({ alerted: 'stale', balanceAgeDays: st.balanceAgeDays });
    }

    if (st.daysLeft === null) {
      return NextResponse.json({ checked: true, daysLeft: null });
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
      `Recharge sur platform.claude.com (Facturation), puis saisis le nouveau solde dans /app/marge.\n\n` +
      // D'où vient le chiffre : une alerte fondée sur une estimation ne se lit
      // pas comme une alerte fondée sur la facture Anthropic.
      (st.spentSource === 'anthropic'
        ? `Dépense lue chez Anthropic (${st.spentSinceUsd.toFixed(2)} $ depuis le solde saisi il y a ${st.balanceAgeDays} jour${(st.balanceAgeDays || 0) > 1 ? 's' : ''}).`
        : `Dépense ESTIMÉE (${st.spentSinceUsd.toFixed(2)} $ depuis le solde saisi il y a ${st.balanceAgeDays} jour${(st.balanceAgeDays || 0) > 1 ? 's' : ''}) — pose ANTHROPIC_ADMIN_KEY pour lire la dépense réelle.`);

    // Tous les comptes fondateur (lib/founder.ts), pas un seul.
    const { data: founders } = await supabaseAdmin.from('users').select('id, email').in('email', FOUNDER_EMAILS);
    for (const founder of founders || []) {
      await sendPushNotification((founder as any).id, { title, body, url: '/app/marge', tag: `api-balance-${level}` } as any).catch(() => {});
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
