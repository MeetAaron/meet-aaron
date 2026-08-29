-- migration_business_summary_backup_2026-08-29.sql
-- Demande Alex (29/08/2026) : "quand on fait des modifs sur l'app [...] ne
-- supprimons pas pour autant les résumés que tu avais réalisés pour les
-- comptes" — suite à la perte du résumé business du compte "Open X".
--
-- Important à préciser à Alex : mes modifications de CODE (fichiers .jsx/.ts
-- poussés sur GitHub) ne touchent JAMAIS aux données existantes en base —
-- seul un script SQL exécuté manuellement par lui dans Supabase peut changer
-- des données, et mes migrations n'ont toujours fait qu'AJOUTER des colonnes
-- (jamais supprimé de données). La perte du résumé "Open X" vient donc d'une
-- RÉGÉNÉRATION applicative (le bouton "Générer mon résumé" du chat, ou une
-- correction manuelle dans Préférences) qui REMPLACE entièrement l'ancien
-- texte par le nouveau — comportement normal et volontaire de ces actions,
-- mais qui ne laissait jusqu'ici aucune trace de l'ancienne version en cas
-- d'erreur/de test.
--
-- Filet de sécurité ajouté : avant CHAQUE remplacement complet de
-- business_summary (régénération via /api/business-summary POST, ou
-- correction manuelle via PATCH — voir ces deux routes), l'ancienne valeur
-- est désormais copiée dans business_summary_backup avant d'être écrasée.
-- Ne couvre PAS l'ajout via le chat (mettre_a_jour_profil_entreprise), qui
-- reste additif (n'écrase jamais rien, voir runMettreAJourProfilEntreprise).

alter table companies add column if not exists business_summary_backup text;
alter table companies add column if not exists business_summary_backup_at timestamptz;

comment on column companies.business_summary_backup is 'Copie de la valeur précédente de business_summary, prise juste avant chaque remplacement complet (régénération ou correction manuelle) — filet de sécurité pour pouvoir restaurer en cas d''erreur/de test, voir app/api/business-summary/route.ts.';
