-- migration_fuseau_horaire_rapports_2026-09-12.sql
--
-- RAPPORTS ENVOYÉS À MINUIT — MAIS À MINUIT CHEZ LE COMMERCIAL.
--
-- Demande d'Alex (12/09/2026) : « je suis en Australie, donc le rapport doit
-- être envoyé à minuit une, et ce pour chaque pays selon le fuseau horaire ».
--
-- Jusqu'ici un seul cron Vercel tournait à 00h10 UTC pour toute la base :
-- minuit dix à Paris en hiver, mais huit heures du matin à Perth. Le
-- « rapport d'hier » arrivait après le début de la journée de travail, ce qui
-- lui enlève tout intérêt.
--
--   timezone                  : identifiant IANA (« Australia/Perth »),
--                               relevé dans le navigateur du commercial. Un
--                               pays ne suffit pas — l'Australie compte à
--                               elle seule trois fuseaux et une heure d'été
--                               partielle.
--   last_results_report_date  : date LOCALE du dernier rapport envoyé. Le
--                               cron passe désormais toutes les heures ;
--                               sans cette garde, un changement d'heure ou
--                               un rejeu du cron enverrait deux rapports le
--                               même jour.

alter table public.users
  add column if not exists timezone text,
  add column if not exists last_results_report_date date;

comment on column public.users.timezone is
  'Fuseau IANA du commercial (ex. Australia/Perth), relevé par le navigateur. Sert à envoyer les rapports à minuit heure locale. NULL = repli sur le pays de facturation, puis Europe/Paris.';

comment on column public.users.last_results_report_date is
  'Date locale du dernier rapport de résultats envoyé — empêche tout doublon, le cron passant toutes les heures.';
