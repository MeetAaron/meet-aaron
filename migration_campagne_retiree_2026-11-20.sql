-- migration_campagne_retiree_2026-11-20.sql
-- « Retirer de la liste » une campagne (croix sur la page Campagnes).
-- La ligne n'est jamais supprimée : prospects, échanges et résultats en
-- dépendent. archived_at la masque seulement de la page Campagnes.
alter table prospecting_campaigns add column if not exists archived_at timestamptz;

select column_name, data_type from information_schema.columns
where table_name = 'prospecting_campaigns' and column_name = 'archived_at';
