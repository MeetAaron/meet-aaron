-- migration_prospect_first_message_error_2026-08-30.sql
-- Diagnostic : "Prospect ajouté, mais le premier message n'a pas pu être
-- envoyé automatiquement." (Alex, 30/08/2026, test avec Outlook fraîchement
-- connecté) — app/api/prospects/[id]/generate-first-contact/route.ts avale
-- l'erreur réelle dans un message générique. On stocke le message d'erreur
-- brut pour diagnostiquer sans accès aux logs serveur (même schéma que
-- migration_email_verification_error_log_2026-08-30.sql).

alter table prospects add column if not exists first_message_send_error text;
alter table prospects add column if not exists first_message_send_error_at timestamptz;

comment on column prospects.first_message_send_error is 'Message d''erreur brut si la génération/l''envoi du tout premier message a échoué (diagnostic panne, voir generate-first-contact/route.ts).';
comment on column prospects.first_message_send_error_at is 'Date du dernier échec enregistré dans first_message_send_error.';
