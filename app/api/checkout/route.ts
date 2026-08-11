// app/api/checkout/route.ts
// POST -> crée une session de paiement Stripe (abonnement) pour une nouvelle société.
// Les infos de la société sont passées en "metadata" pour que le webhook Stripe
// puisse créer la société + le profil utilisateur une fois le paiement confirmé.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

const PRICE_ID_AARON_PROSPECT = 'price_1U28xj7srPu7DrXAy07EdRs7';

export async function POST(request: NextRequest) {
  const { auth_user_id, email, full_name, company_name, country } = await request.json();

  if (!auth_user_id || !email || !full_name || !company_name || !country) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  const origin = request.nextUrl.origin;

try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: PRICE_ID_AARON_PROSPECT, quantity: 1 }],
      allow_promotion_codes: true,
      // Adresse de facturation complète (rue, ville, code postal) requise pour
      // pouvoir générer une vraie facture — avant, seul le pays était demandé.
      billing_address_collection: 'required',
      success_url: `${origin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/onboarding`,
      metadata: {
        auth_user_id,
        email,
        full_name,
        company_name,
        country,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Erreur création session Stripe:', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
