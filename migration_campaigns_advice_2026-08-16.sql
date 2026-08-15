-- migration_campaigns_advice_2026-08-16.sql
-- CHANGEMENTS A FAIRE #14/#16 (page Campagnes) :
--  - advice / advice_generated_at : avis d'Aaron mis en cache par campagne
--    (affiché sur chaque carte, régénérable à la demande — voir
--    POST /api/campaigns/[id]/advice et app/app/campaigns/page.jsx). Mis en
--    cache plutôt que régénéré à chaque affichage pour ne pas consommer
--    d'appels Claude inutilement.
--  - ended_manually_at : permet de distinguer une campagne "Terminée" parce
--    que l'objectif de contacts a été atteint (comportement automatique
--    existant, voir lib/sourcing.ts) d'une campagne arrêtée volontairement
--    par le commercial avant d'avoir atteint son objectif (nouveau bouton
--    "Terminer maintenant" / "Mettre en pause" — voir
--    PATCH /api/campaigns/[id]).
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospecting_campaigns add column if not exists advice text;
alter table prospecting_campaigns add column if not exists advice_generated_at timestamptz;
alter table prospecting_campaigns add column if not exists ended_manually_at timestamptz;
