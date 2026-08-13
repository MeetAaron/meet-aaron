-- migration_aaron_v2_2026-08-13.sql
-- Aaron Sales v2 + Aaron Customer v2 — demandés par Alex le soir même après
-- validation du v1 : "il faut que aaron sales et aaron customer soient
-- opérationnels et utiles". Ajoute : génération de devis + suivi de
-- signature externe (Aaron Sales), et renouvellements proactifs + détection
-- d'upsell + triage support niveau 1 + sollicitation de témoignages (Aaron
-- Customer).
--
-- À exécuter dans l'éditeur SQL Supabase, après les 3 migrations précédentes
-- (chat-history, aaron-sales, aaron-customer).

-- ===== Aaron Sales v2 =====

-- Devis généré par Aaron à partir des échanges + du résumé métier de la
-- société (companies.business_summary). Aaron ne connaît pas les tarifs
-- exacts : le récapitulatif (devis_recap) liste des postes avec description
-- mais SANS prix — à compléter par le commercial avant envoi.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS devis_subject text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS devis_body text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS devis_recap jsonb;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS devis_generated_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS devis_sent_at timestamptz;

-- Suivi de signature externe : en l'absence d'une clé API Yousign fournie
-- par Alex, pas d'intégration automatique possible — le commercial colle ici
-- le lien de la procédure de signature externe (Yousign ou autre) une fois
-- envoyée, pour la retrouver facilement. Le passage en étape "signé" reste
-- géré par deal_stage (voir migration_aaron_sales_2026-08-13.sql).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS signature_external_link text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS signature_requested_at timestamptz;

-- ===== Aaron Customer v2 =====

-- Renouvellement proactif : date de fin de contrat saisie manuellement par
-- le commercial (Aaron n'a aucun moyen de la déduire seul). Le cron
-- app/api/cron/renewal-reminders alerte 30 jours avant et prépare un email
-- de relance de renouvellement.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contract_renewal_date date;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS renewal_email_subject text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS renewal_email_body text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS renewal_email_sent_at timestamptz;

-- Détection d'upsell : signal heuristique (score de santé élevé + ancienneté
-- suffisante), voir app/api/cron/upsell-signals. Suggestion générée une
-- seule fois par défaut ; le commercial peut l'écarter (upsell_dismissed_at)
-- pour la faire disparaître du tableau de bord.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS upsell_suggested_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS upsell_suggestion text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS upsell_dismissed_at timestamptz;

-- Sollicitation de témoignage : déclenchée automatiquement quand un client
-- répond à un check-in avec une note promoteur (>= 9/10) — voir
-- app/api/cron/check-inbox (handleWonCustomerMessage).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS testimonial_email_subject text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS testimonial_email_body text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS testimonial_requested_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS testimonial_email_sent_at timestamptz;

-- Triage support niveau 1 : quand un client gagné écrit un email qui n'est
-- pas une réponse à un check-in (ou dont la réponse n'est pas une note
-- claire), Aaron rédige une suggestion de réponse que le commercial relit et
-- envoie lui-même (jamais d'envoi automatique à un vrai client sans
-- validation humaine). Voir lib/aaron-customer.ts -> generateSupportReply.
CREATE TABLE IF NOT EXISTS customer_support_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  inbound_excerpt text NOT NULL,
  suggested_subject text NOT NULL,
  suggested_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  dismissed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_customer_support_drafts_pending
  ON customer_support_drafts(prospect_id, created_at DESC)
  WHERE sent_at IS NULL AND dismissed_at IS NULL;
