-- ==================================================================
-- MEET AARON — MIGRATION : adresse de facturation reelle,
--                          resume d'activite, visite guidee
-- Date : 2026-08-11 (soir)
-- Executee directement par Claude (autorisation donnee par Alex)
-- ==================================================================

-- 1. Adresse de facturation reelle (collectee par Stripe Checkout)
alter table companies add column if not exists billing_address jsonb;

-- 2. Resume d'activite de la societe, genere par Aaron a partir des
--    documents fournis + de la description donnee dans le chat
alter table companies add column if not exists business_summary text;

-- 3. Visite guidee de l'appli vue ou non (par utilisateur, revisible
--    depuis Preferences)
alter table users add column if not exists onboarding_tour_seen boolean not null default false;
