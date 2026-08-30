// app/api/api-usage/route.ts
// GET -> renvoie l'usage API (coût estimé) du mois en cours et des 7 derniers
//        jours pour la société du commercial connecté, ainsi que son plafond
//        mensuel. Alimente le petit tableau de suivi affiché dans Préférences.
//
// Rappel : c'est une ESTIMATION (voir lib/anthropic-client.ts) — la source de
// vérité pour la facturation réelle reste console.anthropic.com.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { getCreditBalance } from '@/lib/credits';
import { stripe } from '@/lib/stripe';

// Aligné sur lib/anthropic-client.ts (docx Modifs Aaron, AJOUTS 30/08/26,
// item 2) : 20 € PAR UTILISATEUR et par mois (21.5 USD au taux prudent),
// répartis sur 30 jours — le plafond société = base × nombre d'utilisateurs.
const DEFAULT_MONTHLY_CAP_USD = 21.5; // = 20 € par utilisateur et par mois
const DAILY_CAP_DIVISOR = 30;

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastNDatesUTC(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return dates;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const [{ data: company }, { count: companyUserCount }] = await Promise.all([
    supabaseAdmin
      .from('companies')
      .select('monthly_api_cap_usd, stripe_subscription_id')
      .eq('id', user.company_id)
      .single(),
    supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', user.company_id),
  ]);

  const perUserCapUsd = company?.monthly_api_cap_usd === undefined ? DEFAULT_MONTHLY_CAP_USD : company.monthly_api_cap_usd;
  const monthlyCapUsd = perUserCapUsd === null ? null : perUserCapUsd * Math.max(1, companyUserCount || 0);
  const dailyCapUsd = monthlyCapUsd === null ? null : monthlyCapUsd / DAILY_CAP_DIVISOR;

  const { data: monthRow } = await supabaseAdmin
    .from('api_usage_monthly')
    .select('cost_usd')
    .eq('company_id', user.company_id)
    .eq('year_month', currentYearMonth())
    .maybeSingle();

  const last7Dates = lastNDatesUTC(7);
  const { data: dayRows } = await supabaseAdmin
    .from('api_usage_daily')
    .select('date, cost_usd')
    .eq('company_id', user.company_id)
    .in('date', last7Dates);

  const byDate: Record<string, number> = {};
  (dayRows || []).forEach((r) => { byDate[r.date] = r.cost_usd; });
  const todayDate = last7Dates[0]; // lastNDatesUTC(7)[0] est aujourd'hui
  const last7Days = [...last7Dates].reverse().map((date) => ({ date, cost_usd: byDate[date] || 0 })); // plus ancien -> plus récent

  // Tâche #140 : en plus du pool général, un solde par module payant (Aaron
  // Prospect / Sales / Customer) — voir lib/credits.ts.
  const [creditBalanceEur, creditBalanceApEur, creditBalanceAsEur, creditBalanceAcEur] = await Promise.all([
    getCreditBalance(user.company_id),
    getCreditBalance(user.company_id, 'ap'),
    getCreditBalance(user.company_id, 'as'),
    getCreditBalance(user.company_id, 'ac'),
  ]);

  // Date de renouvellement (demande Alex 2026-08-25, onglet Abonnement) — pas
  // stockée en base, lue en direct depuis Stripe à chaque appel. Best-effort :
  // un souci Stripe ici ne doit jamais faire échouer le reste de la page.
  // apiVersion configurée dans lib/stripe.ts est plus récente que les types du
  // SDK npm installé (déjà `as any` là-bas pour la même raison) — sur les
  // abonnements multi-lignes récents, `current_period_end` a été déplacé du
  // niveau abonnement au niveau de chaque ligne (subscription item), donc on
  // vérifie les deux plutôt que de supposer lequel existe.
  let renewalDate: string | null = null;
  if (company?.stripe_subscription_id) {
    try {
      const subscription: any = await stripe.subscriptions.retrieve(company.stripe_subscription_id, {
        expand: ['items'],
      });
      const periodEnds: number[] = [];
      if (subscription.current_period_end) periodEnds.push(subscription.current_period_end);
      for (const item of subscription.items?.data || []) {
        if (item.current_period_end) periodEnds.push(item.current_period_end);
      }
      if (periodEnds.length) {
        renewalDate = new Date(Math.max(...periodEnds) * 1000).toISOString();
      }
    } catch (err: any) {
      console.error('Erreur récupération date de renouvellement Stripe:', err.message);
    }
  }

  return NextResponse.json({
    month_cost_usd: monthRow?.cost_usd || 0,
    monthly_cap_usd: monthlyCapUsd,
    daily_cap_usd: dailyCapUsd,
    today_cost_usd: byDate[todayDate] || 0,
    last_7_days: last7Days,
    credit_balance_eur: creditBalanceEur,
    credit_balance_ap_eur: creditBalanceApEur,
    credit_balance_as_eur: creditBalanceAsEur,
    credit_balance_ac_eur: creditBalanceAcEur,
    renewal_date: renewalDate,
  });
}
