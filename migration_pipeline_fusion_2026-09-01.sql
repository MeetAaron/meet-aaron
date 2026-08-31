-- migration_pipeline_fusion_2026-09-01.sql
-- Fusion Prospects + Opportunités en un seul tableau avec une ligne de
-- progression unique à 6 points (docx « mon avis » d'Alex, 31/08/2026, voir
-- lib/pipeline.ts pour les règles) :
--   🎯 en_cours → en_bonne_voie
--   🤝 rdv_obtenu → proposition_demandee → en_negociation
--   ⭐ client
--
-- IMPORTANT : la nouvelle interface sait dériver la position de chaque
-- contact à partir des colonnes EXISTANTES (status, deal_stage, is_won,
-- is_lost, first_order_confirmed_at, devis_*) — cette migration n'est donc
-- pas un préalable à l'affichage, mais elle est nécessaire aux boutons
-- « Déplacer », « Perdu (motif) », « Risque » et « Il m'a demandé un devis »
-- de la fiche contact. Elle ajoute :
--   - quote_requested_at : date de la demande de devis (détectée par Aaron
--     dans un email, ou déclarée par le commercial : SMS, appel…) → étape
--     « proposition demandée » + notification « Devis à faire » ;
--   - pipeline_stage : étape forcée à la main depuis la fiche (prioritaire
--     sur la déduction quand renseignée) ;
--   - pipeline_lost_at_stage / pipeline_lost_reason : où et pourquoi un
--     contact a été perdu (point rouge sur la ligne + motif, base d'une
--     future réactivation) ;
--   - pipeline_risk : drapeau « risque de perdre » posé par Aaron ou le
--     commercial, indépendant de l'étape (reprend status='orange') ;
--   - conviction_score / conviction_reason / conviction_updated_at : score de
--     conviction d'Aaron (0-100) et sa justification en une phrase, à chaque
--     étape. Généralise negotiation_confidence_* (négociation seulement).
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospects add column if not exists quote_requested_at timestamptz;
alter table prospects add column if not exists pipeline_stage text;
alter table prospects add column if not exists pipeline_stage_updated_at timestamptz;
alter table prospects add column if not exists pipeline_lost_at_stage text;
alter table prospects add column if not exists pipeline_lost_reason text;
alter table prospects add column if not exists pipeline_risk boolean not null default false;
alter table prospects add column if not exists conviction_score int;
alter table prospects add column if not exists conviction_reason text;
alter table prospects add column if not exists conviction_updated_at timestamptz;

alter table prospects drop constraint if exists prospects_pipeline_stage_check;
alter table prospects add constraint prospects_pipeline_stage_check
  check (pipeline_stage is null or pipeline_stage in (
    'en_cours', 'en_bonne_voie', 'rdv_obtenu', 'proposition_demandee', 'en_negociation', 'client'));

alter table prospects drop constraint if exists prospects_pipeline_lost_at_stage_check;
alter table prospects add constraint prospects_pipeline_lost_at_stage_check
  check (pipeline_lost_at_stage is null or pipeline_lost_at_stage in (
    'en_cours', 'en_bonne_voie', 'rdv_obtenu', 'proposition_demandee', 'en_negociation', 'client'));

alter table prospects drop constraint if exists prospects_pipeline_lost_reason_check;
alter table prospects add constraint prospects_pipeline_lost_reason_check
  check (pipeline_lost_reason is null or pipeline_lost_reason in (
    'pas_interesse', 'sans_reponse', 'trop_cher', 'concurrent', 'timing',
    'devis_refuse', 'resilie', 'autre'));

alter table prospects drop constraint if exists prospects_conviction_score_check;
alter table prospects add constraint prospects_conviction_score_check
  check (conviction_score is null or (conviction_score between 0 and 100));

-- Reprise de l'existant.
-- 1. Demandes de devis déjà détectées par Aaron (devis généré, jamais envoyé)
--    → étape « proposition demandée ».
update prospects
set quote_requested_at = devis_generated_at
where quote_requested_at is null
  and devis_generated_at is not null
  and devis_sent_at is null
  and coalesce(is_won, false) = false
  and coalesce(is_lost, false) = false;

-- 2. Le drapeau risque reprend status='orange'.
update prospects set pipeline_risk = true where status = 'orange' and pipeline_risk = false;

-- 3. Le score de conviction reprend la confiance de négociation déjà calculée.
update prospects
set conviction_score = negotiation_confidence_score,
    conviction_reason = negotiation_confidence_reason,
    conviction_updated_at = coalesce(negotiation_confidence_updated_at, now())
where conviction_score is null and negotiation_confidence_score is not null;

-- 4. Contacts déjà perdus : l'étape d'arrêt la plus précise que l'on connaisse
--    (motif inconnu → laissé vide, le commercial pourra le préciser).
update prospects
set pipeline_lost_at_stage = case
      when deal_stage = 'signe' or is_won = true then 'client'
      when deal_stage in ('en_negociation', 'devis_envoye') then 'en_negociation'
      when deal_stage = 'rdv_fait' and devis_generated_at is not null then 'proposition_demandee'
      when deal_stage = 'rdv_fait' or status = 'bleu' then 'rdv_obtenu'
      when status = 'vert' then 'en_bonne_voie'
      else 'en_cours'
    end
where (is_lost = true or deal_stage = 'perdu' or status = 'rouge')
  and pipeline_lost_at_stage is null;

-- Un client résilié (1ère commande confirmée puis perdu) : motif « résilié ».
update prospects
set pipeline_lost_reason = 'resilie'
where pipeline_lost_reason is null
  and is_lost = true
  and first_order_confirmed_at is not null;

create index if not exists prospects_pipeline_stage_idx on prospects (company_id, pipeline_stage);
create index if not exists prospects_quote_requested_idx on prospects (assigned_user_id, quote_requested_at)
  where quote_requested_at is not null;
