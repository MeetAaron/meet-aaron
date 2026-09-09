-- migration_imap_connections_2026-09-09.sql
-- Connecteur « Autre boîte mail » (IMAP/SMTP) — voir lib/imap.ts.
--
-- Une boîte hébergée chez OVH, Gandi, Ionos, Infomaniak… (ni Google ni
-- Microsoft) se connecte avec l'adresse + le mot de passe de messagerie,
-- saisis par le commercial. La ligne réutilise oauth_connections :
--   provider               = 'imap'
--   provider_account_email = l'adresse
--   access_token           = le mot de passe CHIFFRÉ (lib/encryption.ts, même
--                            chiffrement que les jetons OAuth)
--   refresh_token          = '' (sans objet)
--   scopes                 = {imap,smtp}
--   expires_at             = 2099 (sans objet)
--   settings (NOUVEAU)     = serveurs IMAP/SMTP, identifiant, dossiers
--                            { imap_host, imap_port, imap_secure, smtp_host,
--                              smtp_port, smtp_secure, username,
--                              sent_folder, aaron_folder }

alter table public.oauth_connections
  add column if not exists settings jsonb;

comment on column public.oauth_connections.settings is
  'Paramètres du fournisseur non-OAuth (provider = imap) : serveurs IMAP/SMTP, identifiant, dossiers. NULL pour google/microsoft.';

-- Si une contrainte limite provider à google/microsoft (table créée avant
-- le dépôt, nom inconnu), on la supprime : le code n'écrit que des valeurs
-- connues ('google', 'microsoft', 'imap').
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.oauth_connections'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.oauth_connections drop constraint %I', c.conname);
  end loop;
end $$;
