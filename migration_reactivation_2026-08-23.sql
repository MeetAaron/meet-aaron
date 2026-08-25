-- migration_reactivation_2026-08-23.sql
--
-- Docx pipeline "Réactivation" (discussion Alex 2026-08-23), niveau 0/1 :
-- traçabilité de la provenance d'un prospect (Aaron / commercial / Aaron en
-- réactivation), et table de suivi des fichiers de réactivation déposés par
-- le commercial. Étape 1 du chantier ("le client envoie son propre fichier,
-- Aaron se charge de démarcher/réactiver ce qu'il contient") — niveau 2/3
-- (CRM connecté) viendra dans une migration séparée.
--
-- À exécuter dans l'éditeur SQL Supabase.

-- 1) Provenance d'un prospect. Trois valeurs, noms choisis par Alex :
--    - 'amene_par_aaron'    : trouvé et démarché par Aaron (campagne de
--                             prospection, voir lib/sourcing.ts)
--    - 'amene_par_toi'      : ajouté manuellement par le commercial, ou via
--                             l'import CSV normal (voir CsvImportModal) —
--                             valeur par défaut, ne change rien pour les
--                             prospects déjà en base
--    - 'reactive_par_aaron' : contact perdu (client/opportunité/prospect)
--                             réintroduit par Aaron depuis un fichier déposé
--                             par le commercial pour réactivation
alter table prospects add column if not exists origin text not null default 'amene_par_toi';

alter table prospects drop constraint if exists prospects_origin_check;
alter table prospects add constraint prospects_origin_check
  check (origin in ('amene_par_aaron', 'amene_par_toi', 'reactive_par_aaron'));

-- Backfill honnête pour les prospects déjà en base : ceux trouvés via une
-- campagne de prospection Aaron (prospect_companies.found_by_campaign_id
-- renseigné) passent à 'amene_par_aaron' ; tous les autres restent sur la
-- valeur par défaut 'amene_par_toi' (ajout manuel ou import CSV, impossible
-- de distinguer les deux rétroactivement, et ce n'est pas nécessaire).
update prospects p
set origin = 'amene_par_aaron'
from prospect_companies pc
where p.prospect_company_id = pc.id
  and pc.found_by_campaign_id is not null
  and p.origin = 'amene_par_toi';

-- 2) Table de suivi des fichiers de réactivation déposés par un commercial.
-- Une ligne = un dépôt de fichier confirmé ("je confirme donner à Aaron la
-- prise en charge de ce fichier") — voir app/api/reactivation/batches.
create table if not exists reactivation_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  uploaded_by_user_id uuid not null references users(id) on delete cascade,
  file_name text not null,
  row_count int,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_reactivation_batches_company on reactivation_batches(company_id);

-- 3) Rattache chaque prospect réactivé au fichier dont il vient.
alter table prospects add column if not exists reactivation_batch_id uuid references reactivation_batches(id) on delete set null;
create index if not exists idx_prospects_reactivation_batch on prospects(reactivation_batch_id);
