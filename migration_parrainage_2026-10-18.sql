-- migration_parrainage_2026-10-18.sql
-- Parrainage automatique (validé par Alex le 18/10/2026) : trente jours
-- après la première commande confirmée, Aaron demande au client — depuis la
-- boîte du commercial, dans la langue du client — s'il connaît deux
-- confrères que ça pourrait aider. Une seule fois par client. Pour TOUS les
-- comptes : c'est une étape de prospection, pas du module Clients.
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS referral_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS referral_email_subject text,
  ADD COLUMN IF NOT EXISTS referral_email_body text;

COMMENT ON COLUMN prospects.referral_asked_at IS
  'Date de la demande de parrainage envoyée par Aaron (NULL = jamais demandé).';
