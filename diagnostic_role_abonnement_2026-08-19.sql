-- Diagnostic (lecture seule, aucune modification) — à exécuter dans l'éditeur
-- SQL de Supabase pour comprendre pourquoi "Mon équipe" et "Suggestions"
-- affichent "Accès non autorisé" pour alexandre.fevre01@gmail.com, et
-- pourquoi "Opportunités"/"Clients" affichent un cadenas.
--
-- Ces deux pages (voir app/api/team/route.ts et app/api/feedback/route.ts)
-- exigent que le rôle de l'utilisateur en base soit exactement 'patron'.
-- Le cadenas Opportunités/Clients reflète les colonnes offer_as_active /
-- offer_ac_active de la société. Cette requête affiche les deux d'un coup.

select
  u.id as user_id,
  u.email,
  u.role,
  u.company_id,
  c.name as company_name,
  c.offer_ap_active,
  c.offer_as_active,
  c.offer_ac_active,
  c.stripe_customer_id,
  c.stripe_subscription_id
from users u
left join companies c on c.id = u.company_id
where u.email = 'alexandre.fevre01@gmail.com';
