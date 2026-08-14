// app/api/checkout/credits/route.ts
// POST -> crée une session de paiement Stripe EN UNE FOIS (pas un abonnement)
// pour l'achat d'un pack de crédits ("boost", voir migration_credits_2026-08-14.sql
// et lib/credits.ts). 1 crédit = 1 €.
//
// Utilise price_data (tarif défini à la volée) plutôt qu'un Price ID Stripe
// préexistant : pas besoin de créer les 3 packs dans le dashboard Stripe au
// préalable, le prix est simplement le montant du pack choisi.
//
// Réservé au patron de la société : c'est une dépense engagée pour toute
// l'équipe, pas une action qu'un commercial devrait pouvoir déclencher seul
// (même logique que /api/team, réservé au patron).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

// Packs disponibles — décision produit du 14/08/2026. Le montant est à la
// fois le prix en euros ET le nombre de crédits ajoutés (1 crédit = 1 €).
const ALLOWED_PACKS_EUR = [20, 40, 100];

export async function POST(request: NextRequest) {
  const { amount_eur } = await request.json();

  if (!ALLOWED_PACKS_EUR.includes(amount_eur)) {
    return NextResponse.json({ error: 'Pack de crédits invalide' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const origin = request.nextUrl.origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: authedUser.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${amount_eur} crédits Aaron`,
              description: "Crédits pour continuer à utiliser Aaron au-delà du plafond inclus dans l'abonnement",
            },
            unit_amount: amount_eur * 100,
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: `${origin}/app/preferences?user_id=${authedUser.id}&credits_success=1`,
      cancel_url: `${origin}/app/preferences?user_id=${authedUser.id}`,
      metadata: {
        purpose: 'credits_purchase',
        company_id: authedUser.company_id,
        amount_eur: String(amount_eur),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Erreur création session Stripe (crédits):', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
