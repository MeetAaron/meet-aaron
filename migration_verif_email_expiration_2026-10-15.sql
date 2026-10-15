-- migration_verif_email_expiration_2026-10-15.sql
--
-- Les liens de confirmation d'adresse n'expiraient JAMAIS et etaient
-- rejouables (constate pendant l'audit CASA du 15/10/2026).
--
-- Concretement : un lien de confirmation vieux de six mois, retrouve dans
-- une boite mail, reconfirmait le compte. Et app/api/auth/verify-email ne
-- verifiait ni l'expiration ni l'usage precedent — il acceptait meme une
-- ligne deja marquee `verified`.
--
-- C'est exactement ce que visent les exigences CASA 1.3.1 (« Out of band
-- verifier shall expire in a reasonable timeframe ») et 1.3.2 (« Out of
-- band verifier shall only be used once »).
--
-- Le jeton lui-meme etait deja correct : 32 octets aleatoires de
-- crypto.randomBytes, donc 1.3.3 et 1.3.4 etaient tenues. Il ne manquait
-- que la duree de vie et l'usage unique.

ALTER TABLE email_verifications
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 24 heures. Plus court serait penible pour quelqu'un qui s'inscrit le soir
-- et ouvre ses mails le lendemain matin ; plus long n'apporte rien.
ALTER TABLE email_verifications
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

-- Lignes existantes : on NE les fait PAS expirer retroactivement. Un compte
-- cree hier et pas encore confirme doit pouvoir l'etre ; invalider d'un
-- coup tous les liens en circulation transformerait un correctif de
-- securite en panne pour de vrais utilisateurs. Elles recoivent 24 h a
-- compter de maintenant, et le regime normal s'applique ensuite.
UPDATE email_verifications
   SET expires_at = now() + interval '24 hours'
 WHERE expires_at IS NULL
   AND verified IS NOT TRUE;

-- Les lignes deja confirmees recoivent une date passee : elles sont de
-- toute facon refusees par le controle d'usage unique cote code.
UPDATE email_verifications
   SET expires_at = now()
 WHERE expires_at IS NULL;

-- Pas d'index a creer : idx_email_verifications_token existe deja
-- (migration_chantiers_2026-08-11.sql), et token porte deja une
-- contrainte UNIQUE.

COMMENT ON COLUMN email_verifications.expires_at IS
  'Fin de validite du lien de confirmation (24 h). Au-dela, verify-email refuse le jeton.';
