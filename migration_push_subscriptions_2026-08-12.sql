-- migration_push_subscriptions_2026-08-12.sql
-- Stocke les abonnements Web Push (un par navigateur/appareil autorisé) créés
-- depuis /app/preferences (components/PushNotificationManager.jsx) et utilisés
-- par lib/push.ts pour envoyer les rappels de RDV et les alertes "action
-- requise" (nouveau RDV proposé par Aaron, tentative de sauvetage à valider).
-- À exécuter dans l'éditeur SQL Supabase.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id);
