-- migration_billing_exempt_2026-09-08.sql
--
-- EXEMPTION DE FACTURATION (demande Alex, 08/09/2026 : « pour le compte aaron
-- tu le mets en drapeau exemption »).
--
-- MEET AARON est une entreprise individuelle : Alexandre Fevre utilisant son
-- propre produit, il n'y a ni vente ni fourniture, donc rien à facturer et
-- rien à « remiser ». Un abonnement Stripe à 0 € serait pire qu'inutile — il
-- polluerait le MRR et les statistiques de conversion. D'où un drapeau plutôt
-- qu'un prix.
--
-- Ce drapeau court-circuite DEUX contrôles, et deux seulement :
--   - lib/subscription-status.ts : le statut de paiement est réputé à jour.
--     Protège du scénario où un abonnement Stripe créé puis annulé sur cette
--     société écrirait subscription_status = 'canceled' et couperait Aaron
--     chez l'éditeur lui-même.
--   - app/api/auth/link/route.ts : la connexion exige normalement qu'au moins
--     un module soit actif, or un module n'est activé que par Stripe.
--
-- Il ne touche PAS aux coûts d'API : plafond mensuel, plafond quotidien et
-- plafond dur s'appliquent exactement comme pour un client payant. C'est
-- voulu — l'éditeur doit voir ses propres coûts réels.

alter table public.companies
  add column if not exists billing_exempt boolean not null default false;

comment on column public.companies.billing_exempt is
  'Société exemptée d''abonnement (compte interne de l''éditeur). Court-circuite le contrôle de paiement et l''exigence de module actif, jamais les plafonds de coût API.';

-- Application au compte de l'éditeur. Les modules sont activés à la main
-- puisque aucun paiement Stripe ne le fera : sans eux, certaines
-- fonctionnalités (Aaron Sales, Aaron Clients) resteraient masquées.
update public.companies
set billing_exempt = true,
    offer_ap_active = true,
    offer_as_active = true,
    offer_ac_active = true
where lower(name) in ('meet aaron', 'meetaaron');

-- Vérification : doit renvoyer exactement la société de l'éditeur.
select id, name, billing_exempt, offer_ap_active, offer_as_active, offer_ac_active, subscription_status
from public.companies
where billing_exempt = true;
