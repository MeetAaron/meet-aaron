-- diagnostic_reponse_aaron_2026-08-30.sql
-- Diagnostic : pourquoi Aaron n'a pas encore répondu à un email de test.
-- Lecture seule, aucune modification.

-- 1) Connexions email connectées : la boîte est-elle bien lue régulièrement ?
--    (last_checked_at doit avancer toutes les ~5 minutes si le cron tourne)
select
  provider,
  provider_account_email,
  last_checked_at,
  now() - last_checked_at as depuis_derniere_lecture,
  scopes
from oauth_connections
where provider in ('google', 'microsoft')
order by last_checked_at desc nulls last;

-- 2) Derniers messages (entrants ET sortants), tous prospects confondus
select
  m.direction,
  m.sender_email,
  m.recipient_email,
  m.created_at,
  p.full_name,
  p.ai_managed,
  p.is_lost,
  p.is_won
from messages m
join conversations c on c.id = m.conversation_id
join prospects p on p.id = c.prospect_id
order by m.created_at desc
limit 20;

-- 3) Derniers prospects modifiés : statut, et erreur éventuelle du tout
--    premier message (colonne ajoutée le 30/08)
select
  id,
  full_name,
  email,
  status,
  status_updated_at,
  ai_managed,
  is_lost,
  is_won,
  first_message_send_error,
  first_message_send_error_at
from prospects
order by status_updated_at desc nulls last
limit 10;
