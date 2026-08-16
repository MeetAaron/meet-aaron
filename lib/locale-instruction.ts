// lib/locale-instruction.ts
// Traduction du contenu généré dynamiquement par Aaron (conseils, emails,
// chat, devis) dans la langue choisie par le commercial.
//
// Fichier volontairement indépendant de lib/i18n.js (dictionnaire de
// traduction de l'interface, ~899 clés, uniquement côté client) : ici on a
// juste besoin de dire à Claude "écris ta réponse dans telle langue", pas de
// traduire des libellés d'UI. Aucune route serveur n'importe lib/i18n.js
// aujourd'hui — on garde cette séparation.
//
// ⚠️ À garder synchronisé manuellement avec LOCALES dans lib/i18n.js si la
// liste des langues supportées change (même risque de désynchronisation
// déjà documenté ailleurs dans ce projet, ex. les 899 clés vs 7 langues).

export const LOCALE_NAMES: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  de: 'allemand',
  it: 'italien',
  es: 'espagnol',
  pt: 'portugais',
  nl: 'néerlandais',
};

const DEFAULT_LOCALE = 'fr';

// Ramène toute valeur de locale (colonne users.locale, éventuellement absente
// ou inconnue) à une langue supportée — jamais de "undefined" envoyé à Claude.
export function normalizeLocale(locale: string | null | undefined): string {
  return locale && LOCALE_NAMES[locale] ? locale : DEFAULT_LOCALE;
}

// Instruction courte à insérer dans un prompt système/utilisateur, ex. :
// `Rédige ta réponse ${localeInstruction(authedUser.locale)}.`
export function localeInstruction(locale: string | null | undefined): string {
  const loc = normalizeLocale(locale);
  return `en ${LOCALE_NAMES[loc]}`;
}
