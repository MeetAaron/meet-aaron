-- Diagnostic (lecture seule, aucune modification) — à exécuter dans l'éditeur
-- SQL de Supabase pour comprendre deux symptômes remontés par Alex après
-- avoir recréé son compte alexandre.fevre01@gmail.com le 2026-08-19 :
--   1. Le cadenas sur "Opportunités"/"Clients" réapparaît en changeant de
--      rubrique, alors qu'il a pris les 3 abonnements Aaron.
--   2. Après avoir quitté la page "Chat avec Aaron" avant la fin de
--      l'affichage du message d'accueil, "accès non autorisé" réapparaît à
--      la reconnexion suivante sur certaines pages.
--
-- Ce script vérifie deux choses en particulier :
--   a) Les valeurs actuelles de role / offer_ap_active / offer_as_active /
--      offer_ac_active pour le compte.
--   b) S'il existe PLUSIEURS lignes "users" et/ou "companies" liées à cet
--      email (résidu possible d'une recréation de compte, ce qui
--      expliquerait un comportement incohérent selon la ligne lue).

-- 1) Toutes les lignes "users" pour cet email (devrait n'y en avoir qu'UNE)
select
  id as user_id,
  auth_user_id,
  email,
  role,
  company_id,
  created_at
from users
where email = 'alexandre.fevre01@gmail.com'
order by created_at desc;

-- 2) Pour chaque société trouvée ci-dessus, ses colonnes d'abonnement et
-- l'identifiant Stripe associé (devrait n'y avoir qu'UNE société).
select
  c.id as company_id,
  c.name as company_name,
  c.offer_ap_active,
  c.offer_as_active,
  c.offer_ac_active,
  c.stripe_customer_id,
  c.stripe_subscription_id,
  c.created_at
from companies c
where c.id in (
  select company_id from users where email = 'alexandre.fevre01@gmail.com'
)
order by c.created_at desc;

-- 3) Combien de comptes Supabase Auth existent pour cet email (utile pour
-- savoir si le compte Auth d'avant la suppression existe toujours, ou si un
-- nouveau a bien été créé). Nécessite d'être exécuté avec les droits admin
-- (l'éditeur SQL Supabase les a par défaut).
select id as auth_user_id, email, created_at, confirmed_at
from auth.users
where email = 'alexandre.fevre01@gmail.com'
order by created_at desc;
