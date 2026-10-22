-- migration_enrichissement_linkedin_avis_2026-10-22.sql
-- Enrichissement validé par Alex le 22/10/2026 :
--   - pages PUBLIQUES LinkedIn / Instagram de l'entreprise du prospect ;
--   - avis d'Aaron sur l'entreprise (bonne cible ? angle ? vigilance ?).
-- Idempotent. Le code tolère l'absence de ces colonnes (repli), mais rien ne
-- s'affiche tant que cette migration n'est pas jouée.

ALTER TABLE public.prospect_companies
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS socials_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS aaron_opinion text,
  ADD COLUMN IF NOT EXISTS aaron_opinion_fit text,
  ADD COLUMN IF NOT EXISTS aaron_opinion_locale text,
  ADD COLUMN IF NOT EXISTS aaron_opinion_generated_at timestamptz;

-- Cache de recherche partagé (créé le 05/09/2026) : seulement s'il existe.
DO $$
BEGIN
  IF to_regclass('public.company_research_cache') IS NOT NULL THEN
    ALTER TABLE public.company_research_cache
      ADD COLUMN IF NOT EXISTS linkedin_url text,
      ADD COLUMN IF NOT EXISTS instagram_url text;
  END IF;
END $$;
