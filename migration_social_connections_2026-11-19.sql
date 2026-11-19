-- migration_social_connections_2026-11-19.sql
-- Aaron Social : les réseaux liés d'une société (TikTok d'abord).
-- Un seul compte par réseau et par société. Jetons chiffrés par l'application
-- (lib/encryption.ts) avant d'arriver ici. Aucune lecture depuis le
-- navigateur : la sécurité par ligne est activée sans aucune règle, seul le
-- serveur (clé de service) y accède.

create table if not exists social_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connected_by uuid references users(id) on delete set null,
  provider text not null check (provider in ('tiktok', 'instagram', 'facebook', 'linkedin')),
  account_id text not null,
  account_name text,
  avatar_url text,
  access_token text not null,
  refresh_token text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);

alter table social_connections enable row level security;

select column_name from information_schema.columns
where table_name = 'social_connections' order by ordinal_position;
