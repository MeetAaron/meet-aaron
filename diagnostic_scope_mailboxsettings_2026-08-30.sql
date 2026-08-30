-- diagnostic_scope_mailboxsettings_2026-08-30.sql
-- Vérifie si la connexion Outlook actuelle a bien le scope
-- MailboxSettings.ReadWrite (nécessaire pour le libellé "🤖 Géré par Aaron"
-- sur Outlook). Lecture seule.

select
  provider_account_email,
  scopes,
  scopes @> array['MailboxSettings.ReadWrite'] as a_le_scope_categorie
from oauth_connections
where provider = 'microsoft';
