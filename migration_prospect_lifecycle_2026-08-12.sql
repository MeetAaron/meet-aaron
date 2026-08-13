-- migration_prospect_lifecycle_2026-08-12.sql
-- Actions manuelles sur un prospect côté commercial : marquer perdu (pour
-- qu'Aaron arrête de le recontacter) et marquer gagné (jusqu'ici seul un
-- process automatique était prévu, jamais implémenté — is_won ne passait
-- jamais à true nulle part dans le code). La suppression pure et simple
-- (DELETE /api/prospects/[id]) ne nécessite aucune colonne, juste un
-- ON DELETE CASCADE correct sur les tables liées (voir ci-dessous).
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospects add column if not exists is_lost boolean not null default false;
alter table prospects add column if not exists lost_at timestamptz;

-- Sécurité : si conversations/messages n'ont pas déjà de ON DELETE CASCADE
-- vers prospects, la suppression d'un prospect échouerait (contrainte de
-- clé étrangère). On le force ici plutôt que de gérer un cas par cas côté
-- code (moins fragile si d'autres tables référencent prospects plus tard).
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'conversations_prospect_id_fkey'
  ) then
    alter table conversations drop constraint conversations_prospect_id_fkey;
  end if;
  alter table conversations
    add constraint conversations_prospect_id_fkey
    foreign key (prospect_id) references prospects(id) on delete cascade;
exception when others then
  raise notice 'conversations_prospect_id_fkey non modifiée : %', sqlerrm;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'appointments_prospect_id_fkey'
  ) then
    alter table appointments drop constraint appointments_prospect_id_fkey;
  end if;
  alter table appointments
    add constraint appointments_prospect_id_fkey
    foreign key (prospect_id) references prospects(id) on delete cascade;
exception when others then
  raise notice 'appointments_prospect_id_fkey non modifiée : %', sqlerrm;
end $$;
