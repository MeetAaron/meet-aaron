-- migration_aaron_archive_threads_2026-09-01.sql
-- « Aaron range les fils qu'il gère hors de la boîte de réception »
-- (décision Alex, 01/09/2026, suite à la question remontée par les
-- commerciaux de son père : « tu nous demandes toujours de supprimer les
-- emails traités, doit-on faire pareil avec ceux gérés par Aaron ? »).
--
-- La réponse produit est : NON, on ne supprime jamais un email géré par
-- Aaron — mais si le commercial veut malgré tout une boîte de réception
-- propre, Aaron l'archive à sa place. Archiver est réversible et sans perte,
-- contrairement à la suppression :
--   - Gmail : on retire le libellé INBOX du fil. Dès qu'un nouveau message
--     arrive dans ce fil, Gmail le remet automatiquement en boîte de
--     réception — le commercial reprend donc la main tout seul dès qu'il se
--     passe quelque chose.
--   - Outlook : le message est déplacé dans le dossier Archive. Les réponses
--     suivantes arrivent normalement en boîte de réception.
-- Dans les deux cas le libellé/la catégorie « 🤖 Géré par Aaron » reste posé,
-- et la lecture par Aaron n'est pas affectée (depuis le 01/09/2026 il lit
-- toute la boîte et plus seulement la boîte de réception — voir
-- lib/google.ts::listNewGmailMessages et lib/microsoft.ts).
--
-- Activé PAR DÉFAUT (true) : c'est le comportement demandé par Alex, et le
-- seul qui répond vraiment au réflexe « je supprime ce que j'ai traité ».
-- Chaque commercial peut le désactiver depuis Mon compte > Préférences.
-- À exécuter dans l'éditeur SQL Supabase.

alter table users
  add column if not exists aaron_archive_threads boolean not null default true;

comment on column users.aaron_archive_threads is
  'true (défaut) = Aaron sort de la boîte de réception les fils qu''il gère (archive Gmail / dossier Archive Outlook), le libellé « Géré par Aaron » restant posé. false = Aaron ne touche pas au rangement de la boîte. Ne supprime jamais rien dans les deux cas.';
