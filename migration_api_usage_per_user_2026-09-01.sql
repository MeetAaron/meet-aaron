-- migration_api_usage_per_user_2026-09-01.sql
-- « Jauge de crédits par commercial » dans Mon équipe (demande Alex,
-- 01/09/2026). Jusqu'ici la consommation API n'était suivie QUE par société
-- (api_usage_monthly / api_usage_daily, voir
-- migration_api_usage_cap_2026-08-12.sql) : impossible de dire lequel des
-- commerciaux consomme le budget mensuel inclus dans l'abonnement.
--
-- Cette table ajoute le même compteur mensuel, mais par utilisateur. Elle ne
-- remplace pas les deux précédentes : le PLAFOND reste calculé au niveau de
-- la société (un commercial ne se fait jamais couper parce qu'un collègue a
-- consommé), cette table sert uniquement à afficher la répartition.
--
-- Les appels qui ne sont rattachables à aucun commercial (crons société,
-- traitements globaux) ne sont simplement pas comptés ici : l'écran Mon
-- équipe affiche l'écart entre le total société et la somme des commerciaux
-- sous un libellé « automatismes partagés », plutôt que de l'attribuer à
-- quelqu'un au hasard.
-- À exécuter dans l'éditeur SQL Supabase.

create table if not exists api_usage_user_monthly (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  year_month text not null, -- 'YYYY-MM' (UTC), même convention que api_usage_monthly
  cost_usd numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, year_month)
);

create index if not exists api_usage_user_monthly_company_idx
  on api_usage_user_monthly (company_id, year_month);

comment on table api_usage_user_monthly is
  'Consommation API mensuelle par commercial, pour la jauge de Mon équipe. Informative : le plafond reste géré par société dans api_usage_monthly.';
