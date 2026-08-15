-- migration_documents_2026-08-16.sql
-- CHANGEMENTS A FAIRE #89 (Mes documents) : suppression d'un document,
-- annotation "pris en compte par Aaron" (pour exclure un document du
-- contexte envoyé à Aaron sans le supprimer), avis d'Aaron sur un document,
-- et rattachement d'un document à une catégorie (Général / Prospects /
-- Opportunités / Clients) pour ne l'exposer qu'au bon module d'Aaron.

alter table company_documents add column if not exists included_in_aaron_context boolean not null default true;
alter table company_documents add column if not exists advice text;
alter table company_documents add column if not exists advice_generated_at timestamptz;
-- 'general' (par défaut, tous les modules), 'prospects', 'opportunites', 'clients'.
-- NULL est traité comme 'general' côté application (documents déjà existants
-- avant cette migration, jamais catégorisés).
alter table company_documents add column if not exists linked_category text;
