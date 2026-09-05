-- migration_credit_boosts_consumed_2026-09-05.sql
--
-- Boosts « jusqu'au dernier crédit » (décision Alex, 05/09/2026) :
-- « pour le boost, s'il reste des crédits à la fin du mois alors le reste
-- sera consommé les jours d'après. Le client a payé pour le boost donc il
-- aura jusqu'au dernier crédit. »
--
-- Avant : un boost relevait le plafond pendant sa fenêtre d'un mois
-- (starts_at → ends_at) puis disparaissait, consommé ou non. Maintenant, on
-- suit ce que chaque boost a réellement consommé (consumed_usd, alimenté par
-- lib/anthropic-client.ts à chaque appel qui dépasse l'abonnement) et un
-- boost reste utilisable tant que cap_usd - consumed_usd > 0, quelle que
-- soit la date. ends_at reste la « date visée » (Aaron essaie de tout
-- consommer avant), plus une date d'expiration.

alter table public.credit_boosts
  add column if not exists consumed_usd numeric not null default 0;

comment on column public.credit_boosts.consumed_usd is
  'Budget API (USD) déjà consommé sur ce boost. Le boost reste actif tant que cap_usd - consumed_usd > 0 (pas d''expiration).';

create index if not exists credit_boosts_company_remaining_idx
  on public.credit_boosts (company_id, starts_at)
  where consumed_usd < cap_usd;
