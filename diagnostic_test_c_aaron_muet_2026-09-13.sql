-- diagnostic_test_c_aaron_muet_2026-09-13.sql
--
-- « Aaron n'a pas répondu aux 2 emails du test C » — ce script dit OÙ la
-- chaîne s'est cassée. Elle a exactement quatre maillons :
--
--   1. le cron lit la boîte             -> oauth_connections.last_checked_at
--   2. il retrouve le prospect          -> prospects.email = expéditeur
--                                          ET assigned_user_id = commercial
--   3. il enregistre le message entrant -> messages.direction = 'inbound'
--   4. Aaron répond                     -> messages.direction = 'outbound'
--
-- Chaque requête ci-dessous teste UN maillon. Le premier qui répond « rien »
-- est le coupable.

-- ── 1. Les boîtes sont-elles lues ? ────────────────────────────────────────
-- last_checked_at doit dater de moins de ~10 minutes. Vieux ou NULL = le cron
-- n'arrive pas à lire cette boîte (jeton expiré, mot de passe IMAP changé).
select
  oc.provider,
  oc.provider_account_email,
  oc.last_checked_at,
  now() - oc.last_checked_at as depuis,
  u.email as commercial
from public.oauth_connections oc
join public.users u on u.id = oc.user_id
order by oc.last_checked_at desc nulls first;

-- ── 2. L'expéditeur correspond-il à UN SEUL prospect de CE commercial ? ────
-- Le code fait .single() : s'il y a DEUX lignes pour le même email chez le
-- même commercial, la requête échoue et le message est IGNORÉ en silence.
-- Toute ligne avec nb > 1 est une cause directe du problème.
select
  p.email,
  p.assigned_user_id,
  count(*) as nb,
  bool_or(p.ai_managed) as au_moins_un_gere_par_aaron,
  bool_or(p.is_won)     as au_moins_un_gagne,
  bool_or(p.is_lost)    as au_moins_un_perdu
from public.prospects p
group by p.email, p.assigned_user_id
having count(*) > 1
order by nb desc;

-- ── 3. Les messages entrants ont-ils été enregistrés ? ─────────────────────
-- Les 48 dernières heures, tous sens confondus, dans l'ordre.
-- Si on ne voit QUE des 'outbound' : le cron n'a jamais reconnu la réponse
-- (maillon 2). Si on voit un 'inbound' sans 'outbound' derrière : Aaron a
-- bien reçu, mais n'a pas répondu (triage ou génération).
select
  m.created_at,
  m.direction,
  m.sender_email,
  m.recipient_email,
  m.subject,
  left(coalesce(m.body, ''), 120) as debut_du_message,
  p.full_name as prospect,
  p.ai_managed,
  p.is_won,
  p.is_lost
from public.messages m
join public.conversations c on c.id = m.conversation_id
join public.prospects p     on p.id = c.prospect_id
where m.created_at > now() - interval '48 hours'
order by m.created_at asc;

-- ── 4. Des entrants restés sans réponse ? ──────────────────────────────────
-- Un 'inbound' dont aucun 'outbound' ne suit dans la même conversation.
-- C'est la liste exacte des emails qu'Aaron a laissés sans réponse.
select
  p.full_name,
  p.email,
  p.ai_managed,
  p.is_won,
  p.is_lost,
  m.created_at as recu_le,
  m.subject,
  left(coalesce(m.body, ''), 200) as message
from public.messages m
join public.conversations c on c.id = m.conversation_id
join public.prospects p     on p.id = c.prospect_id
where m.direction = 'inbound'
  and m.created_at > now() - interval '7 days'
  and not exists (
    select 1 from public.messages r
    where r.conversation_id = m.conversation_id
      and r.direction = 'outbound'
      and r.created_at > m.created_at
  )
order by m.created_at desc;
