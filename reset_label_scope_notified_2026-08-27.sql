-- À lancer dans Supabase SQL editor.
--
-- Contexte : le scope Gmail requis pour poser le libellé "🤖 Géré par Aaron"
-- s'est avéré être gmail.modify, pas gmail.labels comme cru le 25/08/2026
-- (voir app/api/auth/google/route.ts, commentaire du 27/08/2026 — gmail.labels
-- suffit pour lister/créer le label mais pas pour l'appliquer à un fil,
-- confirmé par un 403 sur threads.modify dans les logs Vercel malgré
-- gmail.labels présent).
--
-- app/api/cron/check-inbox/route.ts envoie une notification push UNE SEULE
-- FOIS par connexion (via label_scope_notified_at) pour inviter à reconnecter
-- Gmail. Les commerciaux déjà notifiés sous l'ancienne logique (gmail.labels
-- manquant) mais qui ont depuis reconnecté avec gmail.labels croient le
-- problème réglé — il ne l'est pas, et ils ne seront jamais re-notifiés sans
-- cette remise à zéro puisque label_scope_notified_at est déjà rempli.
--
-- Cette requête remet label_scope_notified_at à null uniquement pour les
-- connexions Google qui n'ont TOUJOURS PAS gmail.modify (donc concernées par
-- le vrai problème) — les connexions qui ont déjà gmail.modify ne sont pas
-- touchées.
update oauth_connections
set label_scope_notified_at = null
where provider = 'google'
  and not ('https://www.googleapis.com/auth/gmail.modify' = any(scopes));
