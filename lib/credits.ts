// lib/credits.ts
// Système de crédits payants ("boost"), voir migration_credits_2026-08-14.sql
// pour le détail de la décision produit. En résumé : 1 crédit = 1 €, les
// crédits prennent le relais UNIQUEMENT une fois le plafond mensuel inclus
// dans l'abonnement atteint (lib/anthropic-client.ts), pour ne pas bloquer
// une société qui accepte de payer un supplément pour continuer à utiliser
// Aaron ce mois-ci.

import { supabaseAdmin } from './supabase-admin';

export async function getCreditBalance(companyId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('companies')
    .select('credit_balance_eur')
    .eq('id', companyId)
    .maybeSingle();

  return data?.credit_balance_eur || 0;
}

// Ajoute des crédits (achat, ou ajustement manuel) et journalise la
// transaction. `stripeSessionId` sert de clé d'idempotence pour les achats :
// si le webhook Stripe relivre le même événement (retry réseau), la
// contrainte unique sur credit_transactions.stripe_session_id fait échouer
// l'insertion et on ne crédite pas une seconde fois le même achat.
export async function addCredits(
  companyId: string,
  amountEur: number,
  reason: string,
  stripeSessionId?: string
): Promise<{ added: boolean; balance: number }> {
  const current = await getCreditBalance(companyId);
  const newBalance = current + amountEur;

  const { error: txError } = await supabaseAdmin.from('credit_transactions').insert({
    company_id: companyId,
    delta_eur: amountEur,
    reason,
    balance_after_eur: newBalance,
    stripe_session_id: stripeSessionId || null,
  });

  if (txError) {
    // Code Postgres 23505 = violation de contrainte unique : cet achat a déjà
    // été crédité par un appel webhook précédent, on ne recrédite pas.
    if (stripeSessionId && txError.code === '23505') {
      return { added: false, balance: current };
    }
    throw new Error(`Erreur journalisation crédits: ${txError.message}`);
  }

  await supabaseAdmin.from('companies').update({ credit_balance_eur: newBalance }).eq('id', companyId);
  return { added: true, balance: newBalance };
}

// Débite des crédits (consommation au-delà du plafond inclus). Le solde ne
// descend jamais sous 0 — cohérent avec le reste du système : c'est une
// ESTIMATION de coût, pas une facturation exacte au centime (voir
// lib/anthropic-client.ts). La vérification "reste-t-il du solde avant
// d'autoriser l'appel" se fait AVANT, côté callClaude.
export async function spendCredits(companyId: string, amountEur: number, reason: string): Promise<number> {
  const current = await getCreditBalance(companyId);
  const newBalance = Math.max(0, current - amountEur);

  await Promise.all([
    supabaseAdmin.from('credit_transactions').insert({
      company_id: companyId,
      delta_eur: -amountEur,
      reason,
      balance_after_eur: newBalance,
    }),
    supabaseAdmin.from('companies').update({ credit_balance_eur: newBalance }).eq('id', companyId),
  ]);

  return newBalance;
}
