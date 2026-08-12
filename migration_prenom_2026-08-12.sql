-- migration_prenom_2026-08-12.sql
-- Ajoute un champ "prénom" distinct sur users, pour qu'Aaron puisse s'adresser
-- au commercial par son prénom (plutôt que son nom complet) dans le chat.
-- À exécuter dans l'éditeur SQL Supabase.

alter table users add column if not exists first_name text;

-- Backfill best-effort pour les comptes existants : premier mot de full_name.
update users
set first_name = split_part(full_name, ' ', 1)
where first_name is null and full_name is not null and full_name <> '';
