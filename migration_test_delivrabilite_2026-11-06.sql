-- migration_test_delivrabilite_2026-11-06.sql
--
-- TEST DE DÉLIVRABILITÉ RÉEL avant le premier envoi d'un commercial (Alex,
-- 05/11/2026 : « oui go ! », à faire en premier parce que ça protège le tout
-- premier client).
--
-- Les vérifications DNS (SPF, DKIM, DMARC — lib/email-deliverability.ts)
-- disent si la configuration est correcte. Elles ne disent pas où l'email
-- ARRIVE. Ici, Aaron envoie un vrai email depuis la boîte du commercial vers
-- des boîtes témoins (Gmail, Outlook) que Meet Aaron possède, puis va lire
-- dans ces boîtes où il est tombé : boîte de réception ou spam, et ce que
-- disent les en-têtes d'authentification. Tant que le verdict n'est pas
-- rendu, aucun premier email de prospection ne part (voir deliverabilityGate
-- dans lib/deliverability-test.ts). Un verdict « spam » met la campagne en
-- attente et crée une action requise.

CREATE TABLE IF NOT EXISTS public.deliverability_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_id uuid,
  token text NOT NULL UNIQUE,            -- référence glissée dans l'objet, pour retrouver l'email chez les témoins
  subject text NOT NULL,
  seeds jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ email, provider, user_id }]
  sent_at timestamptz,
  resolved_at timestamptz,
  verdict text NOT NULL DEFAULT 'en_attente'
    CHECK (verdict IN ('en_attente', 'ok', 'spam', 'introuvable', 'erreur')),
  results jsonb NOT NULL DEFAULT '[]'::jsonb, -- un objet par témoin : placement, spf, dkim, dmarc
  error text,
  acknowledged_at timestamptz,            -- le commercial a vu / ignoré l'action requise
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deliverability_tests_user_created_idx
  ON public.deliverability_tests (user_id, created_at DESC);

ALTER TABLE public.deliverability_tests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.deliverability_tests IS
  'Tests de délivrabilité réels : un email envoyé depuis la boîte du commercial vers les boîtes témoins de Meet Aaron, et où il est arrivé. Lecture et écriture serveur uniquement.';
