-- migration_alertes_abonnement_2026-11-02.sql
--
-- Questions d'Alex (02/11/2026) :
--   « quand un client ne paye pas il est coupé des services ? »
--   « pour le coupon il faut prévenir quelques jours avant en disant que le
--     compte sera débité automatiquement »
--
-- Le code savait déjà COUPER (lib/subscription-status.ts : 7 jours de grâce
-- puis suspension de l'IA) mais ne PRÉVENAIT personne : ni à l'échec du
-- prélèvement, ni avant la fin d'une remise. Deux colonnes de marquage
-- suffisent, pour n'envoyer chaque alerte qu'une fois.
--
-- Voir app/api/cron/subscription-alerts/route.ts.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dunning_alert_stage smallint,
  ADD COLUMN IF NOT EXISTS dunning_alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_end_alerted_for date;

COMMENT ON COLUMN companies.dunning_alert_stage IS
  'Dernier palier d''alerte "paiement refusé" envoyé (1 = jour du refus, 2 = J+3, 3 = J+6). Remis à NULL dès que le paiement passe.';
COMMENT ON COLUMN companies.dunning_alert_sent_at IS
  'Date d''envoi du dernier palier d''alerte "paiement refusé".';
COMMENT ON COLUMN companies.discount_end_alerted_for IS
  'Date de fin de remise pour laquelle le client a déjà été prévenu — évite de renvoyer l''alerte chaque jour.';
