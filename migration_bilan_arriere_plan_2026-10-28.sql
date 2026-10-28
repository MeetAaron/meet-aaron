-- 28/10/2026 — Bilan de RDV en arrière-plan.
-- Le bilan est enregistré immédiatement ; la note d'Aaron et l'email de
-- remerciement sont faits après la réponse. Cette colonne garde la raison
-- d'un échec d'envoi pour l'afficher sur la page de bilan (sinon : journaux
-- Vercel seulement). Tout le code a un repli si elle n'existe pas.
alter table appointments add column if not exists thank_you_error text;
