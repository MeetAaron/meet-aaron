-- migration_subscription_modules_2026-08-16.sql
-- Abonnement multi-module (docx item 31 + section STRIPE) : chaque société
-- peut désormais activer/désactiver indépendamment Aaron Prospect, Aaron
-- Opportunités et Aaron Clients, chacun étant une ligne ("subscription item")
-- séparée sur le même abonnement Stripe (une seule facture, plusieurs
-- lignes) — voir lib/subscription.ts et app/api/subscription/modules/route.ts.
--
-- L'ancienne colonne `companies.offer` (une seule valeur AP/AS/AC, offre de
-- base + un seul module additionnel) est conservée telle quelle pour ne rien
-- casser rétroactivement, mais n'est plus la source de vérité pour la
-- navigation ni pour Stripe à partir de ce lot.

alter table companies add column if not exists offer_ap_active boolean not null default true;
alter table companies add column if not exists offer_as_active boolean not null default false;
alter table companies add column if not exists offer_ac_active boolean not null default false;

-- Identifiant du "subscription item" Stripe correspondant à chaque module,
-- pour pouvoir le supprimer précisément lors d'une désactivation (au lieu de
-- deviner lequel des items de l'abonnement correspond à quel module).
alter table companies add column if not exists stripe_subscription_item_ap text;
alter table companies add column if not exists stripe_subscription_item_as text;
alter table companies add column if not exists stripe_subscription_item_ac text;

-- Reprise des sociétés déjà existantes : Aaron Prospect était jusqu'ici
-- toujours actif de fait (offre de base incluse à la souscription initiale,
-- voir l'ancien commentaire dans app/app/dashboard/page.jsx), Aaron
-- Opportunités/Clients actifs seulement si `offer` valait déjà AS/AC.
-- Les colonnes stripe_subscription_item_* restent NULL pour ces sociétés :
-- elles sont résolues à la volée (une seule fois, puis mises en cache) au
-- premier appel de désactivation via lib/subscription.ts, en listant les
-- subscription items Stripe existants de la société.
update companies set offer_ap_active = true;
update companies set offer_as_active = true where offer = 'AS';
update companies set offer_ac_active = true where offer = 'AC';
