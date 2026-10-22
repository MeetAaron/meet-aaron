-- migration_aide_2026-10-22.sql
-- Lot 3 de la refonte de l'onboarding : bulles d'aide au premier passage
-- (components/HelpLayer.jsx, /api/help-tips), mémorisées par page et par
-- utilisateur. Idempotent.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS help_tips_seen jsonb NOT NULL DEFAULT '[]'::jsonb;
