-- migration_crm_auto_sync_2026-08-31.sql
-- Onglet CRM (docx Modifs Aaron 30/08/2026) : les "niveaux de collaboration"
-- 0-3 (fichier à importer, synchro toutes les X heures) sont remplacés par
-- un seul réglage : la synchronisation AUTOMATIQUE et À SENS UNIQUE
-- (Aaron → CRM). Dès qu'un prospect devient client dans Aaron, il est ajouté
-- dans le CRM connecté (contact + affaire gagnée), immédiatement — rien ne
-- remonte jamais du CRM vers Aaron. Voir autoSyncWonProspect dans
-- lib/crm-sync.ts et l'onglet CRM de Mon compte (app/app/connexions/page.jsx).
-- Activé par défaut : c'est le comportement attendu dès qu'un CRM est
-- connecté ; le commercial peut le couper depuis l'onglet CRM.

alter table companies add column if not exists crm_auto_sync boolean not null default true;
