-- cleanup_test_accounts_2026-08-12.sql
--
-- Supprime TOUTES les sociétés/utilisateurs de test, pour ne garder que le
-- compte lié à alexandre.fevre01@gmail.com (y compris l'email de test
-- "fevre.alexandre01@gmail.com" qui est explicitement supprimé).
--
-- ⚠️ IRRÉVERSIBLE — à lire avant d'exécuter :
--  1. Ce script ne touche QUE la base Supabase (tables ci-dessous). Il ne
--     résilie PAS les abonnements Stripe correspondants : va dans le
--     dashboard Stripe et annule/supprime les clients de test toi-même
--     AVANT ou APRÈS avoir lancé ce script (peu importe l'ordre, mais il
--     faut le faire des deux côtés).
--  2. Il ne supprime PAS les comptes dans Supabase Auth (Authentication >
--     Users) — seulement les lignes "métier" dans les tables ci-dessous.
--     Supprime les comptes auth correspondants toi-même dans le dashboard
--     Supabase (Authentication > Users) si tu veux un nettoyage complet,
--     sinon ces comptes resteront capables de se connecter mais tomberont
--     sur "Accès refusé" (plus de ligne "users" associée).
--  3. Le script s'arrête avec une erreur (sans rien supprimer) si aucun
--     compte "alexandre.fevre01@gmail.com" n'existe encore en base — pour
--     éviter de tout supprimer par erreur si l'email est mal orthographié
--     ou si le compte n'a pas encore été créé.
--  4. Fais une sauvegarde (Supabase > Database > Backups, ou un export)
--     avant de lancer si tu as le moindre doute.
--
-- À exécuter dans l'éditeur SQL Supabase.

do $$
declare
  keep_company_id uuid;
begin
  select company_id into keep_company_id
  from users
  where email = 'alexandre.fevre01@gmail.com'
  limit 1;

  if keep_company_id is null then
    raise exception 'Aucun compte "alexandre.fevre01@gmail.com" trouvé en base (ou pas encore rattaché à une société) — script arrêté, rien n''a été supprimé. Crée d''abord ce compte, ou vérifie l''orthographe de l''email.';
  end if;

  -- Tables dépendant d'un prospect / d'une conversation
  delete from messages
  where conversation_id in (
    select c.id from conversations c
    join prospects p on p.id = c.prospect_id
    where p.company_id <> keep_company_id
  );

  delete from notifications_log
  where user_id in (select id from users where company_id <> keep_company_id);

  delete from appointments
  where prospect_id in (select id from prospects where company_id <> keep_company_id);

  delete from conversations
  where prospect_id in (select id from prospects where company_id <> keep_company_id);

  delete from prospects
  where company_id <> keep_company_id;

  delete from prospect_companies
  where company_id <> keep_company_id;

  delete from prospecting_campaigns
  where company_id <> keep_company_id;

  delete from company_documents
  where company_id <> keep_company_id;

  delete from feedback_messages
  where company_id <> keep_company_id;

  -- Tables dépendant d'un utilisateur
  delete from availability_blocks
  where user_id in (select id from users where company_id <> keep_company_id);

  delete from availability_rules
  where user_id in (select id from users where company_id <> keep_company_id);

  delete from oauth_connections
  where user_id in (select id from users where company_id <> keep_company_id);

  delete from email_verifications
  where auth_user_id in (select auth_user_id from users where company_id <> keep_company_id);

  -- Enfin : utilisateurs et sociétés
  delete from users
  where company_id <> keep_company_id;

  delete from companies
  where id <> keep_company_id;

  raise notice 'Nettoyage terminé — seule la société % (alexandre.fevre01@gmail.com) a été conservée.', keep_company_id;
end $$;
