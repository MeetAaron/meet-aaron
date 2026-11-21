-- 21/11/2026 : AARON SOCIAL, matière fournie par le client.
-- Photos (rangées dans le stockage « social-media », servies par
-- meetaaron.app pour que TikTok puisse les tirer d'un domaine vérifié) et
-- avis client recopié, par post.
alter table public.social_posts add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.social_posts add column if not exists review_text text;

insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', false)
on conflict (id) do nothing;
