-- migration_chat_conversations_2026-08-25.sql
--
-- Passe le chat avec Aaron d'un unique fil de discussion par commercial à
-- plusieurs conversations distinctes (demande d'Alex, 25/08/2026) :
-- "possibilité d'ouvrir une nouvelle conversation" + "possibilité de mettre
-- une conv en favoris".
--
-- Choix de conservation : ILLIMITÉE (comme Claude/ChatGPT), pas de plafond à
-- 10 conversations avec suppression automatique de la plus ancienne. Alex
-- posait la question ("ou alors tu peux toutes les conserver... ou ca
-- couterait trop cher en api ?") — la réponse est que garder tout l'historique
-- ne coûte RIEN de plus en appels API : seule la conversation actuellement
-- ouverte est envoyée à Claude comme contexte (déjà limitée, voir
-- HISTORY_LIMIT dans app/api/chat-history/route.ts) — les autres conversations
-- dorment simplement en base, coût de stockage négligeable pour du texte. Le
-- favori (is_favorite) devient donc un simple épinglage en haut de liste pour
-- retrouver une conversation importante plus vite, pas une protection contre
-- une suppression automatique qui n'existe plus.
--
-- À exécuter dans l'éditeur SQL Supabase.

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_id_updated_at_idx
  on chat_conversations (user_id, updated_at desc);

alter table chat_messages
  add column if not exists conversation_id uuid references chat_conversations(id) on delete cascade;

-- Reprise de l'historique existant : chaque commercial qui a déjà des
-- messages (mais aucune conversation encore créée) reçoit une conversation
-- "de reprise" couvrant ses messages passés, pour ne rien perdre. Idempotent :
-- ne crée rien si le commercial a déjà au moins une conversation.
insert into chat_conversations (user_id, title, created_at, updated_at)
select cm.user_id, null, min(cm.created_at), max(cm.created_at)
from chat_messages cm
where cm.conversation_id is null
  and not exists (select 1 from chat_conversations cc where cc.user_id = cm.user_id)
group by cm.user_id;

-- Rattache les messages orphelins à la conversation de leur utilisateur
-- (créée juste au-dessus, ou déjà existante si la migration est rejouée).
update chat_messages cm
set conversation_id = cc.id
from chat_conversations cc
where cm.conversation_id is null
  and cc.user_id = cm.user_id;
