// lib/subscription-cancel.ts
//
// RÉSILIATION EN FIN DE PÉRIODE (Alex, 18/11/2026).
//
// « Se désabonner » coupait l'abonnement Stripe sur-le-champ
// (stripe.subscriptions.cancel) : un ami inscrit avec le code gratuit qui
// cliquait le premier jour perdait l'accès le jour même. Alex veut l'inverse :
// on peut se désabonner quand on veut, on garde l'accès jusqu'au bout de ce
// qui est déjà payé — ou offert — et rien n'est prélevé ensuite.
//
// Fin effective = la plus tardive de :
//   - la fin de la période en cours (abonnement ou lignes, selon l'API) ;
//   - la fin de la réduction en cours (code promo « 3 mois offerts » : la
//     période mensuelle s'arrête après un mois, la gratuité après trois).
// Au-delà, Stripe supprime l'abonnement et envoie
// customer.subscription.deleted : le webhook désactive alors les modules.

import { stripe } from './stripe';

function periodEnd(subscription: any): number | null {
  const ends: number[] = [];
  if (subscription?.current_period_end) ends.push(subscription.current_period_end);
  for (const item of subscription?.items?.data || []) {
    if (item?.current_period_end) ends.push(item.current_period_end);
  }
  return ends.length ? Math.max(...ends) : null;
}

function discountEnd(subscription: any): number | null {
  const ends: number[] = [];
  const discounts = [subscription?.discount, ...(Array.isArray(subscription?.discounts) ? subscription.discounts : [])];
  for (const d of discounts) {
    if (d && typeof d === 'object' && typeof d.end === 'number') ends.push(d.end);
  }
  return ends.length ? Math.max(...ends) : null;
}

export type CancellationState = {
  cancelAt: string | null; // ISO, null = pas de résiliation programmée
};

export function cancellationStateOf(subscription: any): CancellationState {
  if (!subscription) return { cancelAt: null };
  const ts = subscription.cancel_at || (subscription.cancel_at_period_end ? periodEnd(subscription) : null);
  return { cancelAt: ts ? new Date(ts * 1000).toISOString() : null };
}

export async function scheduleCancellation(subscriptionId: string): Promise<CancellationState> {
  const subscription: any = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items', 'discounts'] });
  const nowSec = Math.floor(Date.now() / 1000);
  const end = periodEnd(subscription);
  const freeUntil = discountEnd(subscription);
  let updated: any;
  if (freeUntil && end && freeUntil > end && freeUntil > nowSec) {
    // Gratuité plus longue que la période en cours : on s'arrête à la fin de
    // la gratuité, sans facture au prorata.
    updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at: freeUntil,
      proration_behavior: 'none',
    } as any);
  } else {
    updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true } as any);
  }
  return cancellationStateOf(updated);
}

export async function resumeSubscription(subscriptionId: string): Promise<CancellationState> {
  const subscription: any = await stripe.subscriptions.retrieve(subscriptionId);
  const params: any = subscription.cancel_at && !subscription.cancel_at_period_end
    ? { cancel_at: '' }
    : { cancel_at_period_end: false };
  const updated = await stripe.subscriptions.update(subscriptionId, params);
  return cancellationStateOf(updated);
}

export async function readCancellation(subscriptionId: string | null | undefined): Promise<CancellationState> {
  if (!subscriptionId) return { cancelAt: null };
  try {
    const subscription: any = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
    return cancellationStateOf(subscription);
  } catch {
    return { cancelAt: null };
  }
}
