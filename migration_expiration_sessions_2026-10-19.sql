-- migration_expiration_sessions_2026-10-19.sql
-- CASA 2.2.1 : l'expiration d'une session doit invalider côté serveur les
-- jetons de rafraîchissement (stateful), pas seulement laisser expirer le
-- jeton d'accès (stateless, 1 h). Sur l'offre Supabase utilisée, les
-- réglages « Time-box user sessions » et « Inactivity timeout » ne sont pas
-- disponibles : on applique la même politique nous-mêmes.
--
-- Politique : une session est supprimée (et avec elle, par clé étrangère,
-- tous ses refresh tokens) quand elle a plus de 30 jours (durée absolue) ou
-- qu'elle n'a pas été rafraîchie depuis 7 jours (inactivité). Le navigateur
-- concerné reçoit alors « invalid refresh token » au prochain
-- rafraîchissement et repasse par /login. Appelée toutes les heures par le
-- cron /api/cron/expire-sessions (lib/session-expiry.ts).
--
-- Fonction appelable UNIQUEMENT par le service_role (serveur).

CREATE OR REPLACE FUNCTION public.expire_stale_sessions(p_max_age_days integer DEFAULT 30, p_inactive_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT s.id
    FROM auth.sessions s
    WHERE s.created_at < now() - make_interval(days => p_max_age_days)
       OR COALESCE(s.refreshed_at, s.updated_at, s.created_at) < now() - make_interval(days => p_inactive_days)
       OR (s.not_after IS NOT NULL AND s.not_after < now())
  ),
  del_tokens AS (
    DELETE FROM auth.refresh_tokens rt
    WHERE rt.session_id IN (SELECT id FROM doomed)
    RETURNING 1
  ),
  del_sessions AS (
    DELETE FROM auth.sessions s
    WHERE s.id IN (SELECT id FROM doomed)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del_sessions;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_sessions(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_sessions(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_sessions(integer, integer) TO service_role;

-- Lecture (pour la preuve CASA et le suivi) : nombre de sessions actives et
-- la plus ancienne, sans exposer les jetons.
CREATE OR REPLACE FUNCTION public.session_stats()
RETURNS TABLE(active_sessions bigint, oldest_session timestamptz, oldest_refresh timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*), min(created_at), min(COALESCE(refreshed_at, updated_at, created_at)) FROM auth.sessions;
$$;

REVOKE ALL ON FUNCTION public.session_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_stats() TO service_role;
