-- migration_diagnostic_generic_domain_company_merge_2026-08-25.sql
--
-- Contexte (bug remonté par Alex, 2026-08-25) : dans la liste Prospects, 3
-- prospects avec 3 sociétés différentes affichaient tous "Dupont SAS+2".
--
-- Root cause (corrigé dans app/api/prospects/route.ts) : la création de
-- prospect matchait/fusionnait la fiche "prospect_companies" uniquement par
-- domaine email (company_id + domain), sans tenir compte du fait qu'un
-- domaine grand public (gmail.com, yahoo.fr, outlook.com, etc.) ne
-- représente PAS une société unique. Résultat : plusieurs prospects de
-- test créés avec des emails sur le même domaine grand public, mais avec
-- des noms de société différents saisis dans le formulaire, se sont
-- retrouvés rattachés à LA MÊME fiche prospect_companies. Le nom de
-- société affiché est celui de la fiche partagée (le tout premier saisi,
-- "Dupont SAS" dans le cas d'Alex) ; les noms saisis pour les prospects
-- suivants n'ont JAMAIS été enregistrés nulle part (le code ne complète
-- que les champs encore vides sur la fiche société existante) — ils sont
-- donc irrécupérables par SQL. Le badge "+2" à côté du nom n'est pas un
-- bug d'affichage : il reflète fidèlement le nombre de prospects
-- rattachés à cette même fiche société fusionnée par erreur.
--
-- Ce script est 100% EN LECTURE SEULE (aucun UPDATE/DELETE). Il sert à
-- repérer les fiches prospect_companies affectées par ce bug, pour
-- qu'Alex décide au cas par cas quoi faire (voir options en bas de fichier)
-- — notamment parce que les noms de société d'origine ne peuvent pas être
-- reconstruits automatiquement.

-- 1) Fiches "prospect_companies" sur un domaine grand public, rattachées à
--    plus d'un prospect : ce sont les fiches suspectées d'avoir fusionné à
--    tort plusieurs prospects distincts.
select
  pc.id                as prospect_company_id,
  pc.company_id,
  pc.domain,
  pc.name              as displayed_company_name,
  count(p.id)           as nb_prospects_rattaches
from prospect_companies pc
join prospects p on p.prospect_company_id = pc.id
where pc.domain in (
  'gmail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'icloud.com', 'live.com', 'live.fr', 'aol.com', 'protonmail.com', 'gmx.com', 'gmx.fr',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'laposte.net', 'sfr.fr', 'bbox.fr', 'yandex.com', 'mail.com'
)
group by pc.id, pc.company_id, pc.domain, pc.name
having count(p.id) > 1
order by nb_prospects_rattaches desc;

-- 2) Détail des prospects concernés par chacune de ces fiches (pour
--    identifier lesquels sont du vrai test data vs de vrais prospects) :
select
  p.id            as prospect_id,
  p.full_name,
  p.email,
  p.prospect_company_id,
  pc.name         as displayed_company_name,
  p.created_at
from prospects p
join prospect_companies pc on pc.id = p.prospect_company_id
where pc.domain in (
  'gmail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'icloud.com', 'live.com', 'live.fr', 'aol.com', 'protonmail.com', 'gmx.com', 'gmx.fr',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'laposte.net', 'sfr.fr', 'bbox.fr', 'yandex.com', 'mail.com'
)
order by p.prospect_company_id, p.created_at;

-- Options pour corriger les données existantes une fois la requête 2)
-- passée en revue (à faire manuellement, PAS via ce script, car le bon
-- nom de société pour chaque prospect n'est pas déductible automatiquement) :
--
--   a) Si ce sont des prospects de test sans valeur : les supprimer
--      depuis l'app (bouton 🗑 dans la liste Prospects) et les recréer —
--      le bug étant corrigé, chacun obtiendra désormais sa propre fiche
--      société avec le bon nom.
--
--   b) Si ce sont de vrais prospects à conserver : pour chacun (sauf
--      celui qui a la bonne fiche), ouvrir sa fiche dans l'app
--      (bouton "Conversation" > éditeur de société) et renseigner le
--      nom correct — cela crée/complète une fiche prospect_companies
--      dédiée plutôt que de la partager. Si l'UI ne permet pas de
--      détacher un prospect d'une fiche société partagée, demander un
--      script SQL ciblé (INSERT d'une nouvelle prospect_companies +
--      UPDATE de prospects.prospect_company_id) pour CE prospect précis
--      une fois son bon nom de société confirmé.
