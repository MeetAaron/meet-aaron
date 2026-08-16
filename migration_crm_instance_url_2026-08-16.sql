-- migration_crm_instance_url_2026-08-16.sql
-- Ajoute crm_connections.instance_url — nécessaire pour Salesforce et
-- Pipedrive : contrairement à HubSpot (une seule API centrale,
-- api.hubapi.com), Salesforce (instance_url, ex:
-- https://monentreprise.my.salesforce.com) et Pipedrive (api_domain, ex:
-- https://monentreprise.pipedrive.com) renvoient chacun une URL d'API propre
-- à l'organisation du client lors de l'échange du token OAuth. Colonne
-- laissée NULL pour HubSpot (non utilisée). Voir app/api/auth/salesforce,
-- app/api/auth/pipedrive et lib/crm-sync.ts.

alter table crm_connections add column if not exists instance_url text;
