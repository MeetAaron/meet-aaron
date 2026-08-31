-- migration_password_reset_2026-08-31.sql
-- « Mot de passe oublié ? » sur la page de connexion (31/08/2026) : jetons
-- à usage unique (1 h) envoyés par email par Aaron, puis changement du mot
-- de passe via l'API admin Supabase. Voir
-- app/api/auth/request-password-reset et app/api/auth/reset-password.

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_auth_user_id_idx on password_reset_tokens (auth_user_id);
