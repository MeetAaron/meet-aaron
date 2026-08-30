-- migration_email_verification_error_log_2026-08-30.sql
-- Bug remonté par Alex (30/08/2026) : "l'envoi de l'email de confirmation a
-- échoué" à l'inscription, déjà vu la veille (27/08/2026, compte de son
-- père). L'envoi passe par un seul compte Gmail "système" configuré via la
-- variable d'environnement SYSTEM_EMAIL_SENDER_USER_ID (voir
-- lib/google.ts -> sendSystemEmail) — TOUTE inscription email/mot de passe
-- de TOUS les clients de Meet Aaron dépend de la connexion Google de CE SEUL
-- compte. Si son token est révoqué/expiré côté Google (mot de passe changé,
-- accès révoqué manuellement, refresh token périmé) ou si ce compte Gmail
-- personnel atteint sa limite d'envoi quotidienne, TOUS les nouveaux comptes
-- échouent à recevoir leur email de confirmation, sans qu'Alex ait un moyen
-- de voir POURQUOI (l'erreur réelle n'était jusqu'ici que dans les logs
-- serveur, jamais stockée nulle part de consultable).
--
-- Cette migration ajoute juste de quoi stocker l'erreur réelle du prochain
-- échec, pour la diagnostiquer sans avoir besoin d'accès aux logs serveur —
-- voir app/api/auth/send-verification/route.ts et
-- app/api/auth/resend-verification/route.ts (mis à jour pour écrire dedans).

alter table email_verifications add column if not exists send_error text;
alter table email_verifications add column if not exists send_error_at timestamptz;

comment on column email_verifications.send_error is 'Message d''erreur brut si l''envoi de l''email de confirmation a échoué (voir sendSystemEmail dans lib/google.ts) — permet de diagnostiquer sans accès aux logs serveur.';
