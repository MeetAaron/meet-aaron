-- diagnostic_tables_manquantes_2026-09-10.sql
--
-- « relation "public.marketing_campaigns" does not exist » (10/09/2026) : la
-- migration du module Marketing du 21/08 n'avait jamais ete jouee, et rien ne
-- le disait — Postgrest renvoie une erreur que le front avale, la page reste
-- vide au lieu de crier. On a deja paye ce defaut une fois, le 03/09, quand
-- l'absence de business_summary_versions a fait perdre le profil d'entreprise
-- en silence.
--
-- Ce script ne modifie RIEN : il compare les tables declarees dans les
-- fichiers migration_*.sql du depot a celles reellement presentes en base.
-- « 0 rows » = tout est a jour. Toute ligne renvoyee = une migration jamais
-- jouee, donc un pan de l'application mort sans le savoir.

with attendues(nom) as (
  values
    ('aaron_batch_items'),
    ('aaron_batches'),
    ('api_usage_daily'),
    ('api_usage_monthly'),
    ('api_usage_user_monthly'),
    ('availability_blocks'),
    ('availability_rules'),
    ('business_summary_versions'),
    ('chat_conversations'),
    ('chat_messages'),
    ('client_invoices'),
    ('company_research_cache'),
    ('credit_alerts'),
    ('credit_boosts'),
    ('credit_transactions'),
    ('crm_connections'),
    ('customer_checkins'),
    ('customer_health_alerts'),
    ('customer_support_drafts'),
    ('deal_stage_alerts'),
    ('directory_companies'),
    ('email_send_counters'),
    ('email_verifications'),
    ('marketing_campaign_recipients'),
    ('marketing_campaigns'),
    ('oauth_qr_tokens'),
    ('password_reset_tokens'),
    ('pending_aaron_replies'),
    ('products'),
    ('push_subscriptions'),
    ('quote_line_items'),
    ('quotes'),
    ('reactivation_batches'),
    ('team_seats'),
    ('user_devices')
)
select a.nom as table_manquante
from attendues a
left join information_schema.tables t
  on t.table_schema = 'public' and t.table_name = a.nom
where t.table_name is null
order by 1;
