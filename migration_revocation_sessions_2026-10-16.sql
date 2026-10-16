-- migration_revocation_sessions_2026-10-16.sql
-- CASA 2.2.2 : après une réinitialisation du mot de passe, toutes les
-- sessions de l'utilisateur sont révoquées (app/api/auth/reset-password).
-- Fonction appelable UNIQUEMENT par le service_role (serveur).

CREATE OR REPLACE FUNCTION public.revoke_all_sessions(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_all_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_all_sessions(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_sessions(uuid) TO service_role;
