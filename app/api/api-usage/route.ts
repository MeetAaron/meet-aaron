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

const DEFAULT_MONTHLY_CAP_USD = 20;
const DAILY_CAP_DIVISOR = 15;

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

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('monthly_api_cap_usd')
    .eq('id', user.company_id)
    .single();

  const monthlyCapUsd = company?.monthly_api_cap_usd === undefined ? DEFAULT_MONTHLY_CAP_USD : company.monthly_api_cap_usd;
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

  const creditBalanceEur = await getCreditBalance(user.company_id);

  return NextResponse.json({
    month_cost_usd: monthRow?.cost_usd || 0,
    monthly_cap_usd: monthlyCapUsd,
    daily_cap_usd: dailyCapUsd,
    today_cost_usd: byDate[todayDate] || 0,
    last_7_days: last7Days,
    credit_balance_eur: creditBalanceEur,
  });
}
