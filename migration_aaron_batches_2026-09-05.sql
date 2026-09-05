-- migration_aaron_batches_2026-09-05.sql
--
-- Batch API Anthropic (plan de réduction des coûts validé par Alex le
-- 05/09/2026, « troisième levier ») : les premiers emails de campagne et les
-- relances après silence partent désormais par lots à moitié prix, et
-- reviennent en général sous l'heure. Ces deux tables font le lien entre le
-- lot soumis à Anthropic et les prospects concernés, le temps que le
-- résultat revienne (voir lib/aaron-batch.ts et
-- app/api/cron/collect-aaron-batches).

create table if not exists public.aaron_batches (
  id uuid primary key default gen_random_uuid(),
  anthropic_batch_id text not null unique,
  status text not null default 'pending', -- pending | completed
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.aaron_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.aaron_batches(id) on delete cascade,
  prospect_id uuid not null,
  user_id uuid not null,
  company_id uuid,
  conversation_id uuid not null,
  kind text not null, -- first_contact | followup
  model text,
  status text not null default 'pending', -- pending | done | deferred | error
  output jsonb, -- sortie d'Aaron gardée quand l'envoi est différé (plafond du jour atteint)
  error text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists aaron_batch_items_pending_idx
  on public.aaron_batch_items (prospect_id)
  where status in ('pending', 'deferred');

create index if not exists aaron_batch_items_batch_idx
  on public.aaron_batch_items (batch_id);

comment on table public.aaron_batches is 'Lots Anthropic Message Batches soumis par Aaron (premiers emails, relances).';
comment on table public.aaron_batch_items is 'Une ligne par prospect dans un lot ; pending tant que le résultat n''est pas appliqué.';
