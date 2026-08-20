-- migration_support_draft_simple_2026-08-20.sql
-- Docx CLIENTS A1, "triage support niveau 1" : distingue les questions
-- simples/récurrentes (FAQ) des demandes complexes dans les suggestions de
-- réponse support. Voir lib/aaron-customer.ts (generateSupportReply) et
-- app/app/customer/page.jsx. L'envoi reste toujours manuel (un clic), voir
-- le commentaire déjà présent sur customer_support_drafts dans
-- migration_aaron_v2_2026-08-13.sql — pas de changement sur ce point.

alter table customer_support_drafts add column if not exists is_simple boolean not null default false;
