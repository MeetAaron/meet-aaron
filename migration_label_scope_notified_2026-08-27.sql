-- migration_label_scope_notified_2026-08-27.sql
--
-- Complément au correctif du 25/08 (scope OAuth "gmail.labels" ajouté pour
-- que le label Gmail "🤖 Géré par Aaron" puisse être posé — voir
-- app/api/auth/google/route.ts). Google ne redonne jamais ce droit
-- rétroactivement à un jeton déjà émis : les comptes connectés AVANT le
-- 25/08 (dont celui d'Alex) doivent déconnecter puis reconnecter Gmail.
--
-- Un avertissement + bouton "Reconnecter" existe déjà dans Connexions
-- (app/app/connexions/page.jsx), mais rien ne garantit que le commercial y
-- retourne — même angle mort que celui déjà comblé pour SPF/DMARC (voir
-- lib/email-deliverability.ts). Cette colonne permet au cron
-- app/api/cron/check-inbox de pousser une notification ciblée une seule
-- fois par connexion concernée, plutôt qu'à chaque exécution (toutes les 5
-- minutes).
--
-- ⚠️ À exécuter dans l'éditeur SQL Supabase (aucun accès direct à la base
-- depuis l'agent).

alter table oauth_connections
  add column if not exists label_scope_notified_at timestamptz;

comment on column oauth_connections.label_scope_notified_at is
  'Horodatage de la notification push (unique) envoyée pour prévenir ce commercial que sa connexion Google doit être reconnectée pour obtenir le scope gmail.labels. NULL = jamais notifié. Voir app/api/cron/check-inbox/route.ts.';
