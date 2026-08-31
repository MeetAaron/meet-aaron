-- migration_push_user_agent_2026-08-31.sql
-- Checklist « Mise en route » de Mon compte > Connexion (docx Modifs Aaron
-- 30/08/2026 : "2 lignes dédiées pour la notification push : ordinateur et
-- téléphone"). Pour afficher « Notifications activées sur ton téléphone ✓ »
-- depuis l'ordinateur (et inversement), on mémorise le navigateur/appareil
-- (user-agent) au moment où l'abonnement push est créé.
-- Voir app/api/push/subscribe/route.ts (POST stocke la colonne, GET la
-- renvoie) et SetupChecklist dans app/app/connexions/page.jsx.
--
-- Sans cette migration, rien ne casse : l'API réessaie sans la colonne, mais
-- la checklist ne pourra pas distinguer un téléphone d'un ordinateur.

alter table push_subscriptions add column if not exists user_agent text;
