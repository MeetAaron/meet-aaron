// lib/stripe.ts
// Client Stripe côté serveur, utilisé pour créer les sessions de paiement
// et vérifier les webhooks.

import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-03-31.basil',
});
