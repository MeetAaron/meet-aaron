-- migration_limite_debit_2026-10-23.sql
-- Limitation de débit PARTAGÉE entre toutes les instances serverless
-- (CASA 1.1.1). Utilisée par lib/rate-limit.ts (checkRateLimit). Les clés
-- sont des empreintes SHA-256 : aucune IP ni adresse email en clair.
-- Accès serveur uniquement (RLS sans politique + fonction service_role).
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS TABLE(allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_reset timestamptz;
BEGIN
  INSERT INTO public.rate_limit_hits AS r (key, count, reset_at)
  VALUES (p_key, 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
    reset_at = CASE WHEN r.reset_at <= now() THEN now() + make_interval(secs => p_window_seconds) ELSE r.reset_at END
  RETURNING r.count, r.reset_at INTO v_count, v_reset;

  -- Ménage occasionnel (environ 1 appel sur 50) des fenêtres expirées.
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_hits WHERE reset_at < now() - interval '1 hour';
  END IF;

  RETURN QUERY SELECT v_count <= p_limit, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset - now())))::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;
