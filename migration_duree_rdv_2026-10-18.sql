-- migration_duree_rdv_2026-10-18.sql
-- Durée d'un rendez-vous (demande Alex, 18/10/2026 : « il faut une heure de
-- fin, de base ça se met sur 1 h »). Saisie dans « Ajouter dans l'agenda »
-- (heure de fin → durée), utilisée pour l'événement Google/Outlook, le flux
-- ICS du téléphone et la détection de conflit. NULL = 60 min.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS duration_minutes integer
  CHECK (duration_minutes IS NULL OR (duration_minutes >= 15 AND duration_minutes <= 480));

COMMENT ON COLUMN appointments.duration_minutes IS
  'Durée du RDV en minutes (15–480). NULL = 60 min par défaut.';
