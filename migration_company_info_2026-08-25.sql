-- migration_company_info_2026-08-25.sql
--
-- Ajoute des informations complémentaires sur la société liée à un
-- prospect/opportunité/client (demande Alex, 2026-08-25 : "il manque des
-- infos... l'adresse, etc etc ?") : adresse, SIRET, site web, secteur
-- d'activité, taille d'entreprise, chiffre d'affaires estimé.
--
-- Ces champs sont sur prospect_companies (la société), pas sur prospects (le
-- contact individuel) : plusieurs contacts d'une même société partagent donc
-- automatiquement ces infos, exactement comme c'est déjà le cas pour le nom
-- de société. Tous en texte libre, remplis à la main par le commercial (à la
-- création du prospect/opportunité/client, ou modifiés ensuite depuis sa
-- fiche) — aucun format imposé.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospect_companies add column if not exists address text;
alter table prospect_companies add column if not exists siret text;
alter table prospect_companies add column if not exists website text;
alter table prospect_companies add column if not exists industry text;
alter table prospect_companies add column if not exists company_size text;
alter table prospect_companies add column if not exists estimated_revenue text;
