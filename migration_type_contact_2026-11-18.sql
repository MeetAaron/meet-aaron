-- migration_type_contact_2026-11-18.sql
--
-- Type de contact : entreprise ou particulier (demande d'Alex, 18/11/2026).
-- Vide par défaut : tant que personne n'a choisi, l'application déduit le
-- type à l'affichage (société nommée, SIRET ou email professionnel =
-- entreprise ; sinon « à préciser »). Voir lib/contact-type.js.
--
-- Sans risque et rejouable : une colonne ajoutée, aucune donnée modifiée.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS client_type text;

ALTER TABLE prospects
  DROP CONSTRAINT IF EXISTS prospects_client_type_check;

ALTER TABLE prospects
  ADD CONSTRAINT prospects_client_type_check
  CHECK (client_type IS NULL OR client_type IN ('entreprise', 'particulier'));

COMMENT ON COLUMN prospects.client_type IS
  'entreprise | particulier | NULL (déduit à l''affichage, voir lib/contact-type.js). Posé à la main depuis la fiche contact, ou par Aaron quand la personne le dit.';

-- Contrôle : la colonne existe.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'prospects' AND column_name = 'client_type';
