-- migration_devis_upload_2026-09-01.sql
-- Lot 3 « Devis » (docx « mon avis » d'Alex, 31/08/2026) :
--   - le commercial DÉPOSE son devis (PDF/Word) sur la fiche contact ; Aaron
--     lit le document, vérifie que c'est bien le bon client, en tire le
--     montant, et propose l'email d'accompagnement (aperçu/modif ou envoi
--     direct, pièce jointe incluse) ;
--   - « Répondre » sur la notification « Devis à faire » : « Aaron, il me
--     manque ces infos… » (email rédigé par Aaron, modifiable) ou « Je lui
--     écris moi-même sous 24h » → la relance quotidienne est mise en pause
--     (quote_paused_at) jusqu'à la prochaine réponse du client.
-- À exécuter dans l'éditeur SQL Supabase.

alter table prospects add column if not exists devis_file_path text;      -- chemin dans le bucket Storage « documents »
alter table prospects add column if not exists devis_file_name text;
alter table prospects add column if not exists devis_file_type text;
alter table prospects add column if not exists devis_uploaded_at timestamptz;
alter table prospects add column if not exists devis_check jsonb;         -- { matches_prospect, detected_client, detected_company, total_ttc_eur, reason }
alter table prospects add column if not exists quote_paused_at timestamptz;

comment on column prospects.quote_paused_at is 'Relance quotidienne « devis à faire » en pause (le commercial a répondu lui-même) — remise à null par le cron check-inbox à la prochaine réponse entrante du contact.';
