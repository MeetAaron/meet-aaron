-- migration_documents_auto_category_2026-09-01.sql
-- « Classement automatique des documents + colonne géré par Aaron »
-- (demande Alex, 01/09/2026). Jusqu'ici, le commercial devait choisir
-- lui-même la catégorie de chaque document déposé (Général / Prospects /
-- Opportunités / Clients — voir migration_documents_2026-08-16.sql), et ne
-- le faisait presque jamais : tout finissait en « Général ».
--
-- Aaron lit déjà le contenu du document à l'upload pour en faire la synthèse
-- (lib/document-summary.ts) : il en déduit maintenant la catégorie dans le
-- MÊME appel API, sans coût supplémentaire. Cette colonne mémorise qui a
-- classé le document — Aaron ou le commercial — pour l'afficher dans la
-- colonne « Géré par Aaron » et pour ne jamais réécrire un choix manuel.
-- À exécuter dans l'éditeur SQL Supabase.

alter table company_documents add column if not exists category_auto boolean not null default false;

comment on column company_documents.category_auto is
  'true = catégorie déduite par Aaron à l''upload ; false = choisie (ou corrigée) par le commercial, Aaron n''y touche plus.';
