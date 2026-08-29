-- migration_business_summary_versions_2026-08-29.sql
-- Demande Alex (29/08/2026) : "ce serait bien d'avoir un historique des 5
-- derniers profils avec leur date de modification. Car si jamais
-- l'utilisateur fait une gaffe et clique sur 'relancer le questionnaire'
-- que ça n'efface pas tout. Et à côté des docs il y a un bouton pour choisir
-- le profil qui sera utilisé."
--
-- Remplace le filet de sécurité à un seul emplacement mis en place plus tôt
-- dans la journée (companies.business_summary_backup /
-- business_summary_backup_at, voir migration_business_summary_backup_2026-08-29.sql)
-- par un véritable historique des 5 dernières versions. Les anciennes
-- colonnes ne sont pas supprimées (pas de perte de données) mais ne sont
-- plus utilisées par le code applicatif après cette migration — voir
-- lib/business-summary-store.ts.

create table if not exists business_summary_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_business_summary_versions_company_created
  on business_summary_versions (company_id, created_at desc);

comment on table business_summary_versions is 'Historique des profils d''entreprise (companies.business_summary) précédents — les 5 plus récents sont conservés par société, purgés automatiquement par le code applicatif à chaque nouvel enregistrement. Voir lib/business-summary-store.ts.';

-- Reprend la sauvegarde à un seul emplacement déjà en place (si elle
-- contient quelque chose) pour ne perdre aucune donnée lors de la bascule
-- vers le nouveau système.
insert into business_summary_versions (company_id, summary, created_at)
select id, business_summary_backup, coalesce(business_summary_backup_at, now())
from companies
where business_summary_backup is not null and business_summary_backup <> '';
