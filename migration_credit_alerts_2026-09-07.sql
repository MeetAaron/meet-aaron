-- migration_credit_alerts_2026-09-07.sql
--
-- Mémoire des alertes de budget envoyées (cron app/api/cron/credit-alerts).
-- Une ligne par société, par mois et par seuil (0.7 puis 0.9) : garantit
-- qu'un client reçoit chaque alerte UNE fois, jamais tous les jours.

create table if not exists public.credit_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year_month text not null,            -- 'YYYY-MM'
  threshold real not null,             -- 0.7 | 0.9
  sent_at timestamptz not null default now(),
  unique (company_id, year_month, threshold)
);

comment on table public.credit_alerts is
  'Alertes de budget déjà envoyées (70 % / 90 %), une par société, mois et seuil.';
