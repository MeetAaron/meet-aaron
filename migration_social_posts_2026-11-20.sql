-- migration_social_posts_2026-11-20.sql
-- Aaron Social : une campagne = 4 semaines = 16 posts préparés par Aaron.
-- Lecture et écriture par le serveur seulement (sécurité par ligne activée,
-- aucune règle).

create table if not exists social_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  status text not null default 'preparation'
    check (status in ('preparation', 'prete', 'en_cours', 'terminee', 'erreur')),
  locale text not null default 'fr',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_campaigns_company_idx on social_campaigns (company_id, created_at desc);

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references social_campaigns(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  week smallint not null check (week between 1 and 4),
  slot smallint not null check (slot between 1 and 4),
  category text not null check (category in ('realisation', 'avis', 'conseil', 'coulisses')),
  subject text not null,
  material_needed text not null default 'none' check (material_needed in ('none', 'photo', 'avis')),
  material_hint text,
  content jsonb not null,
  status text not null default 'brouillon' check (status in ('brouillon', 'pret', 'publie', 'retire')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, week, slot)
);

alter table social_campaigns enable row level security;
alter table social_posts enable row level security;

select table_name, count(*) as colonnes from information_schema.columns
where table_name in ('social_campaigns', 'social_posts') group by table_name;
