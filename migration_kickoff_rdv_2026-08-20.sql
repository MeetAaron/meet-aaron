-- migration_kickoff_rdv_2026-08-20.sql
-- Tâche #141 (sous-item 1, docx "CLIENTS") : RDV de lancement auto-négocié
-- à l'onboarding. Ajoute la distinction "commercial" vs "lancement" sur les
-- RDV (table appointments, déjà utilisée pour les RDV de prospection/vente),
-- et des horodatages/contenu en cache sur prospects pour piloter l'envoi
-- automatique de la proposition de créneaux de lancement et son unique
-- relance (à J+4) — sans jamais faire répondre Aaron automatiquement à un
-- client au fil de l'échange (principe déjà en place, voir lib/aaron-customer.ts).

alter table appointments
  add column if not exists purpose text not null default 'commercial'
    check (purpose in ('commercial', 'lancement'));

comment on column appointments.purpose is
  'commercial = RDV de prospection/vente classique (comportement historique, valeur par défaut). lancement = RDV de lancement (kick-off) proposé automatiquement au client au moment de l''onboarding (tâche #141).';

alter table prospects
  add column if not exists kickoff_call_proposed_at timestamptz,
  add column if not exists kickoff_call_subject text,
  add column if not exists kickoff_call_body text,
  add column if not exists kickoff_call_followup_sent_at timestamptz;

comment on column prospects.kickoff_call_proposed_at is
  'Horodatage d''envoi de la proposition automatique de créneaux pour le RDV de lancement (onboarding, tâche #141). NULL = pas encore proposé.';
comment on column prospects.kickoff_call_subject is
  'Sujet de l''email de proposition de RDV de lancement, mis en cache pour permettre à app/api/cron/kickoff-followup de relancer sans repayer un appel Claude.';
comment on column prospects.kickoff_call_body is
  'Corps de l''email de proposition de RDV de lancement, mis en cache pour la relance (voir kickoff_call_subject).';
comment on column prospects.kickoff_call_followup_sent_at is
  'Horodatage de l''unique relance automatique (à J+4 sans réponse) de la proposition de RDV de lancement.';
