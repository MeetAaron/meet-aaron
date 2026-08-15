-- migration_first_email_approval_2026-08-15.sql
-- Fonctionnalité opt-in : validation humaine du tout premier email envoyé à
-- un nouveau prospect, avant envoi. Recherche marché (voir statut projet,
-- section 16) : le retour le plus cité sur les outils "AI SDR" concurrents
-- est que les équipes commerciales préfèrent garder un contrôle humain sur
-- le tout premier email plutôt qu'une automatisation 100% autonome — les
-- outils "hybrides" (relecture avant 1er envoi) sont cités comme obtenant
-- nettement plus de rendez-vous par euro dépensé que les outils 100%
-- autonomes.
--
-- Désactivé par défaut : AUCUN changement de comportement pour les comptes
-- existants tant que le commercial n'active pas l'option lui-même dans
-- Préférences. Les relances suivantes (après la 1ère réponse du prospect)
-- restent automatiques dans tous les cas — seul le tout premier email est
-- concerné.

alter table users add column if not exists require_first_email_approval boolean not null default false;

alter table prospects add column if not exists pending_first_email_subject text;
alter table prospects add column if not exists pending_first_email_body text;
alter table prospects add column if not exists pending_first_email_generated_at timestamptz;
