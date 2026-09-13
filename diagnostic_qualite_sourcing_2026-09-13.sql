-- diagnostic_qualite_sourcing_2026-09-13.sql
--
-- « Est-ce qu'Aaron sait bien sourcer, ou est-ce qu'il ramène des
-- contact@ ? » — chiffres réels, pas une impression.
--
-- Rappel de ce qui compte : une boîte générique (contact@, info@, accueil@)
-- part à l'accueil, pas au décideur. Un prospect sans nom identifié, c'est
-- un email qui commence par « Bonjour, » — le signal le plus sûr de
-- démarchage de masse.

-- ── 1. Vue d'ensemble : quelle part du sourcing est nominative ? ───────────
select
  count(*)                                                as total_prospects_amenes_par_aaron,
  count(*) filter (where p.full_name = 'Contact à identifier'
                      or p.full_name is null)             as sans_nom,
  count(*) filter (where p.job_title is null)             as sans_poste,
  count(*) filter (where split_part(p.email, '@', 1) ~*
        '^(contact|info|infos|accueil|hello|bonjour|commercial|commerce|sales|admin|administration|direction|secretariat|secretatiat|bureau|office|mail|email|service|client|clients|sav|support|rh|recrutement|compta|comptabilite|facturation|devis|welcome|team|agence|boutique|magasin|shop|reservation|reservations|booking)$')
                                                          as adresses_generiques,
  count(*) filter (where p.linkedin_url is not null)      as avec_linkedin
from public.prospects p
where p.origin = 'amene_par_aaron';

-- ── 2. La liste nominative des mauvais élèves ─────────────────────────────
-- Ce sont EXACTEMENT les fiches qu'Alex ne veut pas voir.
select
  p.created_at,
  pc.name as entreprise,
  p.full_name,
  p.job_title,
  p.email,
  p.linkedin_url
from public.prospects p
left join public.prospect_companies pc on pc.id = p.prospect_company_id
where p.origin = 'amene_par_aaron'
  and (
    p.full_name = 'Contact à identifier'
    or p.full_name is null
    or split_part(p.email, '@', 1) ~*
       '^(contact|info|infos|accueil|hello|bonjour|commercial|commerce|sales|admin|administration|direction|secretariat|bureau|office|mail|email|service|client|clients|sav|support|rh|recrutement|compta|comptabilite|facturation|devis|welcome|team|agence|boutique|magasin|shop|reservation|reservations|booking)$'
  )
order by p.created_at desc
limit 100;

-- ── 3. Répartition des postes réellement trouvés ──────────────────────────
-- Pour voir si Aaron vise des décideurs ou ramasse ce qui traîne.
select
  coalesce(p.job_title, '(aucun poste trouvé)') as poste,
  count(*) as nb
from public.prospects p
where p.origin = 'amene_par_aaron'
group by 1
order by nb desc
limit 40;
