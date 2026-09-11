-- migration_messages_sujet_fil_2026-09-11.sql
--
-- FILS DE DISCUSSION CASSÉS (tests d'Alex du 11/09/2026).
--
-- Constat : dans la boîte du commercial comme dans celle du prospect, chaque
-- message d'Aaron ouvre une conversation SÉPARÉE. Quatre fils pour deux
-- échanges. Cause : aucun de nos trois expéditeurs (Gmail, Microsoft, IMAP)
-- ne pose les en-têtes « In-Reply-To » et « References », et chaque réponse
-- repart avec un objet inventé par le modèle.
--
-- Conséquences, au-delà de l'inconfort : le commercial perd l'historique, le
-- prospect reçoit des messages sans lien apparent entre eux, et les filtres
-- anti-spam voient une « réponse » qui ne répond à rien — un signal de
-- publipostage.
--
-- Ce qu'il manquait en base pour recoudre les fils : l'OBJET du message.
-- internet_message_id et provider_message_id sont déjà stockés ; le sujet,
-- non — or c'est lui qu'Outlook et Gmail utilisent pour regrouper.

alter table public.messages
  add column if not exists subject text;

comment on column public.messages.subject is
  'Objet du message. Sert à répondre avec « Re: <objet d''origine> » plutôt qu''avec un objet neuf, qui casserait le fil (11/09/2026).';

-- Retrouver rapidement le dernier message d'un échange pour y rattacher la
-- réponse (lib/email-threading.ts).
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
