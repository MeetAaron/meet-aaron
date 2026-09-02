// lib/subscription-status.ts
// Statut de paiement d'un abonnement et ce qu'il autorise (question Alex,
// 01/09/2026 : « et si le paiement est refusé ? »).
// Voir migration_subscription_dunning_2026-09-01.sql pour la politique.

import { supabaseAdmin } from './supabase-admin';

export type SubscriptionStatus = 'active' | 'past_due' | 'unpaid' | 'canceled';

// Durée de la période de grâce après un premier échec de prélèvement.
// 7 jours = la fenêtre pendant laquelle Stripe relance automatiquement la
// carte (Smart Retries). Couper avant serait couper alors que le paiement a
// encore toutes les chances de passer tout seul.
export const GRACE_PERIOD_DAYS = 7;

export interface SubscriptionState {
  status: SubscriptionStatus;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  failureReason: string | null;
  // true tant que le client peut tout faire (y compris pendant la grâce).
  aiAllowed: boolean;
  // Jours restants avant suspension des fonctions IA (null si à jour).
  graceDaysLeft: number | null;
}

const DEFAULT_STATE: SubscriptionState = {
  status: 'active',
  pastDueSince: null,
  graceEndsAt: null,
  failureReason: null,
  aiAllowed: true,
  graceDaysLeft: null,
};

// Lit l'état de paiement d'une société.
//
// Tolérant à l'absence des colonnes (migration pas encore passée) ET à toute
// autre erreur : dans le doute on renvoie « à jour ». Une panne de lecture ne
// doit JAMAIS couper Aaron chez un client qui paie normalement — l'erreur
// coûteuse ici est le faux positif, pas le faux négatif.
export async function getSubscriptionState(companyId: string): Promise<SubscriptionState> {
  try {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('subscription_status, subscription_past_due_since, subscription_grace_ends_at, subscription_last_failure_reason')
      .eq('id', companyId)
      .maybeSingle();
    if (error || !data) return DEFAULT_STATE;

    const stored = ((data as any).subscription_status || 'active') as SubscriptionStatus;
    const graceEndsAt = (data as any).subscription_grace_ends_at || null;
    // Statut EFFECTIF : past_due dont la grâce est écoulée vaut unpaid, sans
    // attendre qu'un cron ne repasse dessus. Évite une tâche planifiée de
    // plus — et surtout évite la fenêtre pendant laquelle la base dirait
    // encore « past_due » alors que la grâce est terminée depuis des heures.
    const graceLapsed = stored === 'past_due' && !!graceEndsAt && new Date(graceEndsAt) <= new Date();
    const status: SubscriptionStatus = graceLapsed ? 'unpaid' : stored;
    const graceDaysLeft =
      status === 'past_due' && graceEndsAt
        ? Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

    // Pendant la grâce, tout continue de fonctionner (voir la migration).
    // La grâce écoulée sans régularisation, seules les fonctions IA
    // s'arrêtent — l'application reste consultable.
    const aiAllowed = status === 'active' || status === 'past_due';

    return {
      status,
      pastDueSince: (data as any).subscription_past_due_since || null,
      graceEndsAt,
      failureReason: (data as any).subscription_last_failure_reason || null,
      aiAllowed,
      graceDaysLeft,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

// Écrit un nouvel état. Best-effort : si les colonnes n'existent pas encore,
// on n'échoue pas — le webhook Stripe doit toujours répondre 200, sinon
// Stripe rejoue l'événement en boucle.
export async function setSubscriptionState(
  companyId: string,
  updates: {
    status: SubscriptionStatus;
    pastDueSince?: string | null;
    graceEndsAt?: string | null;
    failureReason?: string | null;
  }
): Promise<void> {
  const row: Record<string, any> = { subscription_status: updates.status };
  if (updates.pastDueSince !== undefined) row.subscription_past_due_since = updates.pastDueSince;
  if (updates.graceEndsAt !== undefined) row.subscription_grace_ends_at = updates.graceEndsAt;
  if (updates.failureReason !== undefined) row.subscription_last_failure_reason = updates.failureReason;
  try {
    const { error } = await supabaseAdmin.from('companies').update(row).eq('id', companyId);
    if (error) console.error('Statut abonnement non enregistré:', error.message);
  } catch (err: any) {
    console.error('Statut abonnement non enregistré:', err?.message);
  }
}

export function graceEndFrom(startedAt: Date): Date {
  return new Date(startedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}
