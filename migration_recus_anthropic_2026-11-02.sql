-- migration_recus_anthropic_2026-11-02.sql
--
-- « C'est ridicule, change ça en automatique, je ne vais pas le faire
-- manuellement à chaque fois » (Alex, 31/10/2026, à propos de la saisie du
-- solde Anthropic après chaque recharge).
--
-- lib/anthropic-receipts.ts lit les reçus de recharge dans la boîte Meet
-- Aaron et enregistre le nouveau solde tout seul. Cette colonne marque le
-- message d'où vient chaque solde : sans elle, le même reçu serait crédité
-- à chaque passage du cron. L'index unique est la vraie protection — le
-- code vérifie avant d'insérer, la base refuse si deux passages se croisent.

ALTER TABLE public.api_balance_snapshots
  ADD COLUMN IF NOT EXISTS source_message_id text;

COMMENT ON COLUMN public.api_balance_snapshots.source_message_id IS
  'Identifiant du message Gmail (reçu de recharge) dont ce solde a été déduit. NULL = solde saisi à la main par Alex dans /app/marge.';

CREATE UNIQUE INDEX IF NOT EXISTS api_balance_snapshots_source_message_id_idx
  ON public.api_balance_snapshots (source_message_id)
  WHERE source_message_id IS NOT NULL;
