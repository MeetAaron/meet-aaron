-- migration_billing_country_2026-09-04.sql
-- Demande Alex (04/09/2026) : « quand l'utilisateur paye un abonnement ou un
-- boost, la monnaie doit dépendre de son entreprise (€ si entreprise en
-- europe, aud si australie, etc. C'est logique) ».
--
-- Pour choisir la devise il faut connaître le pays de l'entreprise. Aucune
-- colonne ne le portait : companies a bien legal_address, mais c'est du texte
-- libre — impossible d'en déduire un pays de façon fiable.
--
-- On stocke donc le code pays ISO à 2 lettres tel que Stripe le renvoie dans
-- l'adresse de facturation saisie au moment du paiement
-- (session.customer_details.address.country). C'est la source la plus fiable :
-- c'est l'adresse que le client a lui-même déclarée pour être facturé, et
-- c'est déjà celle qui sert au calcul de la TVA/GST.
--
-- Tant que la colonne est vide (aucun paiement encore effectué), le code
-- retombe sur l'euro — voir currencyForCountry() dans lib/boost-tiers.ts.

alter table companies
  add column if not exists billing_country text;

comment on column companies.billing_country is
  'Code pays ISO 3166-1 alpha-2 de l''adresse de facturation Stripe, renseigné automatiquement au premier paiement. Détermine la devise des achats de boosts (voir lib/boost-tiers.ts). NULL = inconnu, on facture en euros.';
