-- migration_campaign_quota_pause_2026-09-08.sql
--
-- QUOTA DE NOUVEAUX PROSPECTS PAR MOIS (décision Alex, 08/09/2026) :
-- « les 300 sont la limite max, s'il crée 2 campagnes de 150 c'est pareil,
-- s'il en ajoute manuellement ça compte aussi ».
--
-- Le quota lui-même ne stocke rien : il se calcule (lib/prospect-quota.ts)
-- à partir du nombre de sièges, des boosts actifs et des prospects créés
-- dans le mois. Une seule colonne est nécessaire :
--
-- prospecting_campaigns.quota_paused_at — posé quand une campagne est mise
-- en pause PAR LE QUOTA (lib/sourcing.ts), pour la distinguer d'une pause
-- manuelle du commercial. Le cron (app/api/cron/run-campaigns) relance de
-- lui-même les campagnes ainsi marquées dès que la société a de nouveau des
-- prospects disponibles — mois suivant, ou boost acheté — et remet la
-- colonne à null. Une pause manuelle (null) n'est jamais touchée.

alter table public.prospecting_campaigns
  add column if not exists quota_paused_at timestamptz;

comment on column public.prospecting_campaigns.quota_paused_at is
  'Campagne mise en pause par le quota mensuel de prospects (null = pause manuelle ou pas de pause). Relancée automatiquement par le cron dès que le quota le permet.';
