-- migration_signature_multilingue_2026-09-26.sql
--
-- SIGNATURE EMAIL PAR LANGUE (demande Alex, A_FAIRE.docx : « Oui mets tout
-- ca en place evidement. Ca semble logique. Go. »)
--
-- Aaron ecrit au prospect dans SA langue (lib/prospect-locale.ts : pays lu
-- dans l'adresse, extension du domaine, langue cible de la campagne). Mais
-- la signature collee en bas du message restait, elle, dans une seule
-- langue : un email en anglais impeccable se terminait par
-- « Cordialement / Directeur commercial / Tel : ... ».
--
-- Une seule colonne JSON { "en": "...", "de": "...", ... } plutot que sept
-- colonnes : la liste des langues supportees bouge (7 aujourd'hui), et une
-- langue absente de l'objet retombe simplement sur users.email_signature,
-- qui reste la signature par defaut. Rien a migrer : tous les comptes
-- existants gardent exactement le comportement actuel.

alter table public.users
  add column if not exists email_signature_by_locale jsonb;

comment on column public.users.email_signature_by_locale is
  'Signature email par langue de destinataire : { "en": "Best regards\nJohn", ... }. Langue absente => repli sur email_signature. Voir lib/signature-locale.ts.';

-- ────────────────────────────────────────────────────────────────────────────
-- ACCOMPAGNEMENT DNS AUTOMATIQUE (meme demande, A_FAIRE.docx du 26/09/2026 :
-- « Il faut faire le plus automatique possible. Donc probablement envoyer un
-- email pas a pas... »)
--
-- Memoire de l'envoi des instructions SPF/DKIM/DMARC, pour deux raisons :
--   - ne les envoyer QU'UNE FOIS par connexion (un rappel quotidien ferait
--     desinstaller l'application avant de faire creer l'enregistrement) ;
--   - savoir, le jour ou le domaine devient correct, qu'il faut envoyer la
--     CONFIRMATION (« c'est en place, je reprends ») — sans cette colonne on
--     ne sait pas distinguer « repare » de « n'a jamais eu de probleme ».
--
-- Remise a null par le cron /api/cron/dns-watch quand le domaine est
-- repare : une regression future (domaine transfere, zone DNS reinitialisee)
-- redeclenche alors tout le processus sans intervention.

alter table public.oauth_connections
  add column if not exists dns_setup_email_sent_at timestamptz;

comment on column public.oauth_connections.dns_setup_email_sent_at is
  'Date d''envoi des instructions DNS pas-a-pas (lib/dns-setup-email.ts). Remise a null quand le domaine devient correct, pour redeclencher en cas de regression.';
