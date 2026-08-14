-- migration_products_devis_2026-08-14.sql
-- Ajoute un vrai catalogue produits/tarifs par société (jusqu'ici Aaron
-- rédigeait un devis SANS prix, volontairement — voir lib/aaron-sales.ts
-- generateDevis). Avec cette migration, si le commercial a rempli son
-- catalogue, Aaron peut chiffrer directement les postes qu'il reconnaît,
-- en s'appuyant sur de VRAIS prix (jamais inventés) — les postes non
-- reconnus dans le catalogue restent sans prix comme avant.
--
-- Ajoute aussi un historique structuré des devis (table `quotes` +
-- `quote_line_items`), en plus des champs `prospects.devis_*` existants
-- (conservés pour ne rien casser côté UI) — nécessaire pour qu'Aaron
-- puisse s'appuyer sur "les devis déjà envoyés à ce client" et prépare
-- un futur export Excel/PDF (colonnes storage_path prévues, vides pour
-- l'instant — en attente du modèle Excel fourni par l'entreprise).

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  reference text,
  name text not null,
  description text,
  category text,
  unit text not null default 'unité',
  unit_price_eur numeric(10,2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_company_id_idx on products(company_id);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete set null,
  status text not null default 'brouillon', -- brouillon | envoye
  total_eur numeric(10,2),
  has_unpriced_items boolean not null default false,
  excel_storage_path text,
  pdf_storage_path text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists quotes_prospect_id_idx on quotes(prospect_id);
create index if not exists quotes_company_id_idx on quotes(company_id);

create table if not exists quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  label text not null,
  quantity numeric(10,2) not null default 1,
  unit_price_eur numeric(10,2),
  line_total_eur numeric(10,2),
  is_external boolean not null default false,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists quote_line_items_quote_id_idx on quote_line_items(quote_id);

-- Emplacement (Supabase Storage) d'un modèle Excel de devis fourni par la
-- société, pour la génération Excel/PDF à venir — vide pour l'instant.
alter table companies add column if not exists devis_template_storage_path text;

-- Interrupteur (désactivé par défaut) pour la recherche de tarifs/prestations
-- hors catalogue (ex: trouver un artiste/prestataire externe sur internet
-- quand rien ne correspond en base) — fonctionnalité à venir, prévue dans le
-- schéma dès maintenant pour ne pas avoir à re-migrer plus tard.
alter table companies add column if not exists devis_external_search_enabled boolean not null default false;
