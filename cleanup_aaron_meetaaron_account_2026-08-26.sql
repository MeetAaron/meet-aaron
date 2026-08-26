-- cleanup_aaron_meetaaron_account_2026-08-26.sql (v2 — tables optionnelles sécurisées)
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
-- v2 (26/08/2026, correctif) : la v1 a échoué avec
-- "relation marketing_campaign_recipients does not exist" — cette table
-- (issue de la liste du trigger de migration_account_deletion_2026-08-25.sql)
-- n'existe en fait pas dans ta base réelle. Comme tout tourne dans une
-- seule transaction implicite, l'échec a annulé TOUT le bloc — rien n'avait
-- donc été supprimé, aucune casse. Cette v2 vérifie l'existence de chaque
-- table optionnelle via to_regclass(...) avant de tenter un delete dessus,
-- pour ne plus jamais bloquer sur une table absente/renommée. Les tables
-- garanties présentes (users, companies, prospects, messages,
-- conversations, appointments, oauth_connections, availability_*,
-- email_verifications) restent en delete direct, sans garde.
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

  -- quotes / quote_line_items (tables optionnelles)
  if to_regclass('public.quotes') is not null then
    select array_agg(id) into v_quote_ids from quotes where company_id = v_company_id;
  end if;

  delete from messages
  where conversation_id in (
    select c.id from conversations c
    join prospects p on p.id = c.prospect_id
    where p.company_id = v_company_id
  );

  if v_prospect_ids is not null and array_length(v_prospect_ids, 1) > 0 then
    if to_regclass('public.customer_checkins') is not null then
      delete from customer_checkins where prospect_id = any(v_prospect_ids);
    end if;
    if to_regclass('public.customer_health_alerts') is not null then
      delete from customer_health_alerts where prospect_id = any(v_prospect_ids);
    end if;
    if to_regclass('public.customer_support_drafts') is not null then
      delete from customer_support_drafts where prospect_id = any(v_prospect_ids);
    end if;
    if to_regclass('public.deal_stage_alerts') is not null then
      delete from deal_stage_alerts where prospect_id = any(v_prospect_ids);
    end if;
  end if;

  delete from notifications_log where user_id in (select id from users where company_id = v_company_id);
  delete from appointments where prospect_id in (select id from prospects where company_id = v_company_id);
  delete from conversations where prospect_id in (select id from prospects where company_id = v_company_id);

  if to_regclass('public.quote_line_items') is not null
     and v_quote_ids is not null and array_length(v_quote_ids, 1) > 0 then
    delete from quote_line_items where quote_id = any(v_quote_ids);
  end if;
  if to_regclass('public.quotes') is not null then
    delete from quotes where company_id = v_company_id;
  end if;

  delete from prospects where company_id = v_company_id;

  if to_regclass('public.prospect_companies') is not null then
    delete from prospect_companies where company_id = v_company_id;
  end if;
  if to_regclass('public.prospecting_campaigns') is not null then
    delete from prospecting_campaigns where company_id = v_company_id;
  end if;
  if to_regclass('public.company_documents') is not null then
    delete from company_documents where company_id = v_company_id;
  end if;
  if to_regclass('public.feedback_messages') is not null then
    delete from feedback_messages where company_id = v_company_id;
  end if;
  if to_regclass('public.products') is not null then
    delete from products where company_id = v_company_id;
  end if;
  if to_regclass('public.crm_connections') is not null then
    delete from crm_connections where company_id = v_company_id;
  end if;
  if to_regclass('public.credit_transactions') is not null then
    delete from credit_transactions where company_id = v_company_id;
  end if;
  if to_regclass('public.api_usage_monthly') is not null then
    delete from api_usage_monthly where company_id = v_company_id;
  end if;
  if to_regclass('public.api_usage_daily') is not null then
    delete from api_usage_daily where company_id = v_company_id;
  end if;
  if to_regclass('public.client_invoices') is not null then
    delete from client_invoices where company_id = v_company_id;
  end if;

  if to_regclass('public.marketing_campaign_recipients') is not null
     and to_regclass('public.marketing_campaigns') is not null then
    delete from marketing_campaign_recipients
      where campaign_id in (select id from marketing_campaigns where company_id = v_company_id);
  end if;
  if to_regclass('public.marketing_campaigns') is not null then
    delete from marketing_campaigns where company_id = v_company_id;
  end if;
  if to_regclass('public.reactivation_batches') is not null then
    delete from reactivation_batches where company_id = v_company_id;
  end if;

  if to_regclass('public.chat_messages') is not null then
    delete from chat_messages where user_id in (select id from users where company_id = v_company_id);
  end if;
  if to_regclass('public.push_subscriptions') is not null then
    delete from push_subscriptions where user_id in (select id from users where company_id = v_company_id);
  end if;
  if to_regclass('public.email_send_counters') is not null then
    delete from email_send_counters where user_id in (select id from users where company_id = v_company_id);
  end if;

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
