-- migration_document_langue_2026-09-13.sql
--
-- LA BONNE PLAQUETTE POUR LE BON PAYS.
--
-- Demande d'Alex (13/09/2026) : « il me faut la possibilité de mettre cette
-- plaquette dans mes documents et qu'Aaron sélectionne la bonne selon le pays
-- où j'envoie l'email ».
--
-- Une seule colonne suffit. La langue est DEVINÉE au dépôt à partir du texte
-- déjà extrait du document (lib/document-language.ts) : le commercial n'a
-- rien à saisir, il voit une étiquette à côté du fichier et la corrige d'un
-- clic si elle est fausse.
--
-- Valeurs :
--   'fr' 'en' 'de' 'it' 'es' 'pt' 'nl' — une langue précise
--   'all'   — document valable partout (grille tarifaire, plaquette en
--             images, certificat) : toujours éligible quelle que soit la
--             langue du prospect
--   NULL    — langue indéterminée : sert de repli de dernier recours
--
-- Aaron choisit dans cet ordre : la langue du prospect, puis 'all', puis le
-- français, puis le plus récent. Et l'exclusivité « un seul document joint »
-- devient « un seul PAR LANGUE » — sinon marquer la plaquette anglaise
-- démarquerait la française, ce qui rendrait la fonctionnalité impossible.

alter table public.company_documents
  add column if not exists language text;

comment on column public.company_documents.language is
  'Langue du document : fr/en/de/it/es/pt/nl, ''all'' pour un document valable dans toutes les langues, NULL si indéterminée. Devinée au dépôt, corrigeable depuis Mes documents. Décide quelle plaquette Aaron joint au premier email.';

-- Index : la sélection de la pièce jointe filtre sur (company_id,
-- attach_to_first_email) puis trie par langue. Quelques documents par
-- société aujourd'hui, mais la requête part sur chaque premier email.
create index if not exists company_documents_attach_lang_idx
  on public.company_documents (company_id, attach_to_first_email, language);

-- Les documents déjà déposés gardent language = NULL. Rien ne change pour
-- eux : ils restent éligibles en repli. Le commercial peut étiqueter sa
-- plaquette existante en 'fr' depuis Mes documents quand il le souhaite.
