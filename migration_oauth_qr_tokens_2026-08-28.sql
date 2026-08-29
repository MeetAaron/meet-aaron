-- migration_oauth_qr_tokens_2026-08-28.sql
-- Demande Alex (28/08/2026) : un QR code sur la page Connexions, à côté des
-- boutons "Connecter" Google/Outlook, permettant au commercial de scanner
-- avec son téléphone pour lancer l'autorisation directement depuis son
-- appareil, avec un pas-à-pas — une fois l'accès autorisé, l'étape "Boîte
-- email connectée" de la checklist de mise en route se coche automatiquement
-- (elle est déjà pilotée par l'état réel de la connexion en base, aucune
-- action supplémentaire nécessaire pour ce point).
--
-- Pourquoi une nouvelle table plutôt que de coder directement le token de
-- session (Supabase access_token) dans le QR : ce dernier reste valide
-- plusieurs heures et donne accès à TOUTE l'app — l'exposer dans un QR
-- affiché à l'écran (capture d'écran, partage, démo) serait risqué. Cette
-- table ne sert qu'à démarrer le flux Google/Outlook, avec un jeton à usage
-- unique et une validité de 5 minutes seulement (voir
-- app/api/auth/qr-token/route.ts pour la création du jeton, et
-- lib/auth-helpers.ts / resolveAndConsumeQrToken pour sa consommation
-- atomique dans app/api/auth/google/route.ts et
-- app/api/auth/microsoft/route.ts, paramètre ?qr=).

create table if not exists oauth_qr_tokens (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_qr_tokens_user_id_idx on oauth_qr_tokens (user_id);

comment on table oauth_qr_tokens is 'Jetons à usage unique et courte durée (5 min) permettant de démarrer le flux OAuth Google/Outlook depuis un autre appareil que celui qui affiche le QR code (page Connexions) — voir app/api/auth/qr-token/route.ts, app/api/auth/google/route.ts et app/api/auth/microsoft/route.ts (paramètre ?qr=).';
