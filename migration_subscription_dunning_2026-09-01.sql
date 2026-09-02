-- migration_subscription_dunning_2026-09-01.sql
-- « Que se passe-t-il si le prélèvement mensuel est refusé ? » (question
-- Alex, 01/09/2026). Jusqu'ici : RIEN. Le webhook Stripe ne traitait que
-- checkout.session.completed — un client dont la carte expire gardait un
-- accès complet indéfiniment, et personne n'était prévenu, ni lui ni nous.
--
-- Politique retenue (relance douce, standard du SaaS B2B) :
--   1. Échec de prélèvement -> statut `past_due`, et une PÉRIODE DE GRÂCE de
--      7 jours démarre. Pendant ces 7 jours, TOUT continue de fonctionner :
--      couper un commercial en pleine prospection parce qu'une carte a expiré
--      est le meilleur moyen de perdre le client, pas de se faire payer.
--      Stripe relance le paiement automatiquement pendant cette fenêtre
--      (Smart Retries), et un bandeau invite à mettre la carte à jour.
--   2. Grâce expirée -> statut `unpaid` : les fonctions d'IA s'arrêtent
--      (Aaron n'écrit plus, n'envoie plus), mais l'application reste
--      accessible en lecture. Les données ne sont JAMAIS supprimées ni
--      rendues inaccessibles pour un impayé.
--   3. Paiement réussi (relance ou nouvelle carte) -> retour à `active`,
--      remise à zéro des deux dates. Rien à faire côté client.
--   4. Abonnement annulé côté Stripe -> `canceled`.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table companies
  add column if not exists subscription_status text not null default 'active',
  add column if not exists subscription_past_due_since timestamptz,
  add column if not exists subscription_grace_ends_at timestamptz,
  add column if not exists subscription_last_failure_reason text;

comment on column companies.subscription_status is
  'active | past_due (paiement échoué, période de grâce en cours, tout fonctionne) | unpaid (grâce expirée, fonctions IA suspendues, données intactes) | canceled. Défaut active : toutes les sociétés existantes restent inchangées.';
comment on column companies.subscription_past_due_since is
  'Date du premier échec de prélèvement non encore régularisé. NULL si à jour.';
comment on column companies.subscription_grace_ends_at is
  'Fin de la période de grâce de 7 jours. Au-delà, le cron de bascule passe le statut à unpaid.';
comment on column companies.subscription_last_failure_reason is
  'Message Stripe du dernier échec (carte expirée, fonds insuffisants...), affiché tel quel au client pour qu''il sache quoi corriger.';
