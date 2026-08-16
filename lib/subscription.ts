// lib/subscription.ts
// Socle partagé pour l'abonnement multi-module (docx item 31 + section
// STRIPE) : chaque société peut activer/désactiver indépendamment Aaron
// Prospect (AP), Aaron Opportunités (AS) et Aaron Clients (AC). Les 3 modules
// vivent comme des "subscription items" séparés sur UN SEUL abonnement
// Stripe (une seule facture, plusieurs lignes) plutôt que 3 abonnements
// distincts — plus simple à facturer et à gérer côté client (un seul moyen
// de paiement, une seule date de renouvellement).

import { stripe } from './stripe';
import { supabaseAdmin } from './supabase-admin';

export type ModuleCode = 'AP' | 'AS' | 'AC';

export const MODULE_CODES: ModuleCode[] = ['AP', 'AS', 'AC'];

// Prix Stripe par module — configurables via Vercel comme
// STRIPE_PRICE_ID_AARON_PROSPECT existant (voir app/api/checkout/route.ts),
// pour pouvoir basculer test/live ou changer de tarif sans redéploiement.
// Alex doit créer les 2 nouveaux prix (Aaron Opportunités, Aaron Clients)
// dans son Dashboard Stripe et fournir les Price ID — voir statut projet.
export function getModulePriceId(module: ModuleCode): string | null {
  const envKey = {
    AP: 'STRIPE_PRICE_ID_AARON_PROSPECT',
    AS: 'STRIPE_PRICE_ID_AARON_SALES',
    AC: 'STRIPE_PRICE_ID_AARON_CUSTOMER',
  }[module];
  return process.env[envKey] || null;
}

function activeColumn(module: ModuleCode): string {
  return `offer_${module.toLowerCase()}_active`;
}

function itemColumn(module: ModuleCode): string {
  return `stripe_subscription_item_${module.toLowerCase()}`;
}

interface CompanyRow {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  offer_ap_active: boolean;
  offer_as_active: boolean;
  offer_ac_active: boolean;
  stripe_subscription_item_ap: string | null;
  stripe_subscription_item_as: string | null;
  stripe_subscription_item_ac: string | null;
}

export function isModuleActive(company: CompanyRow, module: ModuleCode): boolean {
  return Boolean((company as any)[activeColumn(module)]);
}

export function activeModuleCount(company: CompanyRow): number {
  return MODULE_CODES.filter((m) => isModuleActive(company, m)).length;
}

// Résout le subscription_item Stripe pour un module donné. Priorité à la
// colonne en base (rapide, pas d'appel Stripe) ; si elle est vide (société
// créée avant ce lot, voir migration_subscription_modules_2026-08-16.sql),
// on liste les items de l'abonnement Stripe et on retrouve celui dont le
// prix correspond au module — puis on met la colonne en cache pour la
// prochaine fois.
export async function resolveSubscriptionItemId(company: CompanyRow, module: ModuleCode): Promise<string | null> {
  const cached = (company as any)[itemColumn(module)];
  if (cached) return cached;
  if (!company.stripe_subscription_id) return null;

  const priceId = getModulePriceId(module);
  if (!priceId) return null;

  const items = await stripe.subscriptionItems.list({ subscription: company.stripe_subscription_id, limit: 100 });
  const match = items.data.find((item: any) => item.price.id === priceId);
  if (!match) return null;

  await supabaseAdmin.from('companies').update({ [itemColumn(module)]: match.id }).eq('id', company.id);
  return match.id;
}

export { activeColumn, itemColumn };
