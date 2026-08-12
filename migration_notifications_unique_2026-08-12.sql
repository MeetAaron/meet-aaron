-- migration_notifications_unique_2026-08-12.sql
-- Empêche l'envoi de rappels de RDV en double si deux exécutions du cron
-- app/api/cron/appointment-reminders se chevauchent (le cron tourne toutes les
-- minutes). Sans cette contrainte, la vérification "déjà notifié ?" puis
-- l'insertion du log n'étaient pas atomiques. À exécuter dans l'éditeur SQL Supabase.

create unique index if not exists notifications_log_unique_reminder
  on notifications_log (appointment_id, type, channel);
