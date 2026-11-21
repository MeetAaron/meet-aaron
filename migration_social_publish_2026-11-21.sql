-- 21/11/2026 : AARON SOCIAL, suivi des publications par réseau.
-- published = { tiktok: { publish_id, status, started_at, published_at, error } }
alter table public.social_posts add column if not exists published jsonb not null default '{}'::jsonb;
