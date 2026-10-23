-- migration_devis_retour_email_2026-10-23.sql
-- Devis renvoyé par email (pièce jointe signée ou annotée à la main), lu par
-- Aaron dans le cron check-inbox — voir lib/quote-return.ts. Idempotent.
-- Sans cette migration, la détection fonctionne quand même (signature →
-- client gagné ; modifications → notification + étape « en négociation »),
-- seul l'encart « retour du devis » de la fiche reste vide.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS devis_return_kind text,
  ADD COLUMN IF NOT EXISTS devis_return_summary text,
  ADD COLUMN IF NOT EXISTS devis_return_changes jsonb,
  ADD COLUMN IF NOT EXISTS devis_return_confidence integer,
  ADD COLUMN IF NOT EXISTS devis_return_at timestamptz,
  ADD COLUMN IF NOT EXISTS devis_return_file_path text,
  ADD COLUMN IF NOT EXISTS devis_return_file_name text;

COMMENT ON COLUMN public.prospects.devis_return_kind IS
  'Retour du devis lu par Aaron : signed | signed_with_changes | changes_requested.';
COMMENT ON COLUMN public.prospects.devis_return_changes IS
  'Modifications lues sur le devis renvoyé : [{ line, change }].';
COMMENT ON COLUMN public.prospects.devis_return_file_path IS
  'Copie du document renvoyé dans le bucket Storage « documents ».';

-- 23/10/2026 (bis) : Aaron ne rédige plus de devis révisé ; il conseille le
-- commercial, qui corrige et renvoie lui-même son devis.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS devis_return_advice text;
