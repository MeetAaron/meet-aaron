-- migration_marketing_campaigns_2026-08-21.sql
--
-- Nouveau module "Aaron Marketing" (docx AJOUT GLOBAL, message du 21/08/2026 :
-- "module marketing campagne. Fais le. le meilleur au monde... Bases toi sur
-- les meilleurs de la concurrence") : campagnes email vers les CLIENTS DÉJÀ
-- GAGNÉS (table prospects, first_order_confirmed_at renseigné) d'une société
-- utilisant Meet Aaron — à ne pas confondre avec les campagnes de PROSPECTION
-- existantes (table prospecting_campaigns, ciblent des prospects froids).
-- Rattaché au module payant Aaron Clients (offer_ac_active, voir
-- lib/subscription.ts) puisque c'est le module qui connaît ces clients.
--
-- Fonctionnalités couvertes par ce schéma, benchmarkées sur HubSpot,
-- ActiveCampaign, Klaviyo et Customer.io : segmentation d'audience (par score
-- de santé client déjà calculé par Aaron Customer, voir
-- lib/customer-health.ts — un axe de ciblage qu'aucun de ces concurrents
-- n'offre nativement puisqu'ils n'ont pas ce score), rédaction assistée par
-- IA, suivi des ouvertures et clics, conseil d'Aaron après envoi (même
-- principe que prospecting_campaigns.advice), et désabonnement explicite
-- (marketing_opt_out sur prospects) indépendant de la résiliation Meet Aaron
-- elle-même (app/api/unsubscribe).
--
-- À exécuter manuellement dans l'éditeur SQL Supabase (aucun accès direct à
-- la base depuis l'agent). Idempotent (if not exists / if exists partout).

create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  created_by_user_id uuid not null references users(id),
  name text not null,
  subject text,
  body_html text,
  body_text text,
  -- brouillon = en cours de rédaction, pas encore d'audience figée
  -- prete = audience figée (marketing_campaign_recipients peuplé), pas encore envoyée
  -- en_cours = envoi en cours (peut prendre plusieurs appels sur de grandes audiences)
  -- terminee = tous les destinataires traités (envoyés ou en échec)
  -- en_pause = envoi interrompu manuellement
  status text not null default 'brouillon'
    check (status in ('brouillon', 'prete', 'en_cours', 'terminee', 'en_pause')),
  -- Filtre d'audience au moment de la préparation (docx : "bases toi sur les
  -- meilleurs de la concurrence" -> segmentation, ici par santé client plutôt
  -- que par tag générique puisque cette donnée existe déjà et est plus utile).
  -- Valeurs possibles : 'saine' | 'a_surveiller' | 'a_risque' (voir
  -- lib/customer-health.ts). Tableau vide ou NULL = tous les clients gagnés.
  audience_health_filter text[],
  -- Exclut les clients gagnés depuis moins de N jours (évite de solliciter un
  -- client tout juste signé avec une campagne marketing générale). NULL = pas
  -- de filtre.
  audience_min_days_since_won integer,
  ai_generated boolean not null default false,
  advice text,
  advice_generated_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_company_id_idx
  on marketing_campaigns (company_id, created_at desc);

create table if not exists marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_campaigns(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  email text not null,
  -- Jeton opaque inséré dans les liens de suivi (ouverture/clic/désabonnement)
  -- de CE destinataire pour CETTE campagne — pas de session, pas d'auth
  -- requise sur ces routes publiques (voir app/api/marketing-campaigns/track).
  tracking_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  status text not null default 'en_attente'
    check (status in ('en_attente', 'envoye', 'echec', 'desabonne')),
  error_message text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  clicked_at timestamptz,
  click_count integer not null default 0,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaign_recipients_campaign_id_idx
  on marketing_campaign_recipients (campaign_id);

-- Désabonnement marketing explicite (clic sur "se désinscrire" dans un email
-- de campagne) — distinct de la résiliation Meet Aaron elle-même
-- (app/api/unsubscribe, qui concerne l'abonnement du COMMERCIAL, pas de son
-- client). Une fois vrai, ce client gagné est exclu de toute future audience
-- de campagne marketing, quelle que soit la société.
alter table prospects add column if not exists marketing_opt_out boolean not null default false;

comment on table marketing_campaigns is 'Campagnes email marketing vers les clients déjà gagnés (module Aaron Clients / offer_ac_active) — distinct de prospecting_campaigns (prospection à froid).';
comment on table marketing_campaign_recipients is 'Un destinataire = un client gagné (prospects) pour une campagne marketing donnée, avec son propre jeton de suivi.';
comment on column prospects.marketing_opt_out is 'true si ce client a cliqué "se désinscrire" sur un email de campagne marketing (indépendant de la résiliation de l abonnement Meet Aaron du commercial, voir app/api/unsubscribe).';
