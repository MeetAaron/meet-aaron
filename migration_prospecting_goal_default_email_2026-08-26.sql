-- migration_prospecting_goal_default_email_2026-08-26.sql
--
-- Deux demandes d'Alex (26/08/2026), toutes deux liées au premier email de
-- prospection :
--
--  1. "comment faire pour choisir ce que aaron doit obtenir ? Car là mon but
--     n'est pas d'obtenir un rdv mais un devis." — audit du prompt système
--     (lib/aaron_system_prompt.md) : la mission d'Aaron était jusqu'ici
--     CODÉE EN DUR sur "transformer un contact froid en un rendez-vous
--     qualifié", quelle que soit la réponse donnée à la question
--     d'onboarding "et l'idéal pour toi après un premier contact : obtenir
--     un rendez-vous, envoyer un devis, proposer un essai gratuit ?" (cette
--     réponse n'était utilisée que comme texte libre noyé dans le résumé
--     business, jamais comme un vrai interrupteur de comportement). Ce
--     script ajoute un vrai réglage structuré, lu par lib/aaron.ts et
--     appliqué par le prompt système.
--
--  2. "il serait judicieux d'ajouter un bloc dans mes préférences du genre
--     premier email [...] décider du premier email par défaut (objet + corps),
--     la signature viendra se compléter automatiquement à l'endroit où on
--     l'avait mise" — nouveau réglage permettant à un commercial d'utiliser
--     SON PROPRE email de premier contact (fixe) plutôt que la génération
--     dynamique par Aaron, uniquement pour le tout premier message (les
--     relances/réponses restent toujours dynamiques, car elles doivent
--     réagir à ce que le prospect a réellement écrit).
--
-- À exécuter dans l'éditeur SQL Supabase (aucun accès direct à la base
-- depuis l'agent). Sans risque à rejouer (toutes les colonnes en
-- "if not exists").

alter table companies
  add column if not exists prospecting_goal text not null default 'rdv',
  add column if not exists prospecting_goal_details text,
  add column if not exists default_first_email_enabled boolean not null default false,
  add column if not exists default_first_email_subject text,
  add column if not exists default_first_email_body text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_prospecting_goal_check'
  ) then
    alter table companies
      add constraint companies_prospecting_goal_check
      check (prospecting_goal in ('rdv', 'devis', 'essai_gratuit', 'autre'));
  end if;
end $$;

comment on column companies.prospecting_goal is 'Ce qu''Aaron doit chercher à obtenir en priorité lors d''un premier contact : rdv (par défaut) / devis (demande de devis chiffré directe) / essai_gratuit (inscription/essai du produit) / autre (voir prospecting_goal_details). Lu par lib/aaron.ts, appliqué par lib/aaron_system_prompt.md.';
comment on column companies.prospecting_goal_details is 'Précision libre sur l''objectif choisi (obligatoire en pratique si prospecting_goal = autre, optionnelle sinon) — ex: "un essai gratuit de 14 jours sans CB".';
comment on column companies.default_first_email_enabled is 'Si true, le tout premier email envoyé à un nouveau prospect utilise default_first_email_subject/body tel quel (signature ajoutée automatiquement à l''envoi, comme pour tout email) au lieu d''être rédigé dynamiquement par Aaron. Les relances/réponses restent toujours dynamiques.';
comment on column companies.default_first_email_subject is 'Objet du premier email par défaut, utilisé seulement si default_first_email_enabled = true. Le jeton {prenom} est remplacé par le prénom du prospect si présent.';
comment on column companies.default_first_email_body is 'Corps du premier email par défaut, utilisé seulement si default_first_email_enabled = true. Le jeton {prenom} est remplacé par le prénom du prospect si présent. Ne pas inclure la signature : elle est ajoutée automatiquement à l''envoi (même mécanisme que pour un email rédigé par Aaron).';
