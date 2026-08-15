-- migration_crm_sync_2026-08-15.sql
-- Socle de synchronisation CRM (HubSpot) — voir lib/crm-sync.ts et
-- app/api/auth/hubspot. Connexion au niveau SOCIÉTÉ (pas par commercial,
-- contrairement à oauth_connections qui gère Gmail/Outlook) : un compte
-- HubSpot est partagé par toute l'entreprise. `crm_connections` est une
-- nouvelle table plutôt qu'une réutilisation d'oauth_connections pour cette
-- raison — clé unique (company_id, provider), pas (user_id, provider).

create table if not exists crm_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null,
  portal_id text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  connected_by_user_id uuid references users(id),
  connected_at timestamptz not null default now(),
  unique (company_id, provider)
);

create index if not exists crm_connections_company_idx on crm_connections(company_id);

-- Marque un prospect comme déjà synchronisé (contact + deal côté CRM), pour ne
-- pas le renvoyer en double lors d'une prochaine synchronisation manuelle.
alter table prospects add column if not exists crm_synced_at timestamptz;
