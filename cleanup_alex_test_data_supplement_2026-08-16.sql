-- cleanup_alex_test_data_supplement_2026-08-16.sql
--
-- COMPLÉMENT à cleanup_alex_test_data_2026-08-13.sql.
--
-- Pourquoi ce fichier existe : le script du 13/08 couvrait les tables qui
-- existaient à cette date. Depuis, le chantier "CHANGEMENTS A FAIRE" (Lots
-- 1 à 13) a ajouté 14 nouvelles tables métier qui peuvent contenir des
-- données liées aux deux comptes de test d'Alex :
--   - alexandre.fevre01@gmail.com
--   - fevre.alexandre01@gmail.com
-- Ce script supprime UNIQUEMENT ces 14 tables-là. Il ne touche à rien de
-- ce que le script du 13/08 gère déjà (messages, prospects, users,
-- companies, etc.) — les deux scripts sont complémentaires, pas redondants.
--
-- ⚠️ ORDRE D'EXÉCUTION IMPORTANT : exécute ce script AVANT
-- cleanup_alex_test_data_2026-08-13.sql (ou dans n'importe quel ordre tant
-- que les deux sont exécutés le même jour) — ce script retrouve les
-- sociétés cibles par lui-même via la table "users" (qui n'est supprimée
-- que par l'AUTRE script). Si tu exécutes d'abord le script du 13/08, les
-- lignes "users"/"companies" auront déjà disparu et celui-ci ne trouvera
-- plus rien à nettoyer (il s'arrêtera proprement sans rien supprimer,
-- aucun risque, mais tu louperais le nettoyage de ces 14 tables).
--
-- ⚠️ NE TOUCHE PAS à aaron@meetaaron.app — même garde-fou que le script du
-- 13/08 : ce compte n'apparaît jamais comme "commercial" dans "users", donc
-- il ne peut pas être ciblé par construction.
--
-- ⚠️ IRRÉVERSIBLE — mêmes précautions que le script du 13/08 (sauvegarde
-- Supabase avant exécution si le moindre doute).
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
  where email in ('alexandre.fevre01@gmail.com', 'fevre.alexandre01@gmail.com');

  if target_company_ids is null or array_length(target_company_ids, 1) = 0 then
    raise notice 'Aucun compte trouvé pour ces deux emails (déjà nettoyé, ou script du 13/08 déjà exécuté avant celui-ci) — rien n''a été supprimé.';
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

  -- Tables dépendant d'un devis (quote_id) — à supprimer avant "quotes"
  if target_quote_ids is not null and array_length(target_quote_ids, 1) > 0 then
    delete from quote_line_items
    where quote_id = any(target_quote_ids);
  end if;

  -- Tables dépendant d'un prospect (prospect_id) — à supprimer avant "prospects"
  -- (note : "prospects" lui-même reste supprimé par le script du 13/08, pas ici)
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

  -- Tables dépendant d'un utilisateur (user_id) — à supprimer avant "users"
  -- (note : "users" lui-même reste supprimé par le script du 13/08, pas ici)
  if target_user_ids is not null and array_length(target_user_ids, 1) > 0 then
    delete from chat_messages
    where user_id = any(target_user_ids);

    delete from push_subscriptions
    where user_id = any(target_user_ids);

    delete from email_send_counters
    where user_id = any(target_user_ids);
  end if;

  -- Tables dépendant directement de la société (company_id)
  delete from quotes
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

  raise notice 'Nettoyage complémentaire terminé — % société(s) traitée(s) (14 tables ajoutées depuis le 13/08 : quote_line_items, quotes, products, crm_connections, credit_transactions, api_usage_monthly, api_usage_daily, chat_messages, push_subscriptions, email_send_counters, customer_checkins, customer_health_alerts, customer_support_drafts, deal_stage_alerts). Pense à exécuter aussi cleanup_alex_test_data_2026-08-13.sql (avant ou après, peu importe l''ordre) pour supprimer prospects/users/companies eux-mêmes.', nb_companies;
end $$;
