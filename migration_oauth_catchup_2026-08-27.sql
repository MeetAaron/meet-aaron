-- Rattrapage automatique de la lecture de boîte mail après coupure/reconnexion
-- (demande Alex, 27/08/2026, suite à l'audit du comportement déco/reco avec
-- Ludovic : "si on se deco reco alors aaron relis les messages de la boite
-- mail selon la durée de la déconnexion").
--
-- Avant ce correctif, app/api/cron/check-inbox ne regardait TOUJOURS que les
-- 5 dernières minutes à chaque passage, quelle que soit la durée d'une
-- éventuelle coupure de la boîte mail (token révoqué, commercial déconnecté
-- puis reconnecté, panne côté Google/Microsoft...). Un prospect ayant
-- répondu PENDANT cette coupure n'était donc jamais rattrapé automatiquement.
--
-- last_checked_at mémorise l'heure de la DERNIÈRE lecture RÉUSSIE de cette
-- boîte mail par le cron. Le code (app/api/cron/check-inbox/route.ts) l'utilise
-- désormais comme point de départ réel de la fenêtre de lecture, au lieu d'un
-- fixe "il y a 5 minutes" : après 20 minutes de coupure, le premier passage
-- réussi après reconnexion relit exactement les 20 dernières minutes — ni
-- trou, ni retraitement inutile (une sécurité anti-doublon sur
-- messages.provider_message_id protège en plus contre tout léger
-- recouvrement). Plafonné à 48h côté code pour éviter de rebalayer des mois
-- de boîte mail si une connexion reste invalide très longtemps.

alter table oauth_connections
  add column if not exists last_checked_at timestamptz;

comment on column oauth_connections.last_checked_at is
  'Heure de la dernière lecture réussie de la boîte mail par app/api/cron/check-inbox — sert de point de départ pour la fenêtre de lecture suivante (rattrapage auto après coupure/reconnexion), plafonné à 48h côté code.';
