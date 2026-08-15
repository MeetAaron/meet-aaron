-- migration_dashboard_missed_actions_2026-08-15.sql
-- CHANGEMENTS A FAIRE #2/#3 (bandeau "actions manquées" du tableau de bord) :
--  - missed_action_acknowledged : le commercial peut "prendre connaissance"
--    d'un RDV resté non validé alors que sa date est dépassée, sans que ça
--    déclenche une action (validation/annulation/relance) — juste masquer la
--    notif. Voir PATCH /api/appointments/[id] action "acquitter_manque" et
--    app/app/dashboard/page.jsx.
--  - created_at : garanti présent (ajout défensif si jamais absent) pour
--    calculer le compteur "RDV obtenu" du tableau de bord sur une fenêtre
--    glissante de 24h (CHANGEMENTS A FAIRE #4/#9A).
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table appointments add column if not exists missed_action_acknowledged boolean not null default false;
alter table appointments add column if not exists created_at timestamptz not null default now();
