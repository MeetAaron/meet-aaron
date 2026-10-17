-- DIAGNOSTIC (lecture seule) — 17/10/2026
-- Le scan CASA a reçu une erreur 500 sur GET /api/customers/pipeline pour le
-- compte de test, avec des paramètres parfaitement valides : la requête
-- Supabase de cette route échoue. Deux causes possibles, vérifiées ici :
--   1. une colonne lue par la route n'existe pas dans la table prospects ;
--   2. plusieurs clés étrangères relient prospects à prospect_companies
--      (PostgREST refuse alors l'imbrication « prospect_companies(...) »).
-- Ce script ne modifie rien.

WITH attendues(col) AS (
  VALUES ('full_name'),('job_title'),('email'),('created_at'),('won_at'),('won_reason'),
         ('is_lost'),('lost_at'),('ai_managed'),('onboarding_status'),('onboarding_plan'),
         ('onboarding_generated_at'),('welcome_email_subject'),('welcome_email_body'),
         ('welcome_email_sent_at'),('customer_health_score'),('customer_health_label'),
         ('customer_health_updated_at'),('churn_risk'),('last_checkin_sent_at'),
         ('last_checkin_response_at'),('contract_renewal_date'),('renewal_reminder_sent_at'),
         ('renewal_email_subject'),('renewal_email_body'),('renewal_email_sent_at'),
         ('upsell_suggestion'),('upsell_suggested_at'),('upsell_dismissed_at'),
         ('testimonial_email_subject'),('testimonial_email_body'),('testimonial_email_sent_at'),
         ('devis_recap'),('assigned_user_id'),('first_order_confirmed_at')
)
SELECT 'colonne manquante dans prospects' AS probleme, a.col AS detail
FROM attendues a
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'prospects' AND c.column_name = a.col
)
UNION ALL
SELECT 'clés étrangères prospects -> prospect_companies', count(*)::text
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid = 'public.prospects'::regclass
  AND confrelid = 'public.prospect_companies'::regclass
UNION ALL
SELECT 'table customer_checkins présente', (to_regclass('public.customer_checkins') IS NOT NULL)::text;
