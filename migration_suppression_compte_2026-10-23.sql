-- migration_suppression_compte_2026-10-23.sql
-- Colonnes de la suppression de compte en libre-service (app/api/account/
-- deletion, cron execute-account-deletions). Elles n'avaient jamais été
-- créées : le cron horaire échouait en 500 (« column users.deletion_scheduled_for
-- does not exist »), constaté dans les journaux Vercel le 23/10/2026.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz;
CREATE INDEX IF NOT EXISTS users_deletion_scheduled_for_idx
  ON public.users (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL;
