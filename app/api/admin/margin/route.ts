// app/api/admin/margin/route.ts
//
// COMBIEN CHAQUE CLIENT COUTE, ET CE QU'IL RAPPORTE.
//
// Demande d'Alex (02/10/2026) : « crée une rubrique uniquement pour mon
// compte pour voir combien ils consomment de crédits actuellement — voir si
// je gagne de la marge ou non ».
//
// C'est la question qui decide si l'entreprise tient : a 59 € par mois, un
// client qui consomme pour 40 € d'API ne laisse pas de quoi vivre. Ce
// calcul n'existait nulle part : l'ecran « suivi du cout API » ne montre que
// la societe de l'utilisateur connecte, jamais la vue d'ensemble.
//
// RESERVEE AU COMPTE FONDATEUR. Le garde-fou est le meme que celui du bloc
// de suivi des couts dans Mon compte : l'email de l'utilisateur authentifie
// doit etre celui du compte Meet Aaron. Verifie cote SERVEUR, pas seulement
// a l'affichage — une route qui expose le chiffre d'affaires de toutes les
// societes ne se protege pas avec un `if` dans du JSX.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import {
  USD_PER_CREDIT,
  currencyForCountry,
  subscriptionPrice,
  CURRENCY_SYMBOLS,
  type BoostCurrency,
} from '@/lib/boost-tiers';

const FOUNDER_EMAIL = (process.env.MEETAARON_FOUNDER_EMAIL || 'aaron@meetaaron.app').toLowerCase();

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (String(authedUser.email || '').toLowerCase() !== FOUNDER_EMAIL) return forbiddenResponse();

  const yearMonth = currentYearMonth();

  // Une requete par table plutot qu'une jointure Postgrest : les volumes sont
  // minuscules (quelques dizaines de societes) et trois requetes simples se
  // lisent mieux qu'une imbrication qu'il faudra deboguer dans six mois.
  const [companiesRes, usageRes, boostsRes, seatsRes] = await Promise.all([
    supabaseAdmin
      .from('companies')
      .select('id, name, billing_country, created_at, stripe_subscription_id')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('api_usage_monthly')
      .select('company_id, cost_usd')
      .eq('year_month', yearMonth),
    supabaseAdmin
      .from('credit_boosts')
      .select('company_id, price_eur, starts_at')
      .gte('starts_at', monthStartIso()),
    supabaseAdmin.from('users').select('company_id'),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ error: companiesRes.error.message }, { status: 500 });
  }

  const costByCompany: Record<string, number> = {};
  (usageRes.data || []).forEach((r: any) => {
    costByCompany[r.company_id] = (costByCompany[r.company_id] || 0) + Number(r.cost_usd || 0);
  });

  const boostsByCompany: Record<string, number> = {};
  (boostsRes.data || []).forEach((r: any) => {
    boostsByCompany[r.company_id] = (boostsByCompany[r.company_id] || 0) + Number(r.price_eur || 0);
  });

  const seatsByCompany: Record<string, number> = {};
  (seatsRes.data || []).forEach((r: any) => {
    if (r.company_id) seatsByCompany[r.company_id] = (seatsByCompany[r.company_id] || 0) + 1;
  });

  const rows = (companiesRes.data || []).map((c: any) => {
    const currency: BoostCurrency = currencyForCountry(c.billing_country);
    const seats = Math.max(1, seatsByCompany[c.id] || 0);
    // Un abonnement par SIEGE : une societe a trois commerciaux paie trois
    // fois. Compter un seul abonnement sous-estimerait la marge des equipes.
    const subscription = c.stripe_subscription_id ? subscriptionPrice(currency) * seats : 0;
    const boosts = boostsByCompany[c.id] || 0;
    const revenue = subscription + boosts;

    const costUsd = costByCompany[c.id] || 0;
    const credits = Math.round(costUsd / USD_PER_CREDIT);

    // Le cout est en dollars, le prix dans la devise du client. On ne
    // convertit PAS : inventer un taux de change figé dans le code donnerait
    // une marge fausse avec trois décimales de précision apparente. On
    // affiche les deux et on assume — a l'echelle actuelle, l'ordre de
    // grandeur suffit a repondre a la seule question qui compte.
    return {
      company_id: c.id,
      name: c.name || '—',
      created_at: c.created_at,
      seats,
      currency,
      currency_symbol: CURRENCY_SYMBOLS[currency],
      subscribed: !!c.stripe_subscription_id,
      revenue_month: Math.round(revenue * 100) / 100,
      boosts_month: Math.round(boosts * 100) / 100,
      cost_usd_month: Math.round(costUsd * 100) / 100,
      credits_month: credits,
    };
  });

  // Le plus gourmand en premier : c'est celui-la qu'on veut voir en ouvrant
  // l'ecran, pas le dernier inscrit.
  rows.sort((a, b) => b.cost_usd_month - a.cost_usd_month);

  const totals = rows.reduce(
    (acc, r) => ({
      companies: acc.companies + 1,
      subscribed: acc.subscribed + (r.subscribed ? 1 : 0),
      cost_usd: acc.cost_usd + r.cost_usd_month,
      credits: acc.credits + r.credits_month,
    }),
    { companies: 0, subscribed: 0, cost_usd: 0, credits: 0 }
  );

  return NextResponse.json({
    year_month: yearMonth,
    usd_per_credit: USD_PER_CREDIT,
    rows,
    totals: { ...totals, cost_usd: Math.round(totals.cost_usd * 100) / 100 },
  });
}
