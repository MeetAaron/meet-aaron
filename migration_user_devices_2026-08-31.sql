-- migration_user_devices_2026-08-31.sql
-- Email de sécurité à la connexion depuis un nouvel appareil (docx Modifs
-- Aaron 30/08/2026, item 3bis : "si connexion via un autre PC, demander email
-- de sécurité"). Chaque navigateur envoie un identifiant opaque (généré et
-- conservé dans son localStorage) une fois par jour à /api/auth/link ; cette
-- table mémorise les appareils déjà vus par compte. Appareil inconnu → email
-- d'alerte au commercial (sauf le tout premier enregistré, pour ne pas
-- alerter tous les comptes existants le jour de la mise en place).
-- Voir app/api/auth/link/route.ts (registerDeviceAndNotify) et
-- lib/supabase-browser.ts (getDeviceId).

create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists user_devices_user_id_idx on user_devices (user_id);
