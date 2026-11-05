-- migration_usage_par_fonction_2026-11-05.sql
--
-- « 0,58 $ dépensés avec zéro email envoyé » (Alex, 04/11/2026). Personne ne
-- pouvait dire QUOI avait dépensé : api_usage_daily n'a qu'un total par
-- société et par jour. Chaque appel porte maintenant une étiquette de
-- fonction (lib/anthropic-client.ts, type UsageFeature) et cette table garde
-- le coût par étiquette et par jour. Un appel non étiqueté tombe dans
-- « autre », ce qui montre au moins ce qui reste à étiqueter.
--
-- Table SECONDAIRE : la jauge, les plafonds et les boosts restent sur
-- api_usage_daily / api_usage_monthly. Celle-ci ne sert qu'à comprendre.

CREATE TABLE IF NOT EXISTS public.api_usage_feature_daily (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date text NOT NULL,            -- 'AAAA-MM-JJ', calculé en UTC comme api_usage_daily
  feature text NOT NULL,
  cost_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, date, feature)
);

ALTER TABLE public.api_usage_feature_daily ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.api_usage_feature_daily IS
  'Coût API par société, par jour et par fonction (prospection_recherche, premier_email, relance, reponse, clients…). Lecture serveur uniquement.';
