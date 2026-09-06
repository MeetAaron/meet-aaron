-- migration_directory_companies_2026-09-06.sql
--
-- ANNUAIRE D'ENTREPRISES LIBRE DE DROITS (décision Alex, 06/09/2026).
--
-- Pourquoi cette table existe : Google Places donne bien le site web et le
-- téléphone, mais ses conditions d'utilisation (Google Maps Platform Terms
-- §3.2.3 b, « No Caching ») n'autorisent à conserver QUE le place_id et, 30
-- jours, les coordonnées. Le nom, l'adresse, le téléphone et le site web n'ont
-- aucune exception : les écrire dans prospect_companies nous mettait en
-- infraction. Places est donc désactivé (voir lib/sourcing.ts).
--
-- Cette table le remplace par des sources dont la licence autorise
-- EXPLICITEMENT le stockage et l'usage commercial :
--   - Overture Maps Places  (CDLA Permissive 2.0 / Apache 2.0, sans partage
--     à l'identique) — 74 M d'établissements avec site web, téléphone, email.
--   - Foursquare OS Places  (Apache 2.0).
--   - Les registres officiels déjà branchés (SIRENE, Companies House, ABN).
--
-- Elle est GLOBALE, pas cloisonnée par société cliente : un établissement
-- trouvé pour un client sert à tous, comme company_research_cache. Elle ne
-- contient que des faits publics d'entreprise — jamais de contact nominatif,
-- jamais d'échange. Les prospects réels restent dans prospect_companies /
-- prospects, cloisonnés par company_id.
--
-- Lecture/écriture par service_role uniquement (les crons), donc pas de RLS.

create table if not exists public.directory_companies (
  id uuid primary key default gen_random_uuid(),

  -- Identité
  name text not null,
  domain text,                    -- normalisé, sans www.
  website text,
  phone text,
  email text,                     -- email GÉNÉRIQUE d'entreprise uniquement (contact@, info@)

  -- Localisation
  country char(2) not null,       -- FR, GB, BE, AU, CA, NL, DE, ES, PT, IT, AT, US
  city text,
  postcode text,
  address text,
  latitude double precision,
  longitude double precision,

  -- Activité
  category text,                  -- catégorie de la source (ex. « plumber »)
  category_raw text,              -- libellé brut, utile pour affiner les requêtes
  registry_id text,               -- SIREN/SIRET, company number, ABN… si connu

  -- Traçabilité : indispensable pour prouver d'où vient chaque ligne le jour
  -- où un client ou la CNIL le demande.
  source text not null,           -- overture | foursquare | sirene | companies_house | abn
  source_license text not null,   -- CDLA-Permissive-2.0 | Apache-2.0 | LO/OL | OGL
  source_id text,                 -- identifiant chez la source (GERS id Overture…)
  confidence real,                -- score 0..1 quand la source en fournit un

  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un même établissement ne doit pas entrer deux fois. Le domaine est la clé
-- métier (c'est lui qui permet d'écrire) ; quand il manque, on retombe sur
-- l'identifiant de la source.
create unique index if not exists directory_companies_domain_uidx
  on public.directory_companies (domain)
  where domain is not null;

create unique index if not exists directory_companies_source_uidx
  on public.directory_companies (source, source_id)
  where source_id is not null;

-- Requête de sourcing type : « plombiers en Île-de-France ayant un site web ».
create index if not exists directory_companies_lookup_idx
  on public.directory_companies (country, category)
  where domain is not null;

create index if not exists directory_companies_city_idx
  on public.directory_companies (country, city);

-- Recherche plein texte sur le nom et la catégorie brute, pour les zones que
-- le couple pays/ville ne décrit pas bien (« Bavière », « Californie »).
create index if not exists directory_companies_name_trgm_idx
  on public.directory_companies using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(category_raw, '')));

comment on table public.directory_companies is
  'Annuaire d''établissements sous licence permissive (Overture, Foursquare, registres publics). Faits publics d''entreprise uniquement, aucune donnée personnelle. Partagé entre tous les comptes.';
comment on column public.directory_companies.source_license is
  'Licence de la source — conservée pour prouver le droit de stockage de chaque ligne.';
