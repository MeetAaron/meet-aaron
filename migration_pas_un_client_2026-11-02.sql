-- migration_pas_un_client_2026-11-02.sql
--
-- « Tous ceux qui utilisent Aaron doivent être dans mon fichier client »
-- (Alex, 02/11/2026). Vrai, mais pas de tout le monde : le compte « CASA
-- Audit » existe pour l'audit de sécurité, il utilise Aaron et n'est pas un
-- client. Sans interrupteur, la fiche supprimée à la main serait recréée au
-- passage suivant du cron own-clients-sync.
--
-- Open X (la société du père d'Alex) reste INCLUSE : elle utilise vraiment
-- Aaron, et c'est à Alex de décider de son suivi.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS not_a_client boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.not_a_client IS
  'true = cette société utilise Aaron mais n''est pas un client de Meet Aaron (compte d''audit, bac à sable). Ignorée par le cron own-clients-sync.';

-- Le compte d'audit de sécurité.
UPDATE companies SET not_a_client = true
WHERE id = 'eb31b752-6a63-4fb2-8e02-1a23bcb79796';
