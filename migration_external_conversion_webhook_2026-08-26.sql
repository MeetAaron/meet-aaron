-- migration_external_conversion_webhook_2026-08-26.sql
--
-- Demande d'Alex (26/08/2026) : généraliser à N'IMPORTE QUEL commercial le
-- mécanisme déjà construit pour meetaaron.app lui-même (voir
-- lib/prospect-conversion.ts et migration_prospecting_goal_default_email_
-- 2026-08-26.sql, objectif "inscription/abonnement direct") — un commercial
-- qui vend un produit en auto-service a besoin qu'Aaron sache
-- automatiquement quand un de SES prospects a payé/s'est inscrit, sans RDV
-- ni bilan manuel, exactement comme Alex avec Stripe pour meetaaron.app.
--
-- Ajoute une colonne "secret de webhook" unique par société, utilisée dans
-- l'URL de app/api/webhooks/external-conversion/[secret]/route.ts. Chaque
-- société a un secret généré automatiquement (gen_random_uuid()) — rien à
-- faire côté commercial pour l'obtenir, il apparaît directement (copiable)
-- dans Préférences dès que ce script est exécuté.
--
-- Sans risque à rejouer : colonne "if not exists", backfill uniquement des
-- lignes encore NULL.

alter table companies
  add column if not exists external_conversion_webhook_secret text;

-- Backfill des sociétés existantes (la nouvelle colonne n'a pas encore de
-- valeur par défaut tant que ce update n'est pas passé une première fois).
update companies
set external_conversion_webhook_secret = gen_random_uuid()::text
where external_conversion_webhook_secret is null;

-- Valeur par défaut pour toute société créée après cette migration.
alter table companies
  alter column external_conversion_webhook_secret set default gen_random_uuid()::text;

alter table companies
  alter column external_conversion_webhook_secret set not null;

-- Recherche par secret (une par requête webhook entrante) : index unique,
-- garantit aussi qu'aucune collision n'est possible entre deux sociétés.
create unique index if not exists companies_external_conversion_webhook_secret_idx
  on companies (external_conversion_webhook_secret);

comment on column companies.external_conversion_webhook_secret is 'Jeton secret unique par société, utilisé dans l''URL du webhook générique /api/webhooks/external-conversion/[secret] (voir lib/prospect-conversion.ts et cette route) pour connecter le Stripe/CRM/Zapier/Make du commercial à la conversion automatique prospect -> client dans Aaron, sans RDV ni bilan manuel. Affiché en copiable dans Préférences (app/app/connexions/page.jsx).';
