-- migration_checkin_cadence_2026-08-20.sql
-- Ajoute le compteur de check-ins par client, nécessaire pour appliquer la
-- cadence 30/90/180 jours demandée par Alex (docx CLIENTS A1, "check-ins de
-- satisfaction") au lieu de l'ancien intervalle fixe répété. Voir
-- app/api/cron/customer-checkins/route.ts.

alter table prospects add column if not exists checkin_count integer not null default 0;

-- Pour les clients qui ont déjà reçu au moins un check-in avant cette
-- migration, on initialise le compteur à 1 (pas à 0) pour ne pas leur
-- renvoyer immédiatement un check-in "premier palier" en double dès le
-- prochain passage du cron.
update prospects set checkin_count = 1 where last_checkin_sent_at is not null and checkin_count = 0;
