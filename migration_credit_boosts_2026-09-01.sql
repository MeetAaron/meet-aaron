-- migration_credit_boosts_2026-09-01.sql
-- « Boosts de crédits » (décision Alex, 01/09/2026).
--
-- MODÈLE RETENU — un boost est une COUCHE SUPPLÉMENTAIRE au-dessus de
-- l'abonnement, pas un remplacement :
--   * les crédits inclus dans l'abonnement restent étalés sur le mois et ne
--     bougent JAMAIS (comportement actuel, api_usage_monthly / api_usage_daily
--     et le plafond de lib/anthropic-client.ts, inchangés) ;
--   * un boost ajoute ses propres crédits, eux aussi étalés sur 1 mois, à
--     compter de SA date d'achat — exactement comme l'abonnement principal
--     court depuis sa propre date d'achat. Un boost acheté le 12 vaut donc
--     jusqu'au 12 du mois suivant, pas jusqu'au 31.
--   * plusieurs boosts peuvent se cumuler : le plafond effectif d'une société
--     à un instant T = plafond d'abonnement + somme des boosts encore actifs.
--
-- Ce modèle évite le piège du crédit qui expire en fin de mois : un boost
-- acheté le 28 serait presque entièrement perdu, ce qui est la première cause
-- de demande de remboursement sur ce type d'offre.
--
-- Les montants sont stockés en USD (comme tout le suivi de coût API, tarifs
-- Anthropic), et convertis en « crédits » à l'affichage — l'utilisateur ne
-- voit jamais de dollars (décision Alex, docx Modifs Aaron 30/08).
-- À exécuter dans l'éditeur SQL Supabase.

create table if not exists credit_boosts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  purchased_by uuid references users(id) on delete set null,
  -- Identifiant du palier vendu ('boost_20', 'boost_40', 'boost_100', 'boost_250')
  tier text not null,
  -- Crédits vendus (unité affichée au client) et budget API correspondant.
  credits integer not null,
  cap_usd numeric not null,
  price_eur numeric not null,
  -- Fenêtre d'activité : 1 mois glissant à partir de l'achat.
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create index if not exists credit_boosts_company_active_idx
  on credit_boosts (company_id, ends_at);

comment on table credit_boosts is
  'Boosts de crédits achetés à l''unité. Chaque ligne ajoute cap_usd au plafond API de la société entre starts_at et ends_at (1 mois glissant depuis l''achat). N''affecte jamais les crédits inclus dans l''abonnement, qui restent étalés sur le mois.';
comment on column credit_boosts.cap_usd is
  'Budget API (USD) débloqué par ce boost. Converti depuis les crédits vendus avec la même équivalence que l''abonnement (1 crédit ~ 1 USD de budget API).';
comment on column credit_boosts.ends_at is
  'Fin de validité : starts_at + 1 mois. Un boost non consommé n''est pas reporté au-delà, mais il court sur sa propre fenêtre, pas sur le mois calendaire.';
