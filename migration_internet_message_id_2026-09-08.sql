-- migration_internet_message_id_2026-09-08.sql
--
-- CLÉ ANTI-DOUBLON STABLE pour les emails lus par le cron (check-inbox).
--
-- Jusqu'ici, un message reçu n'était reconnu comme « déjà traité » que par son
-- id Gmail/Graph (messages.provider_message_id). Or côté Outlook, cet id
-- dépend du DOSSIER : quand Aaron range un message reçu dans le dossier
-- « Géré par Aaron », l'id change. Si le cron plantait entre ce rangement et
-- la sauvegarde de sa position (oauth_connections.last_checked_at), le même
-- message réapparaissait au passage suivant sous un id inconnu — et Aaron
-- répondait DEUX fois au prospect.
--
-- internet_message_id = l'identifiant RFC 5322 (« Message-ID ») posé par le
-- serveur d'envoi, identique partout : quel que soit le dossier, le
-- fournisseur, ou le format d'id que Graph décide de renvoyer. Le code
-- (app/api/cron/check-inbox/route.ts) dédoublonne désormais d'abord sur
-- cette colonne, et garde provider_message_id en repli pour les lignes
-- écrites avant cette migration.
--
-- Pas de contrainte unique volontairement : les lignes historiques sont à
-- null, et un même Message-ID peut légitimement apparaître dans deux
-- conversations (email envoyé à deux contacts de la même société).

alter table public.messages
  add column if not exists internet_message_id text;

create index if not exists messages_internet_message_id_idx
  on public.messages (internet_message_id)
  where internet_message_id is not null;

comment on column public.messages.internet_message_id is
  'Message-ID RFC 5322 du mail (stable quel que soit le dossier/fournisseur) — clé anti-doublon principale du cron check-inbox depuis le 08/09/2026.';
