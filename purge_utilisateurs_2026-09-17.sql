-- purge_utilisateurs_2026-09-17.sql
--
-- OBJECTIF : ne garder que trois comptes et supprimer TOUTES les donnees des
-- autres (societes, prospects, campagnes, devis, messages, conversations,
-- boosts, connexions de boite mail, appareils, historique de chat...).
--
--   alexandre.fevre01@gmail.com
--   aaron@meetaaron.app
--   ludovic.fevre@open-x.fr
--
-- COMMENT CA MARCHE : le script ne contient AUCUNE liste de tables ecrite a la
-- main. Il lit le graphe des cles etrangeres de la base (pg_constraint), en
-- deduit l'ordre de suppression (enfants avant parents), puis propage la
-- condamnation de proche en proche. Une ligne rattachee a une ligne condamnee
-- est condamnee, meme si elle se trouve a quatre niveaux de profondeur et
-- qu'elle ne porte ni user_id ni company_id (cas de quote_line_items ou de
-- chat_messages).
--
-- TESTE le 17/09/2026 sur PostgreSQL 16 avec un schema reproduisant celui de
-- Meet Aaron, y compris le cas piege : un utilisateur a supprimer qui partage
-- sa societe avec un utilisateur a garder — la societe survit.
--
-- LIMITE A CONNAITRE : la propagation suit les VRAIES cles etrangeres. Une
-- colonne user_id ou company_id declaree sans contrainte de cle etrangere ne
-- serait pas suivie. Le script 3 en fin de fichier detecte ce cas.
--
-- A EXECUTER DANS L'ORDRE : 1 (lecture seule) -> 2 (suppression) -> 3
-- (verification). Ne lancez le 2 que si le 1 affiche ce que vous attendez.


-- ===========================================================================
-- SCRIPT 1 — ANALYSE (LECTURE SEULE, ne supprime rien)
-- ===========================================================================

create temp table _keep_emails(email text primary key) on commit drop;
insert into _keep_emails(email) values
  ('alexandre.fevre01@gmail.com'),
  ('aaron@meetaaron.app'),
  ('ludovic.fevre@open-x.fr');

create temp table _keep_users on commit drop as
  select u.id, u.company_id from public.users u
  where lower(trim(u.email)) in (select lower(trim(email)) from _keep_emails);
create temp table _doomed_users on commit drop as
  select u.id, u.company_id from public.users u where u.id not in (select id from _keep_users);
create temp table _keep_companies on commit drop as
  select distinct company_id as id from _keep_users where company_id is not null;
create temp table _doomed_companies on commit drop as
  select c.id from public.companies c where c.id not in (select id from _keep_companies);

-- Qui reste, qui part
select 'GARDE' as sort, u.email, c.name as societe
from public.users u left join public.companies c on c.id = u.company_id
where u.id in (select id from _keep_users)
union all
select 'SUPPRIME', u.email, c.name
from public.users u left join public.companies c on c.id = u.company_id
where u.id in (select id from _doomed_users)
order by 1, 2;

-- Societes concernees
select 'SOCIETE GARDEE' as sort, c.name, c.billing_exempt
from public.companies c where c.id in (select id from _keep_companies)
union all
select 'SOCIETE SUPPRIMEE', c.name, c.billing_exempt
from public.companies c where c.id in (select id from _doomed_companies)
order by 1, 2;


-- ===========================================================================
-- SCRIPT 2 — SUPPRESSION
-- Relancer d'abord les quatre create temp table du script 1 dans la meme
-- session, puis executer ce bloc.
-- ===========================================================================

begin;

-- profondeur topologique + cle primaire de chaque table
create temp table _tbl(name text primary key, depth int not null default 0, pk text) on commit drop;
insert into _tbl(name, pk)
  select c.relname,
         (select a.attname from pg_constraint k
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
           where k.conrelid = c.oid and k.contype = 'p' and array_length(k.conkey,1) = 1)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';

do $$
declare i int; moved int;
begin
  for i in 1..40 loop
    with calc as (
      select ch.name, coalesce(max(p.depth) + 1, 0) as d
      from _tbl ch
      left join pg_constraint con
        on con.contype = 'f' and con.conrelid = ('public.' || quote_ident(ch.name))::regclass
       and con.confrelid <> con.conrelid
      left join pg_class pc on pc.oid = con.confrelid
      left join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      left join _tbl p on p.name = pc.relname and pn.nspname = 'public'
      group by ch.name
    )
    update _tbl t set depth = calc.d from calc where calc.name = t.name and calc.d > t.depth;
    get diagnostics moved = row_count;
    exit when moved = 0;
  end loop;
end $$;

create temp table _fk on commit drop as
  select ch.relname as child, att.attname as col, pa.relname as parent, fatt.attname as pcol
  from pg_constraint con
  join pg_class ch on ch.oid = con.conrelid
  join pg_class pa on pa.oid = con.confrelid
  join pg_namespace nch on nch.oid = ch.relnamespace and nch.nspname = 'public'
  join pg_namespace npa on npa.oid = pa.relnamespace and npa.nspname = 'public'
  join pg_attribute att  on att.attrelid  = con.conrelid  and att.attnum  = con.conkey[1]
  join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = con.confkey[1]
  where con.contype = 'f' and array_length(con.conkey,1) = 1 and con.conrelid <> con.confrelid;

create temp table _doomed_rows(tbl text, id text, primary key (tbl, id)) on commit drop;
insert into _doomed_rows select 'users', id::text from _doomed_users;
insert into _doomed_rows select 'companies', id::text from _doomed_companies;

do $$
declare r record; n bigint; added bigint; i int;
begin
  for i in 1..40 loop
    added := 0;
    for r in select f.*, t.pk from _fk f join _tbl t on t.name = f.child where t.pk is not null loop
      execute format(
        'insert into _doomed_rows(tbl, id) select %L, x.%I::text from public.%I x '
        'where x.%I is not null and x.%I::text in (select id from _doomed_rows where tbl = %L) '
        'on conflict do nothing',
        r.child, r.pk, r.child, r.col, r.col, r.parent);
      get diagnostics n = row_count; added := added + n;
    end loop;
    exit when added = 0;
  end loop;
  raise notice 'Propagation : % ligne(s) condamnee(s).', (select count(*) from _doomed_rows);
end $$;

-- APERCU avant suppression : lisez-le, c'est le dernier filet de securite
select d.tbl as table_name, count(*) as lignes_supprimees
from _doomed_rows d group by d.tbl order by 2 desc, 1;

do $$
declare r record; n bigint; grand bigint := 0;
begin
  for r in select f.child, f.col, f.parent, t.depth
           from _fk f join _tbl t on t.name = f.child order by t.depth desc
  loop
    execute format('delete from public.%I x where x.%I is not null and x.%I::text in (select id from _doomed_rows where tbl = %L)',
      r.child, r.col, r.col, r.parent);
    get diagnostics n = row_count; grand := grand + n;
  end loop;
  delete from public.users u where u.id in (select id from _doomed_users);
  get diagnostics n = row_count; grand := grand + n;
  delete from public.companies c where c.id in (select id from _doomed_companies);
  get diagnostics n = row_count; grand := grand + n;
  raise notice 'Suppression : % ligne(s).', grand;
end $$;

-- Comptes d'authentification. Si cette ligne echoue (contrainte du schema auth
-- ou de storage), ne bloquez pas : commit quand meme, puis supprimez les
-- comptes restants depuis Authentication > Users dans le dashboard Supabase.
delete from auth.users a
where lower(trim(a.email)) not in (select lower(trim(email)) from _keep_emails);

-- On re-affirme l'exemption de l'editeur, au cas ou
update public.companies
set billing_exempt = true, offer_ap_active = true, offer_as_active = true, offer_ac_active = true
where lower(name) in ('meet aaron', 'meetaaron');

commit;


-- ===========================================================================
-- SCRIPT 3 — VERIFICATION (lecture seule, a lancer apres)
-- ===========================================================================

-- 3a. Il ne doit rester QUE les trois comptes
select u.email, c.name as societe, c.billing_exempt
from public.users u left join public.companies c on c.id = u.company_id
order by u.email;

select 'auth.users restants' as bloc, count(*) from auth.users;

-- 3b. Detection des lignes orphelines : couvre le cas d'une colonne user_id ou
-- company_id declaree SANS cle etrangere, que la propagation n'aurait pas vue.
do $$
declare r record; n bigint;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.table_name not in ('users', 'companies')
      and c.column_name in ('user_id', 'company_id')
  loop
    execute format(
      'select count(*) from public.%I x where x.%I is not null and not exists (select 1 from public.%I p where p.id = x.%I)',
      r.table_name, r.column_name,
      case r.column_name when 'user_id' then 'users' else 'companies' end,
      r.column_name) into n;
    if n > 0 then
      raise notice 'ORPHELINS : %.% -> % ligne(s) a nettoyer a la main', r.table_name, r.column_name, n;
    end if;
  end loop;
  raise notice 'Verification des orphelins terminee.';
end $$;
