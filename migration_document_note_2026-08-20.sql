-- migration_document_note_2026-08-20.sql
-- CHANGEMENTS A FAIRE (docx, section "MES DOCUMENTS", item 26) : Alex demande
-- une "annotation" par document que le commercial/fondateur peut écrire, et
-- qu'Aaron prend en compte dans son raisonnement — distincte du toggle
-- "included_in_aaron_context" (qui ne fait qu'inclure/exclure le document,
-- sans permettre d'y ajouter du texte) et de "description" (saisie une seule
-- fois à l'upload, pas pensée pour être modifiée ensuite).
--
-- À exécuter dans l'éditeur SQL Supabase (aucun accès direct à la base
-- depuis cette session).

alter table company_documents add column if not exists commercial_note text;

comment on column company_documents.commercial_note is 'Note libre du commercial/fondateur sur ce document, éditable à tout moment, transmise à Aaron avec le contenu extrait (voir lib/aaron.ts, lib/aaron-sales.ts, lib/aaron-customer.ts).';
