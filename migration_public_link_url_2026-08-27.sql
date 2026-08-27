-- migration_public_link_url_2026-08-27.sql
--
-- Demande Alex (27/08/2026, suite au test réel avec Ludovic) : le premier
-- email n'incluait ni pièce jointe ni lien vers la landing page, et Aaron
-- (que ce soit en génération IA automatique ou via le chat direct) n'a
-- aujourd'hui AUCUN moyen de connaître un lien public à mentionner — il ne
-- peut ni le deviner ni le fabriquer sans risquer d'inventer une URL.
--
-- Nouveau champ générique (pas spécifique à meetaaron.app : chaque société
-- utilisatrice peut renseigner SA propre landing page/site public) — voir
-- app/api/preferences/route.ts, lib/aaron.ts (contexte fourni à Aaron pour
-- la génération d'emails) et app/app/connexions/page.jsx (champ +
-- bouton-jeton {lien} dans l'éditeur d'email de premier contact par défaut).
--
-- ⚠️ À exécuter dans l'éditeur SQL Supabase (aucun accès direct à la base
-- depuis l'agent).

alter table companies
  add column if not exists public_link_url text;

comment on column companies.public_link_url is
  'Lien public optionnel (landing page, site...) que le commercial autorise Aaron à mentionner dans ses emails de prospection — jamais fabriqué automatiquement si absent. Voir lib/aaron.ts et app/app/connexions/page.jsx.';
