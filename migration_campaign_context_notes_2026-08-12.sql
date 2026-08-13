-- migration_campaign_context_notes_2026-08-12.sql
-- Notes de contexte libres capturées lors de la création conversationnelle
-- d'une campagne (voir app/api/campaigns/chat, app/app/campaigns/page.jsx) :
-- comportement/façon de communiquer des clients habituels, objections
-- attendues, etc. Affiché sur la fiche campagne pour l'équipe.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospecting_campaigns add column if not exists context_notes text;
