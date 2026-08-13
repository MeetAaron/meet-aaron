-- cleanup_alex_test_data_2026-08-13.sql
--
-- Supprime TOUTES les données liées aux comptes de test d'Alex :
--   - alexandre.fevre01@gmail.com
--   - fevre.alexandre01@gmail.com
-- (société(s), utilisateurs, prospects, conversations, RDV, campagnes, etc.)
-- pour repartir de zéro ce soir et retester comme un nouveau client.
--
-- ⚠️ NE TOUCHE PAS à aaron@meetaaron.app : ce n'est pas une société cliente,
-- c'est le compte d'envoi système d'Aaron (n'apparaît jamais dans la table
-- "users" comme "commercial"), donc ce script ne peut pas y toucher par
-- construction — rien à faire de spécial pour le préserver.
--
-- ⚠️ IRRÉVERSIBLE — à lire avant d'exécuter :
--  1. Ce script ne touche QUE la base Supabase (tables ci-dessous). Il ne
--     résilie PAS d'éventuels abonnements Stripe de test : vérifie le
--     dashboard Stripe si tu avais créé des clients de test avec ces emails.
--  2. Il ne supprime PAS les comptes dans Supabase Auth (Authentication >
--     Users) — seulement les lignes "métier" dans les tables ci-dessous.
--     Supprime les comptes auth correspondants toi-même dans le dashboard
--     Supabase (Authentication > Users) si tu veux repartir 100% à zéro
--     (sinon, en retestant ce soir avec le même email, l'inscription
--     pourrait buter sur "email déjà utilisé" côté Supabase Auth).
--  3. Le script s'arrête sans rien supprimer si aucun des deux emails
--     n'est trouvé en base (évite un DELETE silencieux sur du vide en cas
--     de faute de frappe email).
--  4. Gère le cas où les deux emails appartiennent à la même société ou à
--     deux sociétés différentes (peu importe le cas, tout est nettoyé).
--  5. Fais une sauvegarde (Supabase > Database > Backups, ou un export)
--     avant de lancer si tu as le moindre doute.
--
-- À exécuter dans l'éditeur SQL Supabase.

do $$
declare
  target_company_ids uuid[];
  nb_companies int;
begin
  select array_agg(distinct company_id) into target_company_ids
  from users
  where email in ('alexandre.fevre01@gmail.com', 'fevre.alexandre01@gmail.com');

  if target_company_ids is null or array_length(target_company_ids, 1) = 0 then
    raise notice 'Aucun compte trouvé pour ces deux emails — rien n''a été supprimé.';
    return;
  end if;

  nb_companies := array_length(target_company_ids, 1);

  -- Tables dépendant d'un prospect / d'une conversation
  delete from messages
  where conversation_id in (
    select c.id from conversations c
    join prospects p on p.id = c.prospect_id
    where p.company_id = any(target_company_ids)
  );

  delete from notifications_log
  where user_id in (select id from users where company_id = any(target_company_ids));

  delete from appointments
  where prospect_id in (select id from prospects where company_id = any(target_company_ids));

  delete from conversations
  where prospect_id in (select id from prospects where company_id = any(target_company_ids));

  delete from prospects
  where company_id = any(target_company_ids);

  delete from prospect_companies
  where company_id = any(target_company_ids);

  delete from prospecting_campaigns
  where company_id = any(target_company_ids);

  delete from company_documents
  where company_id = any(target_company_ids);

  delete from feedback_messages
  where company_id = any(target_company_ids);

  -- Tables dépendant d'un utilisateur
  delete from availability_blocks
  where user_id in (select id from users where company_id = any(target_company_ids));

  delete from availability_rules
  where user_id in (select id from users where company_id = any(target_company_ids));

  delete from oauth_connections
  where user_id in (select id from users where company_id = any(target_company_ids));

  delete from email_verifications
  where auth_user_id in (select auth_user_id from users where company_id = any(target_company_ids));

  -- Enfin : utilisateurs et sociétés
  delete from users
  where company_id = any(target_company_ids);

  delete from companies
  where id = any(target_company_ids);

  raise notice 'Nettoyage terminé — % société(s) supprimée(s) (alexandre.fevre01@gmail.com / fevre.alexandre01@gmail.com). aaron@meetaaron.app non affecté.', nb_companies;
end $$;
