-- migration_account_page_2026-08-25.sql
-- Fusion "Préférences" + "Abonnement" dans "Mon compte" (demande Alex,
-- 2026-08-25) + vraie page profil (email/mot de passe) + signature email
-- avec pièce jointe image (carte de visite).

-- 1) URL publique de l'image de signature (carte de visite), en plus du
--    texte déjà stocké dans users.email_signature.
alter table users add column if not exists email_signature_image_url text;

-- 2) Bucket de stockage public dédié aux images de signature — public car
--    ces images doivent être chargeables directement par le client email du
--    destinataire (Gmail, Outlook...) sans authentification, contrairement
--    au bucket "documents" (privé, accédé via URL signée).
insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', true)
on conflict (id) do update set public = true;

-- Politique : n'importe qui peut LIRE (le client email du destinataire n'est
-- jamais authentifié auprès de Supabase).
drop policy if exists "Signatures publiques en lecture" on storage.objects;
create policy "Signatures publiques en lecture"
  on storage.objects for select
  using (bucket_id = 'signatures');

-- Politique : un utilisateur authentifié ne peut écrire que dans son propre
-- dossier (préfixe "<auth.uid()>/...") — voir app/api/signature/image/route.ts,
-- qui utilise la clé service_role et respecte donc déjà cette contrainte côté
-- serveur ; cette policy protège en plus tout accès direct depuis le client.
drop policy if exists "Signatures écriture par propriétaire" on storage.objects;
create policy "Signatures écriture par propriétaire"
  on storage.objects for insert
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Signatures suppression par propriétaire" on storage.objects;
create policy "Signatures suppression par propriétaire"
  on storage.objects for delete
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
