-- migration_first_email_attachment_2026-08-27.sql
--
-- Demande Alex (27/08/2026) : pouvoir joindre un document (ex : la plaquette
-- Aaron) au premier email envoyé à un prospect. Réutilise la table
-- "company_documents" déjà en place pour "Mes documents" (upload, extraction
-- de texte, catégorie...) plutôt que de créer un nouveau mécanisme de
-- stockage : un document existant peut simplement être marqué "à joindre au
-- premier email".
--
-- Un seul document par société peut être marqué à la fois (l'application
-- désactive automatiquement l'ancien quand on en active un nouveau, voir
-- PATCH /api/documents/[id]) — pas de contrainte SQL d'unicité stricte ici
-- pour rester simple et cohérent avec le reste du schéma.
--
-- ⚠️ À exécuter dans l'éditeur SQL Supabase (aucun accès direct à la base
-- depuis l'agent).

alter table company_documents
  add column if not exists attach_to_first_email boolean not null default false;

comment on column company_documents.attach_to_first_email is
  'Si vrai, ce document est joint en pièce jointe à chaque premier email envoyé par Aaron pour cette société (voir lib/first-email-attachment.ts). Un seul document par société devrait avoir ce champ à vrai — géré côté application.';
