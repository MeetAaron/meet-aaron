-- Migration 28/08/2026 — Synchro bidirectionnelle agenda Aaron <-> calendrier
-- Google/Outlook du commercial (celui ajouté sur son iPhone dans Réglages >
-- Calendrier, pas besoin d'iCloud puisque Google/Outlook est déjà connecté
-- pour l'envoi d'emails).
--
-- Demande Alex (28/08/2026, verbatim) : "tu me confirmes que les rdvs vont se
-- mettre dans l'agenda du commercial c'est ca ? L'agenda sur son iphone ? Et
-- si il a un rdv on est d'accord qu'aaron mettras dans son propre agenda du
-- genre 'rdv géré par Ludovic (si le commercial s'appelle Ludovic)'. et si le
-- commercial a un rdv medical par exemple dans son agenda iphone alors pareil
-- aaron en rend note et le mets dans son propre agenda 'rdv medical'. [...]
-- Et pareil, quand le commercial mets une indisponibilité ou un rdv
-- manuellement dans l'agenda aaron, ca se met dans l'agenda de l'iphone du
-- commercial. La seule exception est : les crenaux récurrents (pas besoin que
-- ca se mette sur l'agenda iphone car ca poluera visuellement tout son
-- agenda lol)."
--
-- Deux directions distinctes, deux jeux de colonnes distincts sur
-- availability_blocks (même RDV/indispo ne peut pas être à la fois "poussé
-- par Aaron" et "tiré depuis le calendrier externe") :
--   - Aaron -> Google/Outlook (RDV/indispo créés manuellement dans l'agenda
--     Aaron) : calendar_event_id / calendar_provider (déjà le pattern utilisé
--     sur `appointments`, repris ici à l'identique).
--   - Google/Outlook -> Aaron (événements déjà présents sur le calendrier du
--     commercial, remontés en indisponibilité générique par le cron de
--     synchro) : source / external_event_id.
--
-- Les créneaux de disponibilité récurrents (availability_rules) ne sont PAS
-- concernés par cette migration : ils ne sont et ne seront jamais poussés
-- vers Google/Outlook (exception explicitement demandée par Alex).

alter table availability_blocks add column if not exists source text not null default 'manuel';
-- 'manuel' = créée à la main par le commercial dans l'agenda Aaron (peut être
--   poussée vers Google/Outlook, voir calendar_event_id ci-dessous)
-- 'sync'   = remontée automatiquement depuis le calendrier Google/Outlook du
--   commercial par le cron sync-external-calendar (voir external_event_id)

alter table availability_blocks add column if not exists calendar_event_id text;
alter table availability_blocks add column if not exists calendar_provider text; -- 'google' | 'microsoft'
alter table availability_blocks add column if not exists external_event_id text;

comment on column availability_blocks.source is 'manuel = créée à la main dans Aaron ; sync = remontée automatiquement depuis Google/Outlook';
comment on column availability_blocks.calendar_event_id is 'id de l''événement créé par Aaron dans Google/Outlook quand ce bloc a été poussé (source=manuel uniquement)';
comment on column availability_blocks.calendar_provider is 'google | microsoft — provider concerné, dans un sens comme dans l''autre';
comment on column availability_blocks.external_event_id is 'id de l''événement Google/Outlook d''origine quand ce bloc a été remonté depuis le calendrier externe (source=sync uniquement)';

-- Empêche le cron de synchro de créer deux fois le même bloc pour le même
-- événement externe s'il tourne deux fois de suite avant que la réconciliation
-- n'ait terminé (idempotence des upserts du cron).
create unique index if not exists availability_blocks_external_uidx
  on availability_blocks (user_id, external_event_id)
  where external_event_id is not null;

-- Lien d'abonnement calendrier (webcal://) en option complémentaire, pour un
-- commercial qui n'a ni Google ni Microsoft connecté, ou qui veut un flux Aaron
-- séparé de son compte pro. Token opaque plutôt que l'id utilisateur : l'URL
-- circule potentiellement hors de l'app (collée dans les réglages Calendrier
-- de l'iPhone), un id utilisateur devinable exposerait les RDV de n'importe
-- qui.
alter table users add column if not exists ics_feed_token uuid;

comment on column users.ics_feed_token is 'Token opaque pour le flux ICS (webcal://) en lecture seule des RDV Aaron de ce commercial. NULL tant que jamais généré (généré à la demande, voir /api/agenda/ics-link).';
