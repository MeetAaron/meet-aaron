-- migration_traductions_2026-11-07.sql
--
-- Cache des traductions à la demande (lib/translate.ts, /api/translate).
-- Demande Alex (07/11/2026) : tout ce qu'Aaron écrit (avis, conseils,
-- résumés) et tout ce que les prospects écrivent doit pouvoir s'afficher
-- dans la langue de l'interface, avec « Afficher l'original ».
--
-- Rien n'est réécrit en base : les textes restent dans leur langue
-- d'origine ; cette table mémorise seulement leur traduction par langue
-- cible, pour ne payer Haiku qu'une fois par texte.
--
-- Clé : empreinte SHA-256 du texte source + langue cible. company_id est
-- informatif (qui a déclenché la première traduction) ; une traduction est
-- réutilisable par toutes les sociétés puisqu'elle ne dépend que du texte.

create table if not exists public.text_translations (
  source_hash   text not null,
  target_locale text not null check (target_locale in ('fr','en','de','it','es','pt','nl')),
  source_locale text not null default 'xx',
  translated    text,            -- null = le texte était déjà dans la langue cible
  company_id    uuid references public.companies(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (source_hash, target_locale)
);

comment on table public.text_translations is
  'Cache des traductions à la demande des textes affichés (avis d''Aaron, messages des prospects…). Clé = empreinte du texte + langue cible. translated null = déjà dans la langue cible.';

-- Vérification : la table existe et est vide.
select count(*) as traductions_en_cache from public.text_translations;
