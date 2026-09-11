-- diagnostic_avant_menage_2026-09-11.sql
--
-- NE MODIFIE RIEN. À jouer AVANT le script de suppression, et à me coller.
-- Trois questions auxquelles il répond :
--
--   1) Quels comptes existent, et lequel on garde ?
--   2) D'où vient le « [Message tronqué] » de Gmail ? (hypothèse : la
--      signature contient une image collée en base64, qui fait exploser la
--      taille du message au-delà des ~102 Ko à partir desquels Gmail coupe)
--   3) Quelles tables pointent vers users ? (pour supprimer dans le bon ordre)

-- ── 1. Inventaire des comptes ────────────────────────────────────────────
select
  u.id,
  u.email,
  u.full_name,
  u.locale,
  u.created_at,
  c.name as societe
from public.users u
left join public.companies c on c.id = u.company_id
order by u.created_at;

-- ── 2. Taille de ce qu'on ajoute au bas de chaque email ──────────────────
-- Gmail affiche « [Message tronqué] » au-delà d'environ 102 400 octets.
-- Le corps rédigé par Aaron fait 1 à 2 Ko : si le total explose, c'est en
-- dessous du « Bonne journée, » que ça se joue.
select
  u.email,
  length(coalesce(u.email_signature, ''))            as signature_caracteres,
  length(coalesce(u.email_signature_image_url, ''))  as url_image_signature_caracteres,
  length(coalesce(u.email_banner_image_url, ''))     as url_bandeau_caracteres,
  -- Une URL normale fait ~150 caractères. Des dizaines de milliers =
  -- une image collée en base64 dans le champ, et c'est la cause.
  (coalesce(u.email_signature, '') like '%data:image%')            as signature_contient_une_image_base64,
  (coalesce(u.email_signature_image_url, '') like 'data:%')        as url_signature_est_du_base64,
  (coalesce(u.email_banner_image_url, '') like 'data:%')           as url_bandeau_est_du_base64,
  length(coalesce(u.email_signature, ''))
    + length(coalesce(u.email_signature_image_url, ''))
    + length(coalesce(u.email_banner_image_url, ''))               as total_octets_ajoutes
from public.users u
order by total_octets_ajoutes desc;

-- ── 3. Toutes les tables qui référencent users (graphe des dépendances) ──
select
  tc.table_name       as table_qui_pointe_vers_users,
  kcu.column_name     as colonne,
  rc.delete_rule      as regle_de_suppression
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and ccu.table_name = 'users'
order by 1, 2;
