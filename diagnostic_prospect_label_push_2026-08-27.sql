-- À lancer dans Supabase SQL editor (lecture seule, aucune modification).
--
-- Contexte : deux points signalés par Alex le 27/08/2026 après la correction
-- du scope Gmail (gmail.modify) :
--   1) quand le prospect envoie lui-même un email (pas juste une réponse
--      dans le flux normal), le libellé "🤖 Géré par Aaron" n'apparaît pas ;
--   2) aucune notification push "Nouveau rendez-vous à valider" reçue sur le
--      téléphone (PWA) alors qu'Aaron a bien écrit un email confirmant un
--      RDV visio ("dans 10 min").
--
-- Ces 5 requêtes donnent la visibilité nécessaire pour distinguer un vrai
-- bug d'un problème de configuration (scope manquant, abonnement push
-- expiré/jamais créé, prospect non reconnu...) sans accès direct à la base.

-- 1) Derniers prospects créés/modifiés — pour identifier le prospect de test
--    et vérifier qu'il est bien assigné, non "perdu", et pas repris en main
--    manuellement (ai_managed = false empêche à la fois le traitement ET le
--    libellé, par design — voir app/api/cron/check-inbox/route.ts).
select id, full_name, email, assigned_user_id, ai_managed, is_lost, deal_stage, created_at
from prospects
order by created_at desc
limit 15;

-- 2) Connexion(s) Google : scope gmail.modify bien présent + dernière lecture
--    de boîte mail (last_checked_at) — si ancien, le cron check-inbox peut
--    ne pas avoir encore relu les derniers messages (il tourne toutes les
--    5 minutes).
select user_id, provider, provider_account_email, scopes, last_checked_at,
  'https://www.googleapis.com/auth/gmail.modify' = any(scopes) as has_modify_scope
from oauth_connections
where provider = 'google'
order by created_at desc;

-- 3) Derniers messages ENTRANTS enregistrés — pour vérifier si le message
--    envoyé "spontanément" par le prospect a bien été capté par le cron
--    check-inbox (s'il n'apparaît pas ici du tout, le message n'a pas été
--    traité — donc pas labellisé, pour une raison à chercher via 1/2).
select conversation_id, direction, sender_email, recipient_email, provider_message_id, created_at
from messages
where direction = 'inbound'
order by created_at desc
limit 15;

-- 4) Derniers rendez-vous créés — pour vérifier si l'acceptation du
--    créneau ("dans 10 min") a bien fait passer appointment_proposal.detected
--    à true et créé une ligne "proposé" en attente de validation (si absent,
--    le problème est en amont, dans la détection elle-même).
select id, prospect_id, type, status, proposed_at, created_at
from appointments
order by created_at desc
limit 10;

-- 5) Abonnements push enregistrés — si vide (ou très ancien / absent pour
--    le bon user_id), aucune notification ne peut techniquement partir :
--    voir statut-2026-08-22-pwa-push-fix.md — après le correctif du 22/08,
--    toute icône PWA ajoutée à l'écran d'accueil AVANT cette date doit être
--    supprimée et réajoutée depuis Safari/Chrome, puis les notifications
--    push réactivées depuis Préférences, sinon aucun abonnement valide
--    n'existe et sendPushNotification() (lib/push.ts) ne trouve personne à
--    notifier (silencieux, ce n'est pas une erreur de son point de vue).
select user_id, endpoint, created_at
from push_subscriptions
order by created_at desc
limit 10;
