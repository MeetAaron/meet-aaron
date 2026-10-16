-- migration_handoff_tokens_2026-10-16.sql
--
-- Le jeton de session ne doit JAMAIS apparaitre dans une URL (CASA 2.1.1).
--
-- Jusqu'ici, sept routes atteintes par navigation complete (demarrage OAuth
-- Google/Microsoft/HubSpot/Salesforce/Jobber/Pipedrive, et la fiche vCard)
-- recevaient le jeton de session Supabase en parametre ?token=. Une URL,
-- ca se retrouve dans les journaux d'acces de l'hebergeur, dans l'historique
-- du navigateur, et dans l'en-tete Referer des pages ouvertes ensuite.
--
-- Remplacement : un jeton de PASSAGE a usage unique, 5 minutes, lie a un
-- utilisateur et a une destination. La table oauth_qr_tokens faisait deja
-- exactement cela pour le QR code telephone ; on elargit simplement la
-- liste des destinations autorisees. Le jeton est consomme atomiquement
-- (UPDATE ... WHERE used_at IS NULL ... RETURNING), donc deux navigations
-- concurrentes ne peuvent pas passer toutes les deux.

ALTER TABLE oauth_qr_tokens
  DROP CONSTRAINT IF EXISTS oauth_qr_tokens_provider_check;

ALTER TABLE oauth_qr_tokens
  ADD CONSTRAINT oauth_qr_tokens_provider_check
  CHECK (provider IN ('google', 'microsoft', 'hubspot', 'salesforce', 'jobber', 'pipedrive', 'vcard'));

COMMENT ON TABLE oauth_qr_tokens IS
  'Jetons de passage a usage unique (5 min) pour les routes atteintes par navigation : demarrage OAuth et vCard. Le jeton de session ne va jamais dans une URL.';
