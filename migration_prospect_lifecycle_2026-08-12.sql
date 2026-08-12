-- migration_prospect_lifecycle_2026-08-12.sql
-- Actions manuelles sur un prospect cote commercial : marquer perdu (pour
-- qu'Aaron arrete de le recontacter) et marquer gagne (jusqu'ici seul un
-- process automatique etait prevu, jamais implemente -- is_won ne passait
-- jamais a true nulle part dans le code). La suppression pure et simple
-- (DELETE /api/prospects/[id]) ne necessite aucune colonne, juste un
-- ON DELETE CASCADE correct sur les tables liees (voir ci-dessous).
-- A executer dans l'editeur SQL Supabase.

alter table prospects add column if not exists is_lost boolean not null default false;
alter table prospects add column if not exists lost_at timestamptz;

-- Securite : si conversations/messages n'ont pas deja de ON DELETE CASCADE
-- vers prospects, la suppression d'un prospect echouerait (contrainte de
-- cle etrangere). On le force ici plutot que de gerer un cas par cas cote
-- code (moins fragile si d'autres tables referencent prospects plus tard).
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
  raise notice 'conversations_prospect_id_fkey non modifiee : %', sqlerrm;
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
  raise notice 'appointments_prospect_id_fkey non modifiee : %', sqlerrm;
end $$;
