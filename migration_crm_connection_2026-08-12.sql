-- migration_crm_connection_2026-08-12.sql
-- Niveaux de collaboration CRM (Préférences) : niveau 2/3 permet d'indiquer
-- quel CRM utiliser (Divalto, Salesforce, HubSpot, etc.) — la connexion API
-- réelle par fournisseur reste un chantier séparé, ceci ne fait que capter
-- l'intention/contexte pour qu'Open X sache quoi développer en priorité.
--
-- À exécuter dans l'éditeur SQL Supabase.

alter table companies add column if not exists crm_provider text; -- ex: 'divalto', 'salesforce', 'hubspot', 'pipedrive', 'autre'
alter table companies add column if not exists crm_connection_notes text; -- précisions libres du client (nom exact, contact IT, etc.)
