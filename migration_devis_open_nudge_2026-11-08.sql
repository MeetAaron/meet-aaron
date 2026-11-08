-- migration_devis_open_nudge_2026-11-08.sql
-- Relance « appelle quand même » 30 min après l'ouverture d'un devis sans
-- appel enregistré (app/api/cron/devis-open-nudge). Une seule fois par devis.
alter table public.prospects add column if not exists devis_open_nudge_at timestamptz;
comment on column public.prospects.devis_open_nudge_at is 'Date du push « tu n''as pas encore appelé » envoyé 30 min après l''ouverture du devis (une fois).';
