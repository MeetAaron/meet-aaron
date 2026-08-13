-- migration_aaron_sales_2026-08-13.sql
--
-- Aaron Sales v1 : brief pré-RDV, compte-rendu + relance post-RDV, pipeline
-- de vente (RDV fait -> devis envoyé -> en négociation -> signé/perdu) mis à
-- jour automatiquement à partir du bilan de RDV existant (voir
-- lib/appointment-outcome.ts, lib/aaron-sales.ts, app/app/sales/page.jsx).
--
-- À exécuter dans l'éditeur SQL Supabase.

-- Étape du cycle de vente d'un prospect, distincte du statut de couleur
-- existant (vert/jaune/orange/rouge/bleu, qui reflète la santé de la
-- relance) : null = pas encore de RDV effectué, sinon 'rdv_fait' ->
-- 'devis_envoye' -> 'en_negociation' -> 'signe' | 'perdu'.
alter table prospects add column if not exists deal_stage text;
alter table prospects add column if not exists deal_stage_updated_at timestamptz;

-- Fiche de brief générée par Aaron avant un RDV : historique résumé, profil
-- de personnalité, objections déjà soulevées, info entreprise, angle
-- d'approche suggéré, points de coaching. Stockée en JSON pour rester
-- flexible sans multiplier les colonnes.
alter table appointments add column if not exists pre_brief jsonb;
alter table appointments add column if not exists pre_brief_generated_at timestamptz;

-- Compte-rendu structuré + email de relance générés par Aaron à partir des
-- quelques lignes de notes que le commercial laisse juste après un RDV
-- (complète le bilan rapide déjà existant : outcome/outcome_note).
alter table appointments add column if not exists debrief_notes text;
alter table appointments add column if not exists debrief_summary text;
alter table appointments add column if not exists debrief_email_subject text;
alter table appointments add column if not exists debrief_email_body text;
alter table appointments add column if not exists debrief_generated_at timestamptz;
alter table appointments add column if not exists debrief_email_sent_at timestamptz;

-- Journal des alertes "affaire qui stagne" envoyées par le cron
-- app/api/cron/stale-deals-alert, pour ne relancer le commercial qu'une
-- seule fois par étape de pipeline (la clé unique se réinitialise
-- naturellement quand l'affaire avance à l'étape suivante).
create table if not exists deal_stage_alerts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  deal_stage text not null,
  sent_at timestamptz not null default now()
);

create unique index if not exists deal_stage_alerts_unique
  on deal_stage_alerts (prospect_id, deal_stage);
