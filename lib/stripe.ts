// lib/stripe.ts
// Client Stripe côté serveur, utilisé pour créer les sessions de paiement
// et vérifier les webhooks.

import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-03-31.basil' as any,
});

// MANAGED PAYMENTS — STRIPE COMME VENDEUR OFFICIEL (06/11/2026).
//
// Quand STRIPE_MANAGED_PAYMENTS vaut "1", chaque session Checkout demande à
// Stripe (via Link) d'être le « merchant of record » : c'est alors Stripe qui
// calcule, collecte, DÉCLARE et REVERSE la TVA/GST/sales tax dans plus de 80
// pays (toute l'UE, Royaume-Uni, Australie, Nouvelle-Zélande, Canada,
// États-Unis, Suisse…), à +3,5 % par transaction. Plus de guichet unique
// irlandais à ouvrir, plus de seuils à surveiller, plus de déclarations.
//
// La variable n'est PAS posée par le code : l'activation se fait d'abord dans
// le Dashboard (Réglages → Managed Payments, acceptation des conditions), par
// Alex lui-même ; ensuite seulement il pose la variable dans Vercel. Sans
// elle, rien ne change : Stripe Tax classique, comme avant.
export function managedPaymentsParams(): Record<string, any> {
  return process.env.STRIPE_MANAGED_PAYMENTS === '1' ? { managed_payments: { enabled: true } } : {};
}
