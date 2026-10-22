-- migration_bienvenue_2026-10-22.sql
-- Parcours de première connexion /app/bienvenue (refonte de l'onboarding
-- validée par Alex le 21/10/2026) + puces de campagne issues de la fiche.
-- Idempotent.

-- 1) Reprise EXACTE après déconnexion, en base (jamais dans le navigateur) :
--    l'écran en cours et la question en cours. Les réponses elles-mêmes vont
--    dans users.onboarding_answers (colonne existante, partagée avec le chat).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS welcome_step text,
  ADD COLUMN IF NOT EXISTS welcome_question integer,
  ADD COLUMN IF NOT EXISTS welcome_done_at timestamptz;

-- 2) Tous les comptes qui existent AU MOMENT de cette migration sont marqués
--    « parcours fait » : personne ne revoit un onboarding. Seuls les comptes
--    créés ensuite passent par /app/bienvenue.
UPDATE public.users
SET welcome_done_at = now()
WHERE welcome_done_at IS NULL;

-- 3) Pré-remplissage de la première campagne + puces « d'après ta fiche »,
--    calculés une fois à partir du profil d'entreprise et gardés ici ;
--    recalculés seulement quand le profil change (empreinte source_key).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS campaign_profile_suggestions jsonb,
  ADD COLUMN IF NOT EXISTS campaign_profile_suggestions_key text;
