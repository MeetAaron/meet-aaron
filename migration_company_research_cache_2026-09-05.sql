-- migration_company_research_cache_2026-09-05.sql
--
-- Cache PARTAGÉ des recherches de sociétés (plan de réduction des coûts
-- validé par Alex le 05/09/2026, « premier levier »).
--
-- prospect_companies est cloisonnée par société cliente (company_id) : la
-- même plomberie démarchée par deux clients de Meet Aaron était recherchée
-- deux fois sur le web. Cette table est globale, indexée par domaine : une
-- société = une recherche, valable 90 jours, pour tout le monde. Elle ne
-- contient AUCUNE donnée personnelle (pas de contact, pas d'échange) —
-- uniquement des faits publics sur l'entreprise. Lue/écrite par
-- lib/prospect-research.ts (service_role uniquement, pas de RLS nécessaire).

create table if not exists public.company_research_cache (
  domain text primary key,
  summary text,
  website text,
  siret text,
  address text,
  industry text,
  checked_at timestamptz not null default now()
);

comment on table public.company_research_cache is
  'Résumé métier + état civil d''entreprise par domaine, partagé entre tous les comptes (90 jours). Aucune donnée personnelle.';

create index if not exists company_research_cache_checked_idx
  on public.company_research_cache (checked_at);
