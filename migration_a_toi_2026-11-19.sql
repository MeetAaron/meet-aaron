-- migration_a_toi_2026-11-19.sql
--
-- « À toi » pour les emails (Alex, 19/11/2026). Quand un email reçu n'est
-- pas pour Aaron (affaire personnelle, histoire commune qu'il ne connaît pas,
-- expéditeur qui n'est pas un client potentiel), Aaron ne répond pas et
-- marque le contact : la notification « À toi » s'affiche tant que la marque
-- est là. Elle part quand le commercial dit que c'est fait, ou quand la
-- personne réécrit et qu'Aaron peut traiter.
--
-- Sans risque et rejouable : deux colonnes ajoutées, aucune donnée modifiée.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS a_toi_at timestamptz,
  ADD COLUMN IF NOT EXISTS a_toi_reason text;

COMMENT ON COLUMN prospects.a_toi_at IS
  'Quand Aaron a rendu la main sur un email reçu qui n''est pas pour lui (null = rien en attente).';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'prospects' AND column_name IN ('a_toi_at', 'a_toi_reason')
ORDER BY column_name;
