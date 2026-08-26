-- cleanup_aaron_meetaaron_account_2026-08-26.sql
--
-- Reprend exactement le script qu'Alex avait déjà utilisé avec succès pour
-- réinitialiser ses comptes de test (alexandre.fevre01@gmail.com /
-- fevre.alexandre01@gmail.com), adapté à aaron@meetaaron.app.
--
-- Différence clé avec ma tentative précédente (delete from auth.users) :
-- CE script ne touche PAS auth.users — il supprime uniquement la ligne
-- "public.users" (et toutes les données de sa société), en laissant le
-- compte Supabase Auth intact. C'est ce qui fait que ça marche : au
-- prochain login, /api/auth/link (app/api/auth/link/route.ts) ne retrouve
-- plus AUCUN profil "users" correspondant (ni par auth_user_id, ni par
-- email) → il renvoie 404 → app/onboarding/page.jsx affiche bien le
-- formulaire d'inscription au lieu de rediriger direct vers le dashboard →
-- passage par Stripe garanti. Le compte Google/Supabase Auth réutilisé au
-- prochain login ne pose aucun problème : le webhook Stripe créera une
-- nouvelle ligne "users" avec ce même auth_user_id.
--
-- Portée : liste de tables identique à celle du trigger de
-- migration_account_deletion_2026-08-25.sql (branche "solo", déjà revue et
-- utilisée en production), donc plus complète que le script d'origine
-- d'Alex (qui datait d'avant l'ajout de plusieurs tables : quotes,
-- customer_checkins, products, crm_connections, credit_transactions,
-- api_usage_*, chat_messages, push_subscriptions, email_send_counters,
-- client_invoices, marketing_campaigns*, reactivation_batches).
--
-- Sécurité : abandonne sans rien supprimer si aaron@meetaaron.app fait
-- partie d'une société avec d'autres membres (ne devrait jamais arriver
-- pour ce compte de test, mais évite une suppression accidentelle plus
-- large si jamais quelqu'un d'autre l'avait rejoint entre-temps).
--
-- ⚠️ IRRÉVERSIBLE — à exécuter dans l'éditeur SQL Supabase (aucun accès
-- direct à la base depuis l'agent).

do $$
declare
  v_company_id uuid;
  v_sibling_count int;
  v_prospect_ids uuid[];
  v_quote_ids uuid[];
begin
  select company_id into v_company_id
  from users
  where email = 'aaron@meetaaron.app';

  if v_company_id is null then
    raise notice 'Aucun compte trouvé pour aaron@meetaaron.app — rien n''a été supprimé.';
    return;
  end if;

  select count(*) into v_sibling_count from users where company_id = v_company_id;
  if v_sibling_count > 1 then
    raise notice 'La société de aaron@meetaaron.app contient % utilisateur(s) — abandon par sécurité (script prévu pour un compte solo). Rien n''a été supprimé.', v_sibling_count;
    return;
  end if;

  select array_agg(id) into v_prospect_ids from prospects where company_id = v_company_id;
  select array_agg(id) into v_quote_ids from quotes where company_id = v_company_id;

  delete from messages
  where conversation_id in (
    select c.id from conversations c
    join prospects p on p.id = c.prospect_id
    where p.company_id = v_company_id
  );

  if v_prospect_ids is not null and array_length(v_prospect_ids, 1) > 0 then
    delete from customer_checkins where prospect_id = any(v_prospect_ids);
    delete from customer_health_alerts where prospect_id = any(v_prospect_ids);
    delete from customer_support_drafts where prospect_id = any(v_prospect_ids);
    delete from deal_stage_alerts where prospect_id = any(v_prospect_ids);
  end if;

  delete from notifications_log where user_id in (select id from users where company_id = v_company_id);
  delete from appointments where prospect_id in (select id from prospects where company_id = v_company_id);
  delete from conversations where prospect_id in (select id from prospects where company_id = v_company_id);

  if v_quote_ids is not null and array_length(v_quote_ids, 1) > 0 then
    delete from quote_line_items where quote_id = any(v_quote_ids);
  end if;
  delete from quotes where company_id = v_company_id;

  delete from prospects where company_id = v_company_id;
  delete from prospect_companies where company_id = v_company_id;
  delete from prospecting_campaigns where company_id = v_company_id;
  delete from company_documents where company_id = v_company_id;
  delete from feedback_messages where company_id = v_company_id;
  delete from products where company_id = v_company_id;
  delete from crm_connections where company_id = v_company_id;
  delete from credit_transactions where company_id = v_company_id;
  delete from api_usage_monthly where company_id = v_company_id;
  delete from api_usage_daily where company_id = v_company_id;

  delete from client_invoices where company_id = v_company_id;
  delete from marketing_campaign_recipients
    where campaign_id in (select id from marketing_campaigns where company_id = v_company_id);
  delete from marketing_campaigns where company_id = v_company_id;
  delete from reactivation_batches where company_id = v_company_id;

  delete from chat_messages where user_id in (select id from users where company_id = v_company_id);
  delete from push_subscriptions where user_id in (select id from users where company_id = v_company_id);
  delete from email_send_counters where user_id in (select id from users where company_id = v_company_id);
  delete from availability_blocks where user_id in (select id from users where company_id = v_company_id);
  delete from availability_rules where user_id in (select id from users where company_id = v_company_id);
  delete from oauth_connections where user_id in (select id from users where company_id = v_company_id);
  delete from email_verifications where auth_user_id in (select auth_user_id from users where company_id = v_company_id);

  -- users PUIS companies en dernier (FK) — et volontairement PAS auth.users,
  -- voir l'explication en tête de fichier.
  delete from users where company_id = v_company_id;
  delete from companies where id = v_company_id;

  raise notice 'Nettoyage terminé pour aaron@meetaaron.app — société % supprimée. Compte Supabase Auth conservé (réutilisable pour une réinscription propre).', v_company_id;
end $$;
