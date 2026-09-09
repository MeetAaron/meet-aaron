-- migration_mailbox_auth_health_2026-09-09.sql
--
-- Panne SILENCIEUSE d'une boîte « Autre boîte mail » (IMAP/SMTP).
--
-- Avec Google/Microsoft, une autorisation révoquée se voit : le
-- rafraîchissement du jeton échoue et le commercial est renvoyé vers l'écran
-- de connexion. En IMAP il n'y a pas de jeton : si le commercial change le
-- mot de passe de sa messagerie (ou si son hébergeur le révoque), le serveur
-- répond simplement « authentification refusée » — et Aaron s'arrête sans
-- que personne ne le sache. Un client peut croire qu'Aaron travaille alors
-- qu'il est muet depuis trois jours.
--
--   auth_failure_count       : échecs d'authentification consécutifs
--                              (remis à 0 à la première connexion réussie)
--   auth_broken_at           : date à partir de laquelle la boîte est
--                              considérée en panne (3 échecs d'affilée)
--   auth_broken_notified_at  : date de la notification envoyée au commercial,
--                              pour ne le prévenir qu'UNE fois par panne
--
-- Colonnes génériques (pas seulement IMAP) : le même mécanisme servira le
-- jour où un jeton Google/Microsoft est révoqué côté fournisseur.

alter table public.oauth_connections
  add column if not exists auth_failure_count integer not null default 0,
  add column if not exists auth_broken_at timestamptz,
  add column if not exists auth_broken_notified_at timestamptz;

comment on column public.oauth_connections.auth_broken_at is
  'Non NULL = la boîte refuse l''authentification (mot de passe changé/révoqué). Les envois sont mis en pause et le commercial est prévenu.';
