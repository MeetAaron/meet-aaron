-- migration_negotiation_confidence_2026-08-23.sql
--
-- Docx pipeline (discussion Alex 2026-08-23) : score de conviction Aaron
-- pour la détection automatique de "en négociation" (remplace l'ancienne
-- étape 100% manuelle). Stocké sur chaque prospect pour affichage du badge
-- "signal détecté" (score toujours visible, jamais un simple oui/non caché
-- — voir doc pipeline section I.4).

alter table prospects add column if not exists negotiation_confidence_score int;
alter table prospects add column if not exists negotiation_confidence_reason text;
alter table prospects add column if not exists negotiation_confidence_updated_at timestamptz;
