-- diagnostic_nouveau_prospect_2026-08-30.sql
-- Diagnostic : pourquoi aucun message n'a été envoyé à fevre.alexandre01@gmail.com.
-- Lecture seule.

-- 1) La ou les fiches prospect avec cet email (la plus récente en premier)
select
  id,
  full_name,
  email,
  status,
  created_at,
  ai_managed,
  is_lost,
  is_won,
  pending_first_email_subject is not null as email_en_attente_validation,
  pending_first_email_generated_at,
  first_message_send_error,
  first_message_send_error_at
from prospects
where email = 'fevre.alexandre01@gmail.com'
order by created_at desc;

-- 2) Tous les messages liés à cet email (envoyés ou reçus)
select
  m.direction,
  m.sender_email,
  m.recipient_email,
  m.created_at,
  p.full_name,
  p.id as prospect_id
from messages m
join conversations c on c.id = m.conversation_id
join prospects p on p.id = c.prospect_id
where p.email = 'fevre.alexandre01@gmail.com'
order by m.created_at desc;

-- 3) Le commercial exige-t-il une validation manuelle avant le tout premier email ?
select id, email, require_first_email_approval
from users
where id = (
  select assigned_user_id from prospects
  where email = 'fevre.alexandre01@gmail.com'
  order by created_at desc
  limit 1
);
