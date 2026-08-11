-- ==================================================================
-- MEET AARON — MIGRATION : chantiers SMTP / rôles / disponibilités /
--                          synthèse documents / suggestions chat
-- Date : 2026-08-11
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run
-- (Alex : comme d'habitude, pense à nommer le snippet une fois collé,
--  ex: "migration chantiers 2-8")
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. Confirmation d'email "maison" (remplace le mailer Supabase par
--    défaut) — chantier SMTP
-- ------------------------------------------------------------------
create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  email text not null,
  token text not null unique,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists idx_email_verifications_token on email_verifications(token);
create index if not exists idx_email_verifications_auth_user on email_verifications(auth_user_id);

-- ------------------------------------------------------------------
-- 2. Choix du rôle à l'inscription — un commercial rejoint une
--    société existante via un code d'invitation généré par le patron
-- ------------------------------------------------------------------
alter table companies add column if not exists invite_code text unique;

-- ------------------------------------------------------------------
-- 3. Planning de disponibilité + indisponibilités manuelles
-- ------------------------------------------------------------------
create table if not exists availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = dimanche
  start_time time not null,
  end_time time not null,
  appointment_type text, -- 'visio' | 'tel' | 'physique' | null = tous types
  created_at timestamptz not null default now()
);
create index if not exists idx_availability_rules_user on availability_rules(user_id);

create table if not exists availability_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_availability_blocks_user on availability_blocks(user_id);

-- ------------------------------------------------------------------
-- 4. Synthèse automatique des documents à l'upload
-- ------------------------------------------------------------------
alter table company_documents add column if not exists summary text;

-- ------------------------------------------------------------------
-- 5. Relais automatique des suggestions faites dans le chat au
--    fondateur (feedback_messages existait déjà pour le bouton
--    manuel "Signaler à l'équipe")
-- ------------------------------------------------------------------
alter table feedback_messages add column if not exists source text not null default 'manual'; -- 'manual' | 'chat_auto'
alter table feedback_messages add column if not exists context text; -- extrait de la conversation, pour contexte au patron
