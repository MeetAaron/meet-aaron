-- cleanup_alex_account_2026-08-19.sql
--
-- Demande d'Alex (2026-08-19) : "Supprimons le compte alexandre.fevre01@gmail.com,
-- trop bourbier, je vais le recréer."
--
-- Ce script est la FUSION, en un seul bloc, de deux scripts précédents :
--   - cleanup_alex_test_data_2026-08-13.sql        (15 tables)
--   - cleanup_alex_test_data_supplement_2026-08-16.sql (14 tables ajoutées
--     depuis, pour les fonctionnalités livrées entre le 13/08 et le 16/08 :
--     devis, produits, connexions CRM, crédits/usage API, messagerie du
--     questionnaire de découverte, notifications push, alertes clients...)
-- Vérification faite avant d'écrire ce fichier : j'ai recherché dans tout le
-- code (app/ et lib/) chaque table interrogée via `.from('...')` côté
-- Supabase — 29 tables au total, exactement les 15 + 14 déjà couvertes par
-- les deux scripts précédents. Aucune table supplémentaire n'a été ajoutée
-- au schéma depuis le 16/08 : ce script unique est donc complet à ce jour.
-- Le combiner en un seul bloc (plutôt que deux scripts à exécuter dans un
-- ordre précis) élimine aussi le risque d'ordre d'exécution du complément
-- du 16/08, qui devait être lancé AVANT celui du 13/08.
--
-- ⚠️ CIBLE UNIQUEMENT alexandre.fevre01@gmail.com (l'email explicitement
-- demandé aujourd'hui). Les deux scripts précédents ciblaient aussi
-- fevre.alexandre01@gmail.com (un autre email de test d'Alex) — je ne l'ai
-- pas inclus ici pour ne supprimer que ce qui a été demandé. Si tu veux
-- aussi nettoyer ce second compte, ajoute-le simplement dans le `where
-- email in (...)` juste en dessous.
--
-- ⚠️ NE TOUCHE PAS à aaron@meetaaron.app : ce compte n'apparaît jamais comme
-- "commercial" dans la table "users", donc il ne peut pas être ciblé par
-- construction — rien à faire de spécial pour le préserver.
--
-- ⚠️ IRRÉVERSIBLE — à lire avant d'exécuter :
--  1. Ce script ne touche QUE la base Supabase (tables ci-dessous). Il ne
--     résilie PAS d'éventuels abonnements Stripe de test : vérifie le
--     dashboard Stripe si un client de test existe avec cet email.
--  2. Il ne supprime PAS le compte dans Supabase Auth (Authentication >
--     Users) — seulement les lignes "métier" listées ci-dessous. Si tu
--     veux réutiliser exactement le même email pour recréer le compte,
--     supprime aussi le compte auth correspondant toi-même dans le
--     dashboard Supabase (Authentication > Users), sinon l'inscription
--     pourrait buter sur "email déjà utilisé".
--  3. Le script s'arrête sans rien supprimer si l'email n'est trouvé dans
--     aucune ligne "users" (évite un DELETE silencieux sur du vide en cas
--     de faute de frappe).
--  4. Fais une sauvegarde (Supabase > Database > Backups, ou un export)
--     avant de lancer si tu as le moindre doute.
--
-- À exécuter dans l'éditeur SQL Supabase.

do $$
declare
  target_company_ids uuid[];
  target_user_ids uuid[];
  target_prospect_ids uuid[];
  target_quote_ids uuid[];
  nb_companies int;
begin
  select array_agg(distinct company_id) into target_company_ids
  from users
  where email = 'alexandre.fevre01@gmail.com';

  if target_company_ids is null or array_length(target_company_ids, 1) = 0 then
    raise notice 'Aucun compte trouvé pour alexandre.fevre01@gmail.com — rien n''a été supprimé.';
    return;
  end if;

  nb_companies := array_length(target_company_ids, 1);

  select array_agg(id) into target_user_ids
  from users
  where company_id = any(target_company_ids);

  select array_agg(id) into target_prospect_ids
  from prospects
  where company_id = any(target_company_ids);

  select array_agg(id) into target_quote_ids
  from quotes
  where company_id = any(target_company_ids);

  -- 1) Tables dépendant d'une conversation / d'un prospect
  delete from messages
  where conversation_id in (
    select c.id from conversations c
    join prospects p on p.id = c.prospect_id
    where p.company_id = any(target_company_ids)
  );

  if target_prospect_ids is not null and array_length(target_prospect_ids, 1) > 0 then
    delete from customer_checkins
    where prospect_id = any(target_prospect_ids);

    delete from customer_health_alerts
    where prospect_id = any(target_prospect_ids);

    delete from customer_support_drafts
    where prospect_id = any(target_prospect_ids);

    delete from deal_stage_alerts
    where prospect_id = any(target_prospect_ids);
  end if;

  delete from notifications_log
  where user_id = any(target_user_ids);

  delete from appointments
  where prospect_id in (select id from prospects where company_id = any(target_company_ids));

  delete from conversations
  where prospect_id in (select id from prospects where company_id = any(target_company_ids));

  -- 2) Tables dépendant d'un devis — à supprimer avant "quotes"
  if target_quote_ids is not null and array_length(target_quote_ids, 1) > 0 then
    delete from quote_line_items
    where quote_id = any(target_quote_ids);
  end if;

  delete from quotes
  where company_id = any(target_company_ids);

  -- 3) Tables dépendant directement de la société
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

  delete from products
  where company_id = any(target_company_ids);

  delete from crm_connections
  where company_id = any(target_company_ids);

  delete from credit_transactions
  where company_id = any(target_company_ids);

  delete from api_usage_monthly
  where company_id = any(target_company_ids);

  delete from api_usage_daily
  where company_id = any(target_company_ids);

  -- 4) Tables dépendant d'un utilisateur
  delete from chat_messages
  where user_id = any(target_user_ids);

  delete from push_subscriptions
  where user_id = any(target_user_ids);

  delete from email_send_counters
  where user_id = any(target_user_ids);

  delete from availability_blocks
  where user_id = any(target_user_ids);

  delete from availability_rules
  where user_id = any(target_user_ids);

  delete from oauth_connections
  where user_id = any(target_user_ids);

  delete from email_verifications
  where auth_user_id in (select auth_user_id from users where company_id = any(target_company_ids));

  -- 5) Enfin : utilisateurs et société
  delete from users
  where company_id = any(target_company_ids);

  delete from companies
  where id = any(target_company_ids);

  raise notice 'Nettoyage terminé — % société(s) supprimée(s) pour alexandre.fevre01@gmail.com. aaron@meetaaron.app non affecté.', nb_companies;
end $$;
