-- migration_business_profile_pending_2026-08-27.sql
-- Demande Alex (27/08/2026) : le "Profil de l'entreprise" (companies.business_summary,
-- renommé côté UI depuis "résumé de l'entreprise") doit pouvoir être
-- téléchargé en Word/PDF à tout moment, puis renvoyé modifié (Word ou PDF) —
-- Aaron doit alors pouvoir remarquer les changements. Deux boutons prévus
-- côté UI : "Ne pas analyser" (le document importé est juste ignoré/effacé,
-- rien ne change) et "Faire analyser par Aaron" (Aaron retravaille le profil
-- à partir du texte importé). Ces colonnes stockent l'état "en attente
-- d'analyse" entre l'import et le choix de l'utilisateur.
--
-- À exécuter dans l'éditeur SQL Supabase (pas d'accès direct à la base
-- depuis Claude Code).

alter table companies
  add column if not exists business_summary_pending_text text,
  add column if not exists business_summary_pending_file_name text,
  add column if not exists business_summary_pending_uploaded_at timestamptz,
  add column if not exists business_summary_pending_uploaded_by uuid references users(id) on delete set null;

comment on column companies.business_summary_pending_text is 'Texte extrait du dernier document "Profil de l''entreprise" modifié renvoyé par un utilisateur (Word/RTF/PDF), en attente que quelqu''un clique "Ne pas analyser" ou "Faire analyser par Aaron". NULL = rien en attente.';
comment on column companies.business_summary_pending_file_name is 'Nom du fichier importé, affiché dans la bannière de revue côté UI.';
comment on column companies.business_summary_pending_uploaded_at is 'Date d''import du document en attente d''analyse. NULL = rien en attente.';
comment on column companies.business_summary_pending_uploaded_by is 'Utilisateur ayant importé le document en attente d''analyse.';
