-- migration_signature_image_multilingue_2026-10-02.sql
--
-- IMAGE DE SIGNATURE PAR LANGUE.
--
-- Demande d'Alex (02/10/2026) : « il faut la possibilite d'ajouter plusieurs
-- signatures du coup, et pareil pour les bandeaux ».
--
-- Etat avant : le TEXTE de signature est par langue depuis le 26/09, le
-- BANDEAU depuis le 30/09, mais l'IMAGE DE SIGNATURE restait unique. Mon
-- raisonnement de l'epoque — « une carte de visite ne se traduit pas » —
-- etait vrai pour une carte de visite, et faux pour ce qu'Alex y met
-- reellement : un visuel de marque portant du texte. Ses sept fichiers
-- s'appellent signature-aaron-fr.png, -en.png, etc. Le besoin etait clair,
-- c'est ma lecture qui ne l'etait pas.
--
-- Meme mecanique que les deux autres : un objet JSON { langue: url }, une
-- langue absente retombant sur email_signature_image_url. Rien ne change
-- pour les comptes existants.

alter table public.users
  add column if not exists email_signature_image_by_locale jsonb;

comment on column public.users.email_signature_image_by_locale is
  'Image de signature par langue de destinataire : { "en": "https://...", ... }. Langue absente => repli sur email_signature_image_url. Voir lib/signature-locale.ts.';
