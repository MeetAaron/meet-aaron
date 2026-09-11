-- menage_utilisateurs_2026-09-11.sql
--
-- SUPPRIME tous les comptes Meet Aaron SAUF aaron@meetaaron.app, ainsi que
-- toutes leurs données rattachées (prospects, campagnes, rendez-vous,
-- documents, connexions de boîtes mail, crédits, conversations…).
--
-- ⚠️ IRRÉVERSIBLE. À ne jouer qu'après le diagnostic, et après avoir lu le
-- compte-rendu du mode simulation ci-dessous.
--
-- COMMENT ÇA MARCHE : plutôt que d'écrire à la main la liste des tables —
-- elle change à chaque migration et un oubli ferait échouer la suppression
-- au milieu — le script parcourt le graphe des clés étrangères de Postgres
-- et vide chaque table qui pointe vers users, dans l'ordre, puis supprime
-- les comptes eux-mêmes. Le tout dans UNE transaction : si quoi que ce soit
-- échoue, rien n'est supprimé.
--
-- DEUX PASSAGES :
--   1) Laisser simulation = true → n'efface RIEN, affiche ce qui SERAIT
--      supprimé, table par table. À me coller.
--   2) Repasser simulation = false → exécute pour de bon.

do $$
declare
  -- ⇩⇩ LE SEUL RÉGLAGE ⇩⇩
  simulation boolean := true;     -- true = compte seulement ; false = supprime
  garder     text[]  := array['aaron@meetaaron.app'];  -- comptes conservés
  -- ⇧⇧                  ⇧⇧

  ids_a_supprimer uuid[];
  r               record;
  n               bigint;
  total           bigint := 0;
begin
  select array_agg(id) into ids_a_supprimer
  from public.users
  where lower(email) <> all (select lower(unnest(garder)));

  if ids_a_supprimer is null or cardinality(ids_a_supprimer) = 0 then
    raise notice 'Aucun compte à supprimer — il ne reste que ceux à conserver.';
    return;
  end if;

  raise notice '% compte(s) concerné(s).', cardinality(ids_a_supprimer);

  -- Toutes les colonnes qui pointent vers public.users, dédupliquées.
  for r in
    select distinct tc.table_name as t, kcu.column_name as c
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'users'
      and tc.table_name <> 'users'
    order by 1, 2
  loop
    if simulation then
      execute format('select count(*) from public.%I where %I = any($1)', r.t, r.c)
        into n using ids_a_supprimer;
    else
      execute format('with x as (delete from public.%I where %I = any($1) returning 1)
                      select count(*) from x', r.t, r.c)
        into n using ids_a_supprimer;
    end if;
    total := total + n;
    if n > 0 then
      raise notice '  %.% : % ligne(s)', r.t, r.c, n;
    end if;
  end loop;

  if simulation then
    select count(*) into n from public.users where id = any(ids_a_supprimer);
    raise notice 'SIMULATION — % ligne(s) liée(s) + % compte(s) seraient supprimés. Rien n''a été touché.', total, n;
    raise exception 'Simulation terminée, transaction annulée volontairement.';
  else
    delete from public.users where id = any(ids_a_supprimer);
    get diagnostics n = row_count;
    raise notice 'SUPPRIMÉ — % ligne(s) liée(s) + % compte(s).', total, n;
  end if;
end $$;

-- ── Étape 2, À NE JOUER QU'APRÈS le bloc ci-dessus en mode réel ──────────
-- Les comptes de CONNEXION (Supabase Auth) sont dans un autre schéma et ne
-- sont pas supprimés par ce qui précède : sans cette étape, les anciennes
-- adresses ne pourraient pas se réinscrire. Décommenter pour l'exécuter.
--
-- delete from auth.users
-- where lower(email) <> 'aaron@meetaaron.app'
--   and id not in (select id from public.users);
