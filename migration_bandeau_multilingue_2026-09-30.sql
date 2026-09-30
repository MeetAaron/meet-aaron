-- migration_bandeau_multilingue_2026-09-30.sql
--
-- BANDEAU DE SIGNATURE PAR LANGUE.
--
-- Trou revele par la question d'Alex (30/09/2026) : « je les envoie sur Meet
-- Aaron et il saura laquelle utiliser ? »
--
-- Reponse honnete avant cette migration : NON pour l'image. Depuis le 26/09,
-- le TEXTE de signature est bien choisi selon la langue du destinataire
-- (users.email_signature_by_locale), mais l'IMAGE du bandeau vivait dans une
-- colonne unique, users.email_banner_image_url. Un email redige en allemand
-- se terminait donc par un bandeau francais — exactement le defaut qu'on
-- venait de corriger sur le texte.
--
-- Meme mecanique que pour le texte : un objet JSON { langue: url }, une
-- langue absente retombant sur email_banner_image_url, qui reste le bandeau
-- par defaut. Aucun compte existant ne change de comportement.

alter table public.users
  add column if not exists email_banner_by_locale jsonb;

comment on column public.users.email_banner_by_locale is
  'Bandeau de signature par langue de destinataire : { "en": "https://...", ... }. Langue absente => repli sur email_banner_image_url. Voir lib/signature-locale.ts.';
