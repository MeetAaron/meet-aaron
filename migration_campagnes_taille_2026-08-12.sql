-- migration_campagnes_taille_2026-08-12.sql
-- Ajoute la taille d'entreprise ciblée à une campagne de prospection, pour que
-- la création de campagne soit plus précise (au-delà du seul secteur d'activité).
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospecting_campaigns add column if not exists company_sizes text[] default '{}';
