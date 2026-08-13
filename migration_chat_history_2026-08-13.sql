-- migration_chat_history_2026-08-13.sql
--
-- Persiste l'historique du chat avec Aaron (app/app/chat/page.jsx) et la
-- progression du questionnaire de découverte guidé (les 7 questions posées
-- une par une à l'inscription). Sans ça, tout est perdu en changeant de page
-- au milieu d'une conversation ou de l'onboarding (bug remonté par Alex le
-- 13/08 : son inscription "est passée à la trappe" en allant sur "Mes
-- documents" pendant le questionnaire).
--
-- À exécuter dans l'éditeur SQL Supabase.

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_id_created_at_idx
  on chat_messages (user_id, created_at);

-- Progression du questionnaire guidé : -1 = pas en cours (jamais commencé, ou
-- déjà terminé), 0 à 6 = index de la question en cours.
alter table users add column if not exists onboarding_step integer not null default -1;
alter table users add column if not exists onboarding_answers jsonb not null default '[]'::jsonb;
