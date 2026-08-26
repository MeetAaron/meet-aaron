-- migration_prospect_company_research_2026-08-26.sql
--
-- Demande Alex (2026-08-26) : avant de contacter un prospect, Aaron doit
-- "parfaitement maîtriser" la société qu'il contacte (son métier réel), pas
-- juste son nom — avec une exception pour les sociétés de test qui n'existent
-- pas réellement (voir lib/prospect-research.ts, isCompanyResearchable()).
--
-- Ce résumé de recherche web est stocké UNE FOIS par fiche prospect_companies
-- (pas par contact individuel) et réutilisé pour tous les contacts de la même
-- société, pour ne jamais repayer une recherche déjà faite — voir
-- app/api/prospects/route.ts et lib/sourcing.ts.

alter table prospect_companies add column if not exists research_summary text;
alter table prospect_companies add column if not exists research_checked_at timestamptz;
