-- migration_aaron_customer_2026-08-13.sql
-- Aaron Customer v1 : onboarding auto post-signature, score de santé client,
-- check-ins satisfaction/NPS, alertes de risque de désabonnement (churn).
-- À exécuter manuellement dans l'éditeur SQL Supabase (comme toutes les
-- migrations précédentes — Claude n'a pas d'accès direct à la base).
--
-- Portée volontaire du v1 (voir Meet-Aaron-Plan-Aaron-Sales-Customer.docx) :
-- onboarding, score de santé, check-ins satisfaction/NPS, alertes churn.
-- Laissés pour une passe dédiée ultérieure : renouvellements proactifs,
-- détection d'upsell automatique, triage support niveau 1, sollicitation
-- d'avis/témoignages.

-- Onboarding : plan généré par Aaron + email de bienvenue, sur le même
-- modèle que le compte-rendu/relance d'Aaron Sales (génération à la demande,
-- mise en cache, envoi validé par le commercial).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS onboarding_status text
  CHECK (onboarding_status IN ('a_demarrer', 'en_cours', 'termine'));
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS onboarding_plan jsonb;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS onboarding_generated_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS onboarding_status_updated_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS welcome_email_subject text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS welcome_email_body text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

-- Score de santé client : recalculé quotidiennement par
-- app/api/cron/customer-health/route.ts à partir de signaux déterministes
-- (onboarding, réponses aux check-ins) — pas d'appel Claude pour ce calcul,
-- pour rester rapide, gratuit et 100% reproductible.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS customer_health_score int;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS customer_health_label text
  CHECK (customer_health_label IN ('saine', 'a_surveiller', 'a_risque'));
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS customer_health_updated_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS churn_risk boolean DEFAULT false;

-- Cadence des check-ins satisfaction/NPS : premier envoi ~3 semaines après la
-- signature, puis tous les ~60 jours (voir app/api/cron/customer-checkins).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_checkin_sent_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_checkin_response_at timestamptz;

-- Historique des check-ins envoyés et de leurs réponses (une ligne par
-- sollicitation). La réponse est captée par app/api/cron/check-inbox lorsque
-- le client répond à l'email de check-in, et parsée par Aaron
-- (lib/aaron-customer.ts -> parseCheckinResponse).
CREATE TABLE IF NOT EXISTS customer_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'satisfaction' CHECK (type IN ('nps', 'satisfaction')),
  question_subject text,
  question_body text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  response_score int CHECK (response_score BETWEEN 0 AND 10),
  response_comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_checkins_prospect ON customer_checkins(prospect_id);
-- Utilisé par le cron d'envoi pour retrouver rapidement le check-in "en attente
-- de réponse" le plus récent d'un prospect (responded_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_customer_checkins_pending ON customer_checkins(prospect_id, sent_at DESC) WHERE responded_at IS NULL;

-- Dédoublonnage des alertes de risque de désabonnement (même principe que
-- deal_stage_alerts pour Aaron Sales) : une alerte par prospect, ré-émise
-- seulement si le risque persiste après un certain délai, ou supprimée dès
-- que la santé du client repasse au-dessus du seuil de risque.
CREATE TABLE IF NOT EXISTS customer_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id)
);
