-- migration_fuseau_verrouille_2026-11-18.sql
-- users.timezone_locked : quand true, le fuseau horaire du compte n'est plus
-- reecrit par le navigateur a la connexion (app/api/user/timezone/route.ts).
alter table public.users add column if not exists timezone_locked boolean not null default false;
