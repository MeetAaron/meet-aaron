-- migration_single_plan_2026-08-31.sql
-- Abonnement unique "Aaron" à 30 €/mois (docx Modifs Aaron 30/08/2026 +
-- décision Alex 31/08/2026 : "on modifie leur offre pour n'avoir qu'un seul
-- abonnement"). Les colonnes offer_*_active restent en place (lues partout
-- dans l'app) mais un abonnement Aaron actif inclut désormais tout :
-- Opportunités et Clients sont activés pour toute société abonnée, et pour
-- tout siège d'équipe actif. Le webhook Stripe fait de même pour les
-- nouvelles sociétés (app/api/webhooks/stripe/route.ts).
--
-- Côté Stripe (à faire à la main dans le Dashboard, une seule fois, pour les
-- abonnements existants créés avec plusieurs modules) : retirer les lignes
-- "Aaron Opportunités" et "Aaron Clients" de chaque abonnement pour ne
-- garder que la ligne à 30 € — sinon ces clients continueront d'être
-- facturés 60 ou 90 €.

update companies
set offer_as_active = true,
    offer_ac_active = true
where offer_ap_active = true;

update team_seats
set as_active = true,
    ac_active = true
where ap_active = true
  and status <> 'cancelled';
