-- migration_email_deliverability_2026-08-15.sql
-- Protection délivrabilité : plafond quotidien d'emails de prospection par
-- commercial (voir lib/messaging.ts). Le diagnostic SPF/DMARC affiché dans
-- Connexions ne nécessite aucune migration (lecture DNS en direct, rien à
-- stocker).

alter table users add column if not exists daily_prospecting_email_cap integer not null default 40;

create table if not exists email_send_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  unique (user_id, day)
);

create index if not exists email_send_counters_user_day_idx on email_send_counters(user_id, day);
