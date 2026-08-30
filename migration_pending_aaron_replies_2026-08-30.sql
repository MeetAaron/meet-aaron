-- migration_pending_aaron_replies_2026-08-30.sql
-- Demande Alex (30/08/2026) : quand Aaron doit répondre à un prospect avec un
-- email un peu long/travaillé, l'envoyer dans les minutes qui suivent (rythme
-- du cron check-inbox, toutes les 5 min) peut paraître suspect — un humain ne
-- rédige pas une réponse réfléchie aussi vite. Cette table met en attente les
-- réponses jugées "longues" (voir lib/messaging.ts::computeHumanReplyDelayMs)
-- pour les envoyer plus tard au lieu d'immédiatement, via un nouveau cron
-- dédié (app/api/cron/send-pending-replies/route.ts). Les réponses courtes ne
-- passent pas par cette table et continuent d'être envoyées tout de suite,
-- comme avant.

create table if not exists pending_aaron_replies (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  -- Calculé une seule fois à la création (voir computeHumanReplyDelayMs) :
  -- moment à partir duquel le cron d'envoi est autorisé à envoyer ce message.
  send_after timestamptz not null,
  sent_at timestamptz,
  -- Posé si le prospect a été repris en main manuellement (ai_managed=false)
  -- ou marqué perdu APRÈS la mise en attente mais AVANT l'envoi effectif :
  -- le cron d'envoi revérifie ces conditions au moment de servir la file, et
  -- annule proprement plutôt que d'envoyer un email qu'on ne veut plus.
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table pending_aaron_replies is 'File d''attente des réponses email d''Aaron volontairement différées (email jugé "long", voir lib/messaging.ts) pour éviter une réponse trop rapide et donc suspecte aux yeux du prospect.';

-- Le cron d'envoi ne scanne que les lignes encore en attente : index partiel
-- pour rester rapide même si la table grossit avec l'historique des lignes
-- déjà traitées.
create index if not exists idx_pending_aaron_replies_due
  on pending_aaron_replies (send_after)
  where sent_at is null and cancelled_at is null;
