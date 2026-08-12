-- migration_api_usage_cap_2026-08-12.sql
-- Garde-fou de dépense API mensuelle par société (lib/anthropic-client.ts).
-- Toute société créée après cette migration démarre à 20 € par défaut (DEFAULT
-- de la colonne). Pour désactiver le plafond sur une société précise (ex:
-- compte interne Open X), mettre sa ligne à NULL explicitement — c'est le seul
-- sens que lib/anthropic-client.ts donne à NULL : "pas de plafond", jamais
-- "valeur par défaut". C'est pourquoi cette migration force à 20 € toutes les
-- lignes existantes (qui seraient sinon NULL juste parce que la colonne vient
-- d'être créée, ce qui désactiverait le plafond partout par accident).
-- À exécuter dans l'éditeur SQL Supabase.

alter table companies add column if not exists monthly_api_cap_usd numeric default 20;

create table if not exists api_usage_monthly (
  company_id uuid not null references companies(id) on delete cascade,
  year_month text not null, -- format 'YYYY-MM' (calculé en UTC)
  cost_usd numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, year_month)
);

update companies set monthly_api_cap_usd = 20 where monthly_api_cap_usd is null;
