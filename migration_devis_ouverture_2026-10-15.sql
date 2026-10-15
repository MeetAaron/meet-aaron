-- migration_devis_ouverture_2026-10-15.sql
--
-- Suivi d'ouverture des DEVIS uniquement (Alex, 15/10/2026).
--
-- Pourquoi seulement le devis : un pixel de suivi dans un email froid ajoute
-- une image distante dans un message non sollicite, ce qui pese sur le score
-- de spam au moment precis ou la delivrabilite compte le plus. Sur un devis,
-- le destinataire attend le message : le risque disparait, et l'information
-- a une valeur reelle (savoir QUAND rappeler).
--
-- devis_track_token : identifiant opaque dans l'URL du pixel. Separe de
-- l'id du prospect expres — l'URL part chez le client, elle ne doit pas
-- reveler d'identifiant interne ni permettre d'enumerer les prospects.
--
-- devis_call_done_at : l'accuse de reception du commercial. Tant qu'il est
-- NULL, la story « il lit ton devis » reste ; des qu'il clique, elle
-- disparait et ne revient jamais pour ce devis. C'est la lecon des quatorze
-- notifications en boucle : une relance qui insiste devient du bruit.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS devis_track_token   text,
  ADD COLUMN IF NOT EXISTS devis_opened_at     timestamptz,
  ADD COLUMN IF NOT EXISTS devis_last_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS devis_open_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devis_call_done_at  timestamptz;

-- Index unique partiel : le token sert de cle de recherche a chaque
-- chargement du pixel, et deux prospects ne peuvent pas partager le meme.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_devis_track_token_key
  ON prospects (devis_track_token)
  WHERE devis_track_token IS NOT NULL;

COMMENT ON COLUMN prospects.devis_track_token IS
  'Jeton opaque du pixel de suivi d''ouverture du devis. Jamais reutilise.';
COMMENT ON COLUMN prospects.devis_opened_at IS
  'Premiere ouverture detectee du devis. Fiable a ~70 % : images bloquees ou prechargees.';
COMMENT ON COLUMN prospects.devis_call_done_at IS
  'Le commercial a traite la relance telephonique. La story ne reapparait plus.';
