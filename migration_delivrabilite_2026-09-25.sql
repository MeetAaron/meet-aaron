-- migration_delivrabilite_2026-09-25.sql
--
-- TROU N°1 — LES REBONDS ETAIENT DETECTES MAIS JAMAIS EXPLOITES.
-- lib/inbound-triage.ts reconnait parfaitement un rebond (MAILER-DAEMON,
-- « Delivery Status Notification », « Undeliverable »...) et le classait en
-- 'bounce'... puis ne faisait rien. L'adresse restait active et Aaron
-- continuait a relancer une boite qui n'existe pas, trois fois selon le
-- calendrier. C'est le signal qui detruit le plus vite une reputation
-- d'expediteur — davantage qu'un DKIM manquant.
--
-- On enregistre desormais la date du rebond, et 'email_invalide' devient un
-- motif de perte a part entiere (plutot que de le noyer dans 'autre') :
-- l'ecran Resultats pourra distinguer « adresse morte » de « pas interesse »,
-- ce qui ne dit pas du tout la meme chose sur la qualite du sourcing.

alter table public.prospects
  add column if not exists email_bounced_at timestamptz;

comment on column public.prospects.email_bounced_at is
  'Date du premier rebond dur sur cette adresse. Non nul = adresse invalide : plus aucun envoi ni relance (voir app/api/cron/check-inbox et send-prospect-followups).';

alter table public.prospects drop constraint if exists prospects_pipeline_lost_reason_check;
alter table public.prospects add constraint prospects_pipeline_lost_reason_check
  check (pipeline_lost_reason is null or pipeline_lost_reason in (
    'pas_interesse', 'sans_reponse', 'trop_cher', 'concurrent', 'timing',
    'devis_refuse', 'resilie', 'email_invalide', 'autre'));

create index if not exists idx_prospects_email_bounced
  on public.prospects(email_bounced_at)
  where email_bounced_at is not null;

-- Verification
select count(*) filter (where email_bounced_at is not null) as adresses_invalides,
       count(*)                                             as prospects_total
from public.prospects;
