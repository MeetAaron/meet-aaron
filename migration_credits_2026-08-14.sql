-- migration_credits_2026-08-14.sql
-- Système de crédits payants ("boost"), décision produit du 14/08/2026 :
-- 1 crédit = 1 € facturé au client. Le coût réel en API Claude tourne autour
-- de 0,50 € par euro facturé (variable selon l'action) — le reste est la
-- marge. Les crédits ne remplacent PAS l'abonnement : ils prennent le relais
-- UNIQUEMENT une fois le plafond mensuel inclus dans l'abonnement atteint
-- (voir lib/anthropic-client.ts), pour permettre à une société de continuer
-- à utiliser Aaron ce mois-ci moyennant un supplément plutôt que d'être
-- bloquée jusqu'au mois suivant. Vendus par packs (20 €, 40 €, 100 €) via
-- Stripe Checkout en paiement unique (voir app/api/checkout/credits).

alter table companies add column if not exists credit_balance_eur numeric(10,2) not null default 0;

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  delta_eur numeric(10,2) not null,
  reason text not null,
  balance_after_eur numeric(10,2) not null,
  -- Clé d'idempotence pour les achats (webhook Stripe) : si Stripe relivre le
  -- même événement checkout.session.completed (retry réseau), la contrainte
  -- unique ci-dessous empêche de créditer deux fois le même achat. NULL pour
  -- les débits de consommation (pas d'achat associé).
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_company_id_idx on credit_transactions(company_id);

create unique index if not exists credit_transactions_stripe_session_id_key
  on credit_transactions(stripe_session_id)
  where stripe_session_id is not null;
