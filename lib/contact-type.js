// lib/contact-type.js
//
// TYPE DE CONTACT : entreprise ou particulier (demande d'Alex, 18/11/2026 :
// « une nouvelle colonne pour démarquer ce qui est un client professionnel,
// B2B ou B2C »). Jusqu'ici tous les contacts étaient des entreprises, parce
// qu'Aaron ne prospectait que par email auprès de sociétés. Avec les réseaux
// sociaux, un même client peut vendre aux deux, ou à un seul.
//
// Une seule colonne, prospects.client_type, vide par défaut (voir
// migration_type_contact_2026-11-18.sql) :
//   - 'entreprise' ou 'particulier' : choisi à la main, ou posé par Aaron
//     quand la personne le dit elle-même dans la conversation ;
//   - vide : on DÉDUIT le type à l'affichage, sans rien écrire en base. Une
//     société nommée, un SIRET ou une adresse email professionnelle veulent
//     dire « entreprise ». Sinon on ne sait pas, et on l'affiche tel quel
//     (« à préciser ») plutôt que de deviner : classer un particulier comme
//     entreprise fausserait le filtre sans que personne le voie.
//
// La déduction n'est jamais enregistrée : si le commercial complète la
// société plus tard, le type suit tout seul. Seul un choix explicite fige.
//
// Fichier en JS pur, sans dépendance serveur : importé par la fiche contact,
// la liste et la route d'enregistrement.

import { isGenericEmailDomain } from '@/lib/csv-import';

export const CONTACT_TYPES = ['entreprise', 'particulier'];

export function isContactType(value) {
  return CONTACT_TYPES.includes(value);
}

// Type enregistré s'il existe, sinon déduit, sinon null (« à préciser »).
export function contactTypeOf(prospect) {
  if (!prospect) return null;
  if (isContactType(prospect.client_type)) return prospect.client_type;
  const company = prospect.prospect_companies || {};
  if ((company.name || '').trim() || (company.siret || '').trim()) return 'entreprise';
  if (prospect.email && !isGenericEmailDomain(prospect.email)) return 'entreprise';
  return null;
}

// true quand le type vient d'un choix explicite (et non de la déduction).
export function contactTypeIsSet(prospect) {
  return !!prospect && isContactType(prospect.client_type);
}

// Textes gardés ici plutôt que dans lib/i18n.js (1,1 Mo, l'envoi web de
// GitHub bloque dessus), comme components/ContactCard.jsx.
const TEXT = {
  fr: { entreprise: 'Entreprise', particulier: 'Particulier', unknown: 'Type à préciser', entreprises: 'Entreprises', particuliers: 'Particuliers', label: 'Type de client', hint: 'Entreprise ou particulier. Aaron le déduit, tu peux le corriger.', deduced: 'déduit par Aaron', saved: 'Type de client enregistré', migration: 'Le type de client n\'est pas encore activé sur ce compte.', filterCompanies: 'Seulement les entreprises', filterPeople: 'Seulement les particuliers' },
  en: { entreprise: 'Business', particulier: 'Individual', unknown: 'Type to confirm', entreprises: 'Businesses', particuliers: 'Individuals', label: 'Customer type', hint: 'Business or individual. Aaron works it out, you can correct it.', deduced: 'worked out by Aaron', saved: 'Customer type saved', migration: 'Customer type is not enabled on this account yet.', filterCompanies: 'Businesses only', filterPeople: 'Individuals only' },
  de: { entreprise: 'Unternehmen', particulier: 'Privatperson', unknown: 'Typ offen', entreprises: 'Unternehmen', particuliers: 'Privatpersonen', label: 'Kundentyp', hint: 'Unternehmen oder Privatperson. Aaron leitet es ab, du kannst es korrigieren.', deduced: 'von Aaron abgeleitet', saved: 'Kundentyp gespeichert', migration: 'Der Kundentyp ist für dieses Konto noch nicht aktiviert.', filterCompanies: 'Nur Unternehmen', filterPeople: 'Nur Privatpersonen' },
  it: { entreprise: 'Azienda', particulier: 'Privato', unknown: 'Tipo da precisare', entreprises: 'Aziende', particuliers: 'Privati', label: 'Tipo di cliente', hint: 'Azienda o privato. Aaron lo deduce, puoi correggerlo.', deduced: 'dedotto da Aaron', saved: 'Tipo di cliente salvato', migration: 'Il tipo di cliente non è ancora attivo su questo account.', filterCompanies: 'Solo le aziende', filterPeople: 'Solo i privati' },
  es: { entreprise: 'Empresa', particulier: 'Particular', unknown: 'Tipo por precisar', entreprises: 'Empresas', particuliers: 'Particulares', label: 'Tipo de cliente', hint: 'Empresa o particular. Aaron lo deduce, puedes corregirlo.', deduced: 'deducido por Aaron', saved: 'Tipo de cliente guardado', migration: 'El tipo de cliente aún no está activado en esta cuenta.', filterCompanies: 'Solo las empresas', filterPeople: 'Solo los particulares' },
  pt: { entreprise: 'Empresa', particulier: 'Particular', unknown: 'Tipo por definir', entreprises: 'Empresas', particuliers: 'Particulares', label: 'Tipo de cliente', hint: 'Empresa ou particular. O Aaron deduz, podes corrigir.', deduced: 'deduzido pelo Aaron', saved: 'Tipo de cliente guardado', migration: 'O tipo de cliente ainda não está ativo nesta conta.', filterCompanies: 'Só as empresas', filterPeople: 'Só os particulares' },
  nl: { entreprise: 'Bedrijf', particulier: 'Particulier', unknown: 'Type nog onbekend', entreprises: 'Bedrijven', particuliers: 'Particulieren', label: 'Type klant', hint: 'Bedrijf of particulier. Aaron leidt het af, je kunt het aanpassen.', deduced: 'afgeleid door Aaron', saved: 'Type klant opgeslagen', migration: 'Het type klant is nog niet actief voor dit account.', filterCompanies: 'Alleen bedrijven', filterPeople: 'Alleen particulieren' },
};

export function contactTypeText(key, locale) {
  return (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key] || key;
}
