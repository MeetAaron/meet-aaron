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
import { stripe } from '@/lib/stripe';
import {
  USD_PER_CREDIT,
  currencyForCountry,
  subscriptionPrice,
  CURRENCY_SYMBOLS,
  type BoostCurrency,
} from '@/lib/boost-tiers';

const FOUNDER_EMAIL = (process.env.MEETAARON_FOUNDER_EMAIL || 'aaron@meetaaron.app').toLowerCase();

// SEUIL D'INSCRIPTION A LA GST AUSTRALIENNE.
//
// L'ATO impose l'inscription des que le chiffre d'affaires sur 12 mois
// glissants atteint 75 000 A$ — ou des qu'on PREVOIT de l'atteindre dans les
// 12 mois a venir. Delai legal : 21 jours apres le franchissement.
//
// Cet ecran existe pour que ce seuil ne depende ni d'une memoire, ni d'une
// question posee au bon moment : il est recalcule a chaque ouverture.
const GST_THRESHOLD_AUD = 75000;
// On previent AVANT, pas au moment du franchissement : a 80 % il reste le
// temps de prendre rendez-vous avec un comptable, a 100 % le compte a
// rebours de 21 jours a deja commence.
const GST_WARN_RATIO = 0.8;

function twelveMonthsAgoUnix(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function monthStartUnix(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

// CHIFFRE D'AFFAIRES REEL, lu chez Stripe — pas une estimation prix x sieges.
//
// Deux sources differentes, volontairement :
//
//  - Les TRANSACTIONS DU SOLDE (balance transactions) pour le total GST.
//    Stripe les exprime dans la devise de reglement du compte, donc en A$ sur
//    un compte australien, deja converties par Stripe au taux du jour de
//    l'encaissement. C'est exactement la base que demande l'ATO, et ca evite
//    d'inventer un taux de change dans le code.
//
//  - Les FACTURES PAYEES pour la repartition par client : une facture porte
//    le client Stripe, donc la societe, ce qu'une transaction de solde ne
//    donne pas directement.
//
// Best-effort de bout en bout : une panne Stripe ne doit pas rendre l'ecran
// inaccessible, elle doit juste laisser les chiffres reels vides.
async function readStripeRevenue(customerToCompany: Record<string, string>) {
  const since12m = twelveMonthsAgoUnix();
  const sinceMonth = monthStartUnix();

  let rollingAud: number | null = null;
  let monthAud: number | null = null;
  let settlementCurrency: string | null = null;
  const realByCompany: Record<string, number> = {};
  let realCurrency: string | null = null;
  let error: string | null = null;

  try {
    // Limite haute volontaire : a ce stade le compte compte quelques dizaines
    // de transactions. Si elle est atteinte un jour, le chiffre devient un
    // minorant — mieux vaut un total prudent qu'une page qui met 30 s.
    const txs = await stripe.balanceTransactions
      .list({ created: { gte: since12m }, limit: 100 })
      .autoPagingToArray({ limit: 2000 });

    rollingAud = 0;
    monthAud = 0;
    for (const tx of txs as any[]) {
      // On ne compte QUE les encaissements : pas les remboursements en
      // positif, pas les virements sortants, pas les frais Stripe.
      if (tx.type !== 'charge' && tx.type !== 'payment') continue;
      settlementCurrency = settlementCurrency || String(tx.currency || '').toUpperCase();
      const amount = Number(tx.amount || 0) / 100;
      rollingAud += amount;
      if (Number(tx.created) >= sinceMonth) monthAud += amount;
    }
    rollingAud = Math.round(rollingAud * 100) / 100;
    monthAud = Math.round(monthAud * 100) / 100;

    const invoices = await stripe.invoices
      .list({ status: 'paid', created: { gte: sinceMonth }, limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    for (const inv of invoices as any[]) {
      const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
      const companyId = customerId ? customerToCompany[customerId] : null;
      if (!companyId) continue;
      realCurrency = realCurrency || String(inv.currency || '').toUpperCase();
      realByCompany[companyId] = (realByCompany[companyId] || 0) + Number(inv.amount_paid || 0) / 100;
    }
  } catch (err: any) {
    error = err?.message || 'lecture Stripe impossible';
    console.error('[Marge] lecture Stripe echouee :', error);
  }

  return { rollingAud, monthAud, settlementCurrency, realByCompany, realCurrency, error };
}

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
      .select('id, name, billing_country, created_at, stripe_subscription_id, stripe_customer_id')
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

  // Correspondance client Stripe -> societe, pour rattacher les factures
  // payees a la bonne ligne du tableau.
  const customerToCompany: Record<string, string> = {};
  (companiesRes.data || []).forEach((c: any) => {
    if (c.stripe_customer_id) customerToCompany[c.stripe_customer_id] = c.id;
  });
  const stripeRevenue = await readStripeRevenue(customerToCompany);

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
      // revenue_month est une ESTIMATION (prix du plan x sieges + boosts).
      // real_revenue_month est ce que Stripe a REELLEMENT encaisse ce
      // mois-ci pour ce client. Les deux sont affiches : l'ecart entre eux
      // est lui-meme une information (code promo, essai, impaye, exemption).
      revenue_month: Math.round(revenue * 100) / 100,
      real_revenue_month:
        stripeRevenue.realByCompany[c.id] === undefined
          ? null
          : Math.round(stripeRevenue.realByCompany[c.id] * 100) / 100,
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

  const rolling = stripeRevenue.rollingAud;
  return NextResponse.json({
    year_month: yearMonth,
    usd_per_credit: USD_PER_CREDIT,
    rows,
    totals: { ...totals, cost_usd: Math.round(totals.cost_usd * 100) / 100 },
    stripe: {
      // null = Stripe n'a pas pu etre lu ; 0 = lu, et rien encaisse.
      month_settled: stripeRevenue.monthAud,
      rolling_12m_settled: rolling,
      settlement_currency: stripeRevenue.settlementCurrency,
      invoice_currency: stripeRevenue.realCurrency,
      error: stripeRevenue.error,
    },
    gst: {
      threshold: GST_THRESHOLD_AUD,
      rolling_12m: rolling,
      ratio: rolling === null ? null : Math.round((rolling / GST_THRESHOLD_AUD) * 1000) / 1000,
      // 'ok' sous 80 %, 'warn' entre 80 et 100 %, 'due' au-dela : passe ce
      // seuil l'inscription est obligatoire sous 21 jours.
      level:
        rolling === null
          ? null
          : rolling >= GST_THRESHOLD_AUD
            ? 'due'
            : rolling >= GST_THRESHOLD_AUD * GST_WARN_RATIO
              ? 'warn'
              : 'ok',
    },
  });
}
