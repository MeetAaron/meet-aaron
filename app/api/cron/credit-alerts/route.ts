// app/api/cron/credit-alerts/route.ts
// Exécuté une fois par jour via Vercel Cron.
//
// Alerte de budget (07/09/2026). Jusqu'ici, un client n'apprenait que son
// budget du mois était épuisé qu'au moment où Aaron s'arrêtait — c'est-à-dire
// trop tard pour acheter un boost avant que la campagne ne cale. Ce cron
// prévient AVANT : à 70 % puis à 90 % du budget disponible (abonnement +
// boosts), une notification push à chaque commercial de la société, avec le
// lien vers Mon compte où le boost s'achète en deux clics.
//
// Une seule alerte par seuil et par mois (table credit_alerts, voir
// migration_credit_alerts_2026-09-07.sql) : pas de harcèlement quotidien.
// Best-effort de bout en bout — une erreur sur une société n'empêche pas les
// autres d'être prévenues.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBudgetSnapshot } from '@/lib/anthropic-client';
import { sendPushNotification } from '@/lib/push';
import { t } from '@/lib/i18n';

const THRESHOLDS = [0.7, 0.9] as const;

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

function yearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: companies, error } = await supabaseAdmin.from('companies').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ym = yearMonth();
  let sent = 0;

  for (const company of companies || []) {
    try {
      const snap = await getBudgetSnapshot(company.id);
      if (!snap) continue;

      // Seuil le plus haut atteint : on n'envoie que celui-là (à 95 %, on
      // envoie « 90 % » et non les deux).
      const reached = [...THRESHOLDS].reverse().find((th) => snap.ratio >= th);
      if (!reached) continue;

      const { data: already } = await supabaseAdmin
        .from('credit_alerts')
        .select('id')
        .eq('company_id', company.id)
        .eq('year_month', ym)
        .eq('threshold', reached)
        .maybeSingle();
      if (already) continue;

      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, locale')
        .eq('company_id', company.id);

      const pct = Math.round(reached * 100);
      for (const u of users || []) {
        const locale = (u as any).locale || 'fr';
        const title = t('credits.alertTitle', locale).replace('{pct}', String(pct));
        const body = t(reached >= 0.9 ? 'credits.alertBody90' : 'credits.alertBody70', locale)
          .replace('{left}', snap.availableUsd.toFixed(0));
        await sendPushNotification(u.id, { title, body, url: `/app/connexions?user_id=${u.id}&tab=account` });
        sent++;
      }

      await supabaseAdmin.from('credit_alerts').insert({ company_id: company.id, year_month: ym, threshold: reached });
    } catch (err: any) {
      console.error('credit-alerts:', company.id, err?.message);
    }
  }

  return NextResponse.json({ sent });
}
