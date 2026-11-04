-- migration_hors_cible_2026-11-04.sql
--
-- Retour du premier client externe (04/11/2026) : Aaron a démarché des
-- concurrents de son client. Aaron sait maintenant refuser d'écrire à un
-- prospect hors cible (concurrent, ou incapable d'acheter l'offre) — voir
-- la section « PROSPECT HORS CIBLE » de lib/aaron_system_prompt.md.
--
-- Un tel prospect est marqué perdu avec cette raison, pour qu'aucun cron ne
-- repaie jamais le même jugement. Sans cette valeur, le code retombe sur
-- 'autre' : rien ne casse, on perd juste la précision.

ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_pipeline_lost_reason_check;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_pipeline_lost_reason_check
  CHECK (pipeline_lost_reason IS NULL OR pipeline_lost_reason IN (
    'pas_interesse', 'sans_reponse', 'trop_cher', 'concurrent', 'timing',
    'devis_refuse', 'resilie', 'email_invalide', 'hors_cible', 'autre'));
