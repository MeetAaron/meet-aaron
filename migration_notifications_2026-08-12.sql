-- migration_notifications_2026-08-12.sql
-- Colonnes utilisées par la page Préférences et le cron de rappels de RDV
-- (app/app/preferences/page.jsx, app/api/preferences/route.ts,
-- app/api/cron/appointment-reminders/route.ts) mais jamais ajoutées à `users`
-- via une migration suivie dans le dépôt — à exécuter dans l'éditeur SQL Supabase.

alter table users add column if not exists notify_channel text default 'email';
alter table users add column if not exists notify_before_appointment_minutes integer default 30;
