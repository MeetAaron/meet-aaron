-- migration_email_signature_2026-08-12.sql
-- Signature email du commercial, ajoutée automatiquement au bas des emails
-- qu'Aaron envoie en son nom (voir lib/messaging.ts, app/api/signature,
-- app/app/preferences/page.jsx). Détection automatique proposée à partir du
-- dernier email envoyé (heuristique, voir lib/signature.ts) mais toujours
-- éditable/validée à la main par le commercial avant d'être enregistrée.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table users add column if not exists email_signature text;
