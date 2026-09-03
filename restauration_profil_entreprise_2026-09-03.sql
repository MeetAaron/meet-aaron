-- restauration_profil_entreprise_2026-09-03.sql
-- Le profil actif de la société « Meet Aaron » est vide (0 caractère) alors
-- que la sauvegarde du 29/08/2026 contient 9 298 caractères intacts.
-- Cause : lib/business-summary-store.ts écrasait le profil même quand la
-- sauvegarde échouait (table business_summary_versions absente). Corrigé
-- dans le code le 03/09/2026 — ce script répare la donnée.

-- 1) Vérification avant : on doit voir profil_actuel = 0 et sauvegarde = 9298
select length(coalesce(business_summary, ''))        as profil_actuel_caracteres,
       length(coalesce(business_summary_backup, '')) as sauvegarde_caracteres
from companies
where id = '5c1841ab-f734-42c3-83e9-f20419e6e811';

-- 2) Restauration (ne s'exécute QUE si le profil actuel est vide —
--    impossible d'écraser quoi que ce soit par erreur)
update companies
set business_summary = business_summary_backup
where id = '5c1841ab-f734-42c3-83e9-f20419e6e811'
  and coalesce(business_summary, '') = ''
  and coalesce(business_summary_backup, '') <> '';

-- 3) Vérification après : profil_actuel doit maintenant valoir 9298
select length(coalesce(business_summary, '')) as profil_actuel_caracteres,
       left(business_summary, 300)            as debut_du_profil
from companies
where id = '5c1841ab-f734-42c3-83e9-f20419e6e811';

-- 4) L'historique doit contenir au moins 1 version (recopiée par la
--    migration business_summary_versions que tu viens de lancer)
select id, length(summary) as caracteres, created_at
from business_summary_versions
where company_id = '5c1841ab-f734-42c3-83e9-f20419e6e811'
order by created_at desc;
