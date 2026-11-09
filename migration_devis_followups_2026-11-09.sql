-- migration_devis_followups_2026-11-09.sql
-- Relances automatiques après devis (app/api/cron/devis-followups) :
-- J+3 (sautée si le commercial a appelé), J+7, J+14, puis push au
-- commercial à J+21. Un devis ne se classe jamais perdu tout seul.
alter table public.prospects add column if not exists devis_followups_sent integer not null default 0;
alter table public.prospects add column if not exists devis_followup_last_at timestamptz;
alter table public.prospects add column if not exists devis_giveup_pushed_at timestamptz;
