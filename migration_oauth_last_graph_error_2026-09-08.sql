-- migration_oauth_last_graph_error_2026-09-08.sql
-- Mémorise la DERNIÈRE erreur renvoyée par Microsoft Graph pour une connexion
-- Outlook (catégorie, dossier, déplacement, envoi…). Jusqu'ici ces échecs
-- étaient avalés en silence : trois semaines sans jamais voir ce que Microsoft
-- répondait. Écrit par lib/microsoft.ts::graphRequest, lu par
-- /api/diagnostics/outlook. Sans effet côté Gmail.

alter table public.oauth_connections
  add column if not exists last_graph_error text,
  add column if not exists last_graph_error_at timestamptz;

comment on column public.oauth_connections.last_graph_error is
  'Dernière réponse d''échec de Microsoft Graph (libellé de l''étape → statut HTTP + corps), pour diagnostic.';
