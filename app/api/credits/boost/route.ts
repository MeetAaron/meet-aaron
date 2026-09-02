// app/api/credits/boost/route.ts
// GET  -> catalogue des boosts + réserve déjà active de la société.
// POST -> crée une session Stripe Checkout (paiement unique) pour un palier.
//
// MODÈLE (décision Alex, 01/09/2026) : un boost est une COUCHE au-dessus de
// l'abonnement. Les crédits inclus restent étalés sur le mois et ne bougent
// pas ; le boost ajoute les siens, étalés sur SA propre fenêtre d'un mois à
// compter de l'achat. Voir migration_credit_boosts_2026-09-01.sql,
// lib/credit-boosts.ts (catalogue et tarifs) et lib/anthropic-client.ts
// (getActiveBoostCapUsd, qui relève le plafond mensuel ET quotidien).
//
// La ligne Stripe est créée en price_data à la volée plutôt qu'avec des
// Price ID pré-créés : les 4 paliers sont figés dans le code (BOOST_TIERS),
// il n'y a donc rien à configurer côté Dashboard pour qu'ils fonctionnent —
// une erreur de configuration de moins, et un palier se change en une ligne.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { BOOST_TIERS, boostTierById, capUsdForCredits, listActiveBoosts } from '@/lib/credit-boosts';

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const boosts = await listActiveBoosts(authedUser.company_id);
  return NextResponse.json({
    tiers: BOOST_TIERS,
    active_boosts: boosts,
    active_credits: boosts.reduce((n, b) => n + (b.credits || 0), 0),
  });
}

export async function POST(request: NextRequest) {
  const { tier: tierId, locale } = await request.json();

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const tier = boostTierById(tierId);
  if (!tier) {
    return NextResponse.json({ error: 'Palier de boost inconnu' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', authedUser.id)
    .maybeSingle();

  const origin = request.nextUrl.origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user?.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: Math.round(tier.priceEur * 100),
            product_data: {
              name: `Meet Aaron — ${tier.credits} crédits`,
              description: `Boost de ${tier.credits} crédits, valable 1 mois à compter de l'achat. S'ajoute aux crédits inclus dans ton abonnement, qui ne sont pas entamés.`,
            },
          },
        },
      ],
      billing_address_collection: 'required',
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      locale: (locale as any) || 'auto',
      success_url: `${origin}/app/connexions?tab=subscription&boost=ok`,
      cancel_url: `${origin}/app/connexions?tab=subscription`,
      metadata: {
        purpose: 'boost_purchase',
        company_id: authedUser.company_id,
        user_id: authedUser.id,
        tier: tier.id,
        credits: String(tier.credits),
        cap_usd: String(capUsdForCredits(tier.credits)),
        price_eur: String(tier.priceEur),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Erreur création session Stripe (boost):', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
