-- migration_team_seats_2026-08-28.sql
-- Demande Alex (28/08/2026) : nouvel onglet "Abonnement équipes" dans "Mon
-- équipe" — le fondateur peut ajouter 1, 2 ou 3 comptes équipe pour ses
-- commerciaux, chacun avec son propre code d'activation (envoyable par
-- email) et son propre choix de modules (Aaron Prospect/Opportunités/
-- Clients), au même prix qu'un compte classique pour le moment.
--
-- Remplace le code d'activation unique par société (companies.invite_code,
-- toujours en base pour compat mais plus affiché dans "Vue d'ensemble" —
-- voir app/app/team/page.jsx) par un code PAR SIÈGE COMMERCIAL : un
-- commercial rejoint désormais via LE code correspondant à SON siège, pas
-- via un code société générique.
--
-- IMPORTANT — limite assumée (Alex a confirmé vouloir avancer quand même,
-- 28/08/2026) : le choix des modules par siège ci-dessous ne fixe QUE le
-- prix Stripe de ce siège. Il n'existe today aucun mécanisme d'accès
-- restreint PAR UTILISATEUR dans l'app — les modules déblocables
-- (lockedModules, voir Shell/dashboard/etc.) restent un réglage AU NIVEAU
-- SOCIÉTÉ (companies.offer_ap_active/offer_as_active/offer_ac_active) : un
-- commercial d'un siège "Aaron Prospect seul" verra quand même tous les
-- modules actifs de la société dans l'app. À corriger dans un futur lot si
-- Alex veut une vraie restriction d'accès par commercial.

create table if not exists team_seats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  -- Saisis par le fondateur à la création du siège, avant même que le
  -- commercial ait rejoint (voir modale "Ajouter un compte équipe").
  first_name text not null,
  last_name text not null,
  job_title text,
  email text not null,

  -- Code d'activation unique pour CE siège (voir lib/invite-code.ts,
  -- generateSeatActivationCode) — le commercial l'utilise pour rejoindre
  -- via /api/join-company, qui le lie alors à ce siège (user_id ci-dessous).
  activation_code text not null unique,

  -- pending    : siège créé, commercial pas encore rattaché.
  -- active     : commercial rattaché (user_id renseigné).
  -- cancelled  : abonnement du siège résilié (lignes Stripe retirées) —
  --              conservé pour historique plutôt que supprimé, sauf
  --              suppression explicite du siège (DELETE, voir route).
  status text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),

  -- Renseigné une fois que le commercial a rejoint via son code (voir
  -- app/api/join-company/route.ts). NULL tant que le siège est en attente.
  user_id uuid references users(id) on delete set null,

  -- Modules choisis pour ce siège précis (indépendant des modules de la
  -- société elle-même) — voir limite assumée en tête de fichier.
  ap_active boolean not null default false,
  as_active boolean not null default false,
  ac_active boolean not null default false,

  -- Subscription items Stripe (un par module actif de CE siège), sur le
  -- MÊME abonnement Stripe que la société (companies.stripe_subscription_id)
  -- — une seule facture pour tout, cohérent avec lib/subscription.ts.
  stripe_subscription_item_ap text,
  stripe_subscription_item_as text,
  stripe_subscription_item_ac text,

  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists team_seats_company_id_idx on team_seats (company_id);
create index if not exists team_seats_user_id_idx on team_seats (user_id);

comment on table team_seats is 'Un compte équipe (siège commercial) souscrit par le fondateur, avec son propre code d''activation et son propre choix de modules Aaron — voir app/app/team/page.jsx (onglet "Abonnement équipes") et app/api/team/seats/*.';
comment on column team_seats.activation_code is 'Code unique par siège, utilisé par le commercial pour rejoindre via /api/join-company (remplace le code société unique companies.invite_code pour les nouveaux comptes équipe).';
