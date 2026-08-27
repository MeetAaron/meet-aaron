-- cleanup_aaron_meetaaron_account_2026-08-26.sql (v3 — retour au script prouvé)
--
-- Alex a signalé que la v2 (avec gardes to_regclass sur des tables
-- supplémentaires : quotes, customer_checkins, products, crm_connections,
-- credit_transactions, api_usage_*, chat_messages, push_subscriptions,
-- email_send_counters, client_invoices, marketing_campaigns*,
-- reactivation_batches) n'a pas correctement supprimé le compte
-- aaron@meetaaron.app. Cette v3 abandonne complètement ces ajouts et reprend
-- EXACTEMENT la structure et la liste de tables du script qu'Alex utilise
-- avec succès depuis le début pour ses propres emails de test
-- (alexandre.fevre01@gmail.com / fevre.alexandre01@gmail.com) — seule la
-- cible change (aaron@meetaaron.app au lieu des deux emails d'Alex).
--
-- Les tables retirées ne bloquent jamais un nouveau passage par
-- onboarding+Stripe (seule la suppression de "users"/"companies" compte
-- pour ça, voir app/api/auth/link/route.ts) — au pire, elles laissent des
-- lignes orphelines liées à un company_id qui n'existe plus plus, ce qui
-- est inoffensif et n'était de toute façon pas le problème résolu ici.
--
-- Ne touche PAS auth.users (volontaire, voir explication historique
-- ci-dessous) : au prochain login, /api/auth/link ne retrouve plus AUCUN
-- profil "users" correspondant (ni par auth_user_id, ni par email) → 404 →
-- app/onboarding/page.jsx affiche le formulaire d'inscription au lieu de
-- rediriger direct vers le dashboard → passage par Stripe garanti. Le
-- compte Google/Supabase Auth réutilisé au prochain login ne pose aucun
-- problème : le webhook Stripe créera une nouvelle ligne "users" avec ce
-- même auth_user_id.
--
-- ⚠️ IRRÉVERSIBLE — à exécuter dans l'éditeur SQL Supabase (aucun accès
-- direct à la base depuis l'agent).

do $$
declare
  target_company_ids uuid[];
  nb_companies int;
begin
  select array_agg(distinct company_id) into target_company_ids
  from users
  where email in ('aaron@meetaaron.app');

  if target_company_ids is null or array_length(target_company_ids, 1) = 0 then
    raise notice 'Aucun compte trouvé pour aaron@meetaaron.app --- rien n''a été supprimé.';
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

  raise notice 'Nettoyage terminé --- % société(s) supprimée(s) (aaron@meetaaron.app). Compte Supabase Auth conservé (réutilisable pour une réinscription propre).', nb_companies;
end $$;
