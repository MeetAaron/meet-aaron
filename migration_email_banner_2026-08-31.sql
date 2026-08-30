-- migration_email_banner_2026-08-31.sql
-- Bandeau publicitaire affiché sous la signature dans les emails envoyés par
-- Aaron (docx Modifs Aaron, bloc "AJOUT signature") — image uploadée dans le
-- bucket public "signatures" existant, URL stockée ici. Voir
-- app/api/signature/image/route.ts (kind=banner) et lib/messaging.ts.

alter table users
  add column if not exists email_banner_image_url text;

comment on column users.email_banner_image_url is
  'URL publique du bandeau publicitaire affiché sous la signature dans les emails envoyés (null = pas de bandeau). Uploadé via /api/signature/image avec kind=banner.';
