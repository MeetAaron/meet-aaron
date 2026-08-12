-- migration_appointment_outcome_2026-08-12.sql
-- Bilan post-RDV : après l'heure d'un rendez-vous validé, Aaron demande au
-- commercial (notification push/email) comment ça s'est passé, et enregistre
-- la réponse ici (voir app/api/cron/appointment-feedback-prompts,
-- app/app/agenda/rdv/[id]/bilan, app/api/appointments/[id]/outcome,
-- lib/appointment-outcome.ts).
-- À exécuter dans l'éditeur SQL Supabase.

alter table appointments add column if not exists outcome text; -- 'client' | 'bien_passe' | 'moyen' | 'perdu'
alter table appointments add column if not exists outcome_note text; -- réaction/conseil d'Aaron affiché au commercial après sa réponse
alter table appointments add column if not exists outcome_recorded_at timestamptz;

-- Réutilise la contrainte d'unicité déjà posée sur notifications_log
-- (migration_notifications_unique_2026-08-12.sql) pour dédupliquer aussi ce
-- nouveau type de notification ('appointment_feedback_prompt') — aucune
-- migration supplémentaire nécessaire de ce côté, l'index couvre déjà
-- (appointment_id, type, channel) quel que soit le type.
