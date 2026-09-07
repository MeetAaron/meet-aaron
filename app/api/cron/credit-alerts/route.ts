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

// Textes en dur ici, PAS via lib/i18n : ce module importe React (useLocale)
// et pèse 1 Mo — l'importer depuis une route serveur fait échouer le build
// Next (constaté le 07/09/2026). Aucune autre route API ne l'importe.
const TEXTS: Record<string, { title: string; body70: string; body90: string }> = {
  fr: { title: 'Budget Aaron : {pct} % utilisé', body70: "Il te reste environ {left} $ de budget ce mois-ci. Un boost évite qu'Aaron s'arrête en pleine campagne.", body90: "Plus que {left} $ environ : Aaron va bientôt s'arrêter. Ajoute un boost depuis Mon compte pour continuer." },
  en: { title: 'Aaron budget: {pct}% used', body70: 'About ${left} of budget left this month. A boost keeps Aaron from stopping mid-campaign.', body90: 'Only about ${left} left: Aaron will stop soon. Add a boost from My account to keep going.' },
  de: { title: 'Aaron-Budget: {pct} % verbraucht', body70: 'Noch etwa {left} $ Budget in diesem Monat. Ein Boost verhindert, dass Aaron mitten in der Kampagne stoppt.', body90: 'Nur noch etwa {left} $: Aaron stoppt bald. Füge in Mein Konto einen Boost hinzu.' },
  it: { title: 'Budget Aaron: {pct} % utilizzato', body70: 'Restano circa {left} $ di budget questo mese. Un boost evita che Aaron si fermi a metà campagna.', body90: 'Solo circa {left} $ rimasti: Aaron si fermerà presto. Aggiungi un boost da Il mio account.' },
  es: { title: 'Presupuesto de Aaron: {pct} % usado', body70: 'Te quedan unos {left} $ de presupuesto este mes. Un boost evita que Aaron se detenga en plena campaña.', body90: 'Solo quedan unos {left} $: Aaron se detendrá pronto. Añade un boost desde Mi cuenta.' },
  pt: { title: 'Orçamento Aaron: {pct} % usado', body70: 'Restam cerca de {left} $ de orçamento este mês. Um boost evita que o Aaron pare a meio da campanha.', body90: 'Só restam cerca de {left} $: o Aaron vai parar em breve. Adiciona um boost em A minha conta.' },
  nl: { title: 'Aaron-budget: {pct} % gebruikt', body70: 'Nog ongeveer {left} $ budget deze maand. Een boost voorkomt dat Aaron midden in een campagne stopt.', body90: 'Nog maar ongeveer {left} $: Aaron stopt binnenkort. Voeg een boost toe via Mijn account.' },
};

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
        const texts = TEXTS[(u as any).locale] || TEXTS.fr;
        const title = texts.title.replace('{pct}', String(pct));
        const body = (reached >= 0.9 ? texts.body90 : texts.body70).replace('{left}', snap.availableUsd.toFixed(0));
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
