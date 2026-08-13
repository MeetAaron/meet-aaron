-- migration_manual_appointments_2026-08-12.sql
-- Permet au commercial de créer lui-même un RDV (visio/physique/téléphonique)
-- directement depuis l'agenda, quand le rendez-vous a été pris en dehors
-- d'Aaron (le prospect l'a appelé directement, RDV avec un contact perso
-- que le commercial suit lui-même, etc.).
--
-- Deux cas :
--  - RDV lié à un prospect suivi par Aaron -> prospect_id renseigné comme avant.
--  - RDV avec un contact perso du commercial, pas dans la base d'Aaron ->
--    prospect_id NULL, contact_name renseigné à la place.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table appointments alter column prospect_id drop not null;
alter table appointments add column if not exists contact_name text; -- nom du contact quand prospect_id est NULL
alter table appointments add column if not exists source text not null default 'aaron'; -- 'aaron' | 'manuel'
