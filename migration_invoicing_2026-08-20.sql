-- migration_invoicing_2026-08-20.sql
-- Tâche #141, sous-item 2 (détection des retards de paiement client).
-- Alex a choisi l'option "vraies factures conformes" plutôt qu'un simple
-- suivi interne : Meet Aaron peut désormais émettre de vraies factures pour
-- les entrepreneurs qui n'ont pas d'outil de facturation (ou dont le CRM
-- connecté n'en a pas — Salesforce/Pipedrive/Capsule CRM), avec les mentions
-- obligatoires courantes en France (numérotation séquentielle sans trou,
-- identification vendeur/acheteur, mention pénalités de retard).
-- Important : couvre les mentions légales standard françaises en B2B, pas
-- une garantie de conformité pour tous pays/statuts — à faire valider par
-- l'expert-comptable d'Alex avant un usage à grande échelle, comme déjà
-- recommandé pour la recherche sur la facturation électronique (tâche #133).

-- Informations légales de l'entreprise émettrice (nécessaires pour l'en-tête
-- "vendeur" de la facture). Toutes nullable : si non renseignées, la facture
-- reste générable mais avec ces champs vides (affichage "à compléter").
alter table companies
  add column if not exists siret text,
  add column if not exists legal_address text,
  add column if not exists legal_form text,
  add column if not exists vat_number text,
  add column if not exists vat_exempt_mention text,
  add column if not exists invoice_next_number integer not null default 1;

comment on column companies.siret is 'SIRET de l''entreprise, affiché sur les factures émises depuis Meet Aaron.';
comment on column companies.legal_address is 'Adresse légale de l''entreprise, affichée sur les factures émises depuis Meet Aaron.';
comment on column companies.legal_form is 'Forme juridique + capital social le cas échéant (ex. "SASU au capital de 1000 €"), affiché sur les factures.';
comment on column companies.vat_number is 'Numéro de TVA intracommunautaire. NULL si non assujetti (voir vat_exempt_mention).';
comment on column companies.vat_exempt_mention is 'Mention d''exonération de TVA à afficher à la place du taux (ex. "TVA non applicable, art. 293 B du CGI" pour une franchise en base). NULL si TVA normalement applicable.';
comment on column companies.invoice_next_number is 'Compteur du prochain numéro de facture à attribuer pour cette entreprise (jamais réutilisé, y compris en cas d''annulation, pour respecter la numérotation séquentielle sans trou).';

create table if not exists client_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'emise' check (status in ('emise', 'payee', 'en_retard', 'annulee')),
  line_items jsonb not null default '[]'::jsonb,
  total_ht_eur numeric,
  vat_rate numeric,
  total_ttc_eur numeric,
  payment_terms text,
  buyer_name text,
  buyer_company text,
  buyer_address text,
  -- 'interne' = facture générée par Meet Aaron. Les autres valeurs sont
  -- réservées pour une future lecture des factures déjà existantes dans un
  -- CRM avec module de facturation natif (Jobber, Housecall Pro, ServiceM8,
  -- Axonaut, Sellsy) — non construite dans ce lot, voir statut du projet.
  source text not null default 'interne' check (source in ('interne', 'crm_jobber', 'crm_housecall_pro', 'crm_axonaut', 'crm_sellsy', 'crm_servicem8')),
  external_id text,
  paid_at timestamptz,
  late_notified_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);

comment on table client_invoices is 'Factures émises par un commercial (via Meet Aaron) à un client gagné (prospects.is_won). Numérotation séquentielle par entreprise via companies.invoice_next_number. Tâche #141 sous-item 2.';
comment on column client_invoices.line_items is 'Tableau JSON des lignes de facture : [{designation, description, quantite, prix_unitaire_ht_eur, total_ligne_ht_eur}]. Peut être pré-rempli depuis prospects.devis_recap (devis déjà accepté).';
comment on column client_invoices.status is 'emise = en attente de paiement. payee = réglée. en_retard = échéance dépassée sans paiement, détecté par app/api/cron/invoice-late-payments. annulee = facture annulée (jamais renumérotée, le numéro reste consommé).';

create index if not exists idx_client_invoices_company on client_invoices(company_id);
create index if not exists idx_client_invoices_prospect on client_invoices(prospect_id);
create index if not exists idx_client_invoices_late_check on client_invoices(status, due_date) where status = 'emise';
