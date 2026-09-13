-- diagnostic_rangement_gmail_2026-09-13.sql
--
-- « Le libellé "Managed by Aaron" a bien été créé et l'email est dedans,
--   mais il est aussi resté dans la boîte de réception. »
--
-- Dans Gmail, un libellé EST un dossier : un fil peut porter le libellé ET
-- rester en boîte de réception en même temps. « Ranger », côté Gmail, c'est
-- retirer le libellé système INBOX — c'est exactement ce que fait Aaron,
-- mais seulement si la préférence ci-dessous est active.
--
-- Le code ne range QUE si users.aaron_archive_threads n'est pas false.
-- NULL = on range (comportement par défaut). false = on ne range pas.

-- ── 1. La préférence, pour chaque commercial ─────────────────────────────
select
  u.email,
  u.aaron_archive_threads,
  case
    when u.aaron_archive_threads is false then 'NE RANGE PAS — voilà la cause'
    when u.aaron_archive_threads is null  then 'range (valeur par défaut)'
    else 'range'
  end as comportement
from public.users u
order by u.email;

-- ── 2. Correction pour ta boîte de test ──────────────────────────────────
-- À décommenter et jouer si la ligne ci-dessus dit « NE RANGE PAS ».
-- update public.users
--    set aaron_archive_threads = true
--  where email = 'testcustomer1980@gmail.com';

-- ── 3. Le cron a-t-il seulement lu la boîte depuis ta réponse ? ──────────
-- Si last_checked_at est ANTÉRIEUR à l'arrivée de la réponse, Aaron n'a pas
-- encore vu le message : rien n'a été rangé simplement parce que rien n'a
-- encore été traité. Le cron passe toutes les 5 minutes.
select
  oc.provider,
  oc.provider_account_email,
  oc.last_checked_at,
  now() - oc.last_checked_at as depuis
from public.oauth_connections oc
order by oc.last_checked_at desc nulls first;
