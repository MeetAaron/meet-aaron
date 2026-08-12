-- migration_linkedin_url_2026-08-12.sql
-- lib/sourcing.ts découvrait déjà l'URL LinkedIn d'un contact (via recherche
-- web) mais ne la stockait jamais nulle part — perdue dès l'insertion du
-- prospect. Cette colonne permet de la conserver, pour l'assistant de
-- démarchage LinkedIn (voir lib/linkedin-assist.ts) et pour l'afficher côté
-- commercial (app/app/prospects/page.jsx). À exécuter dans l'éditeur SQL Supabase.

alter table prospects add column if not exists linkedin_url text;
