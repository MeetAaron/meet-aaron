-- migration_credits_per_module_2026-08-20.sql
-- Tache #140 (Preferences/Abonnement) : soldes de credits separes par module
-- (Aaron Prospect / Aaron Sales / Aaron Customer) au lieu d'un seul pool
-- partage. Le pool general existant (companies.credit_balance_eur) est
-- CONSERVE tel quel pour les appels transverses (chat general, onboarding,
-- demande CRM sur-mesure, avis documents, resume d'entreprise, rapport
-- equipe...). Les 3 nouvelles colonnes ne servent que pour les appels
-- specifiques a un module.
--
-- A executer manuellement dans l'editeur SQL Supabase (aucun acces direct
-- a la base depuis l'agent).

alter table public.companies
  add column if not exists credit_balance_ap_eur numeric(10,2) not null default 0,
  add column if not exists credit_balance_as_eur numeric(10,2) not null default 0,
  add column if not exists credit_balance_ac_eur numeric(10,2) not null default 0;

-- Colonne optionnelle sur le journal des transactions : NULL = pool general
-- (comportement actuel inchange), 'ap'/'as'/'ac' = mouvement sur le pool
-- du module correspondant.
alter table public.credit_transactions
  add column if not exists module text check (module in ('ap', 'as', 'ac'));

comment on column public.companies.credit_balance_ap_eur is 'Solde de credits (EUR) reserve aux appels IA du module Aaron Prospect, hors plafond mensuel/quotidien inclus dans l abonnement.';
comment on column public.companies.credit_balance_as_eur is 'Solde de credits (EUR) reserve aux appels IA du module Aaron Sales (Opportunites), hors plafond mensuel/quotidien inclus dans l abonnement.';
comment on column public.companies.credit_balance_ac_eur is 'Solde de credits (EUR) reserve aux appels IA du module Aaron Customer (Clients), hors plafond mensuel/quotidien inclus dans l abonnement.';
comment on column public.credit_transactions.module is 'NULL = pool general partage (comportement historique). ap/as/ac = mouvement sur le solde de credits propre a ce module (tache #140).';
