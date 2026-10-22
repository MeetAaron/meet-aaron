-- migration_solde_api_2026-10-22.sql
-- Alerte de recharge du compte Anthropic (option A) : soldes saisis par Alex
-- dans /app/marge, lus par lib/api-balance.ts et /api/cron/api-balance-alert.
-- Accès serveur uniquement (RLS activé sans aucune politique). Idempotent.
CREATE TABLE IF NOT EXISTS public.api_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'anthropic',
  balance_usd numeric NOT NULL CHECK (balance_usd >= 0),
  as_of timestamptz NOT NULL DEFAULT now(),
  alerted_10_at timestamptz,
  alerted_3_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_balance_snapshots_provider_as_of_idx
  ON public.api_balance_snapshots (provider, as_of DESC);
ALTER TABLE public.api_balance_snapshots ENABLE ROW LEVEL SECURITY;
