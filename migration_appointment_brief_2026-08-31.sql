-- migration_appointment_brief_2026-08-31.sql
-- Brief post-RDV enrichi (docx Modifs Aaron 30/08/2026, items 3 et 7) :
-- en plus de l'issue (outcome) déjà enregistrée, le commercial indique
-- comment ça s'est passé (bien / moyen / mal), ajoute du contexte (chips ou
-- texte libre : "points communs sur les abeilles", "je lui envoie le devis
-- dans la journée"...), et Aaron peut envoyer un email de remerciement au
-- prospect depuis la boîte du commercial. Voir lib/appointment-outcome.ts et
-- app/app/agenda/rdv/[id]/bilan/page.jsx.
-- Sans cette migration, le bilan continue de fonctionner (issue + note),
-- seuls le ressenti et le contexte ne sont pas mémorisés.

alter table appointments add column if not exists outcome_mood text;        -- 'bien' | 'moyen' | 'mal'
alter table appointments add column if not exists outcome_context text;     -- contexte libre donné par le commercial
alter table appointments add column if not exists thank_you_sent_at timestamptz; -- email de remerciement envoyé par Aaron
