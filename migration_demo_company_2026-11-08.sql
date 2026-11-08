-- migration_demo_company_2026-11-08.sql
-- Société de démonstration (testeurs Google Play, revue Apple, captures) :
-- campagnes, envois, ajouts de prospects et suppression de compte désactivés
-- (lib/demo-guard.ts). Plafond API bas : les testeurs peuvent discuter avec
-- Aaron, pas vider le compte Anthropic.
alter table public.companies add column if not exists is_demo boolean not null default false;

update public.companies
   set is_demo = true,
       monthly_api_cap_usd = 5
 where name = 'Démo Meet Aaron';

-- Les deux campagnes fictives du seed étaient « en_cours » : entre le seed et
-- ce déploiement, le cron run-campaigns a pu les prendre pour de vraies
-- campagnes et sourcer de vraies entreprises. On efface tout ce qui n'est
-- pas fictif (les domaines du seed sont en .example.*). Désormais le code
-- ignore les sociétés is_demo (lib/demo-guard.ts), les campagnes restent
-- « en_cours » pour les captures d'écran sans jamais tourner.
delete from public.messages m using public.conversations cv, public.prospects p, public.companies c
 where m.conversation_id = cv.id and cv.prospect_id = p.id and p.company_id = c.id and c.is_demo = true
   and p.email not like '%.example.%';
delete from public.conversations cv using public.prospects p, public.companies c
 where cv.prospect_id = p.id and p.company_id = c.id and c.is_demo = true and p.email not like '%.example.%';
delete from public.prospects p using public.companies c
 where p.company_id = c.id and c.is_demo = true and p.email not like '%.example.%';
delete from public.prospect_companies pc using public.companies c
 where pc.company_id = c.id and c.is_demo = true and pc.domain not like '%.example.%';

-- Le parcours Bienvenue ne doit pas se rouvrir pour chaque testeur (il
-- réécrirait la fiche entreprise de la démo).
update public.users set welcome_done_at = coalesce(welcome_done_at, now())
 where email = 'aaron+demo@meetaaron.app';

-- Vérification : attendu 1 ligne, is_demo true, cap 5, 9 sociétés, 9 contacts.
select c.name, c.is_demo, c.monthly_api_cap_usd,
       (select count(*) from public.prospect_companies pc where pc.company_id = c.id) as societes,
       (select count(*) from public.prospects p where p.company_id = c.id) as contacts
  from public.companies c where c.is_demo = true;
