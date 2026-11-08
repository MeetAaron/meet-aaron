// lib/password-policy.js
// POLITIQUE DE MOT DE PASSE (CASA 1.1.1, 23/10/2026) — une seule source de
// vérité pour l'inscription, la réinitialisation et le changement de mot de
// passe (navigateur ET serveur).
//
//   - 10 caractères minimum, 128 maximum ;
//   - au moins une minuscule, une majuscule et un chiffre ;
//   - pas d'espace en début ou en fin (souvent une erreur de copier-coller).
//
// La même règle est imposée côté Supabase Auth (Authentication > Sign In /
// Providers > Email : « Minimum password length » = 10 et « Password
// requirements » = lowercase, uppercase letters and digits), si bien qu'un
// appel direct à l'API d'authentification, qui ne passe pas par ce fichier,
// est refusé de la même façon. Les mots de passe ne sont jamais stockés ni
// journalisés par l'application : Supabase Auth les hache (bcrypt).
//
// Ce fichier n'importe rien : utilisable tel quel par les pages client et par
// les routes API.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// null si le mot de passe respecte la politique, sinon le motif du refus.
export function passwordPolicyError(password) {
  if (typeof password !== 'string') return 'length';
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return 'length';
  if (password !== password.trim()) return 'spaces';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return 'classes';
  return null;
}

const POLICY_TEXT = {
  fr: 'Mot de passe : 10 caractères minimum, dont une minuscule, une majuscule et un chiffre, sans espace au début ni à la fin.',
  en: 'Password: at least 10 characters, including a lowercase letter, an uppercase letter and a digit, with no leading or trailing space.',
  de: 'Passwort: mindestens 10 Zeichen, darunter ein Klein- und ein Großbuchstabe sowie eine Ziffer, ohne Leerzeichen am Anfang oder Ende.',
  it: 'Password: almeno 10 caratteri, con una lettera minuscola, una maiuscola e una cifra, senza spazi all\'inizio o alla fine.',
  es: 'Contraseña: 10 caracteres como mínimo, con una minúscula, una mayúscula y un número, sin espacios al principio ni al final.',
  pt: 'Palavra-passe: pelo menos 10 caracteres, com uma minúscula, uma maiúscula e um algarismo, sem espaços no início nem no fim.',
  nl: 'Wachtwoord: minimaal 10 tekens, met een kleine letter, een hoofdletter en een cijfer, zonder spatie aan het begin of eind.',
};

export function passwordPolicyMessage(locale) {
  return POLICY_TEXT[locale] || POLICY_TEXT.fr;
}

// Règles affichées PENDANT la saisie (demande Alex, 08/11/2026 : « inclure ça
// pendant qu'on écrit le mot de passe, comme ça on ne fait pas d'erreur » ;
// le rouge n'apparaît qu'après une tentative refusée). Même source de vérité
// que passwordPolicyError ci-dessus.
export function passwordChecks(password) {
  const p = typeof password === 'string' ? password : '';
  return {
    length: p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH,
    lower: /[a-z]/.test(p),
    upper: /[A-Z]/.test(p),
    digit: /[0-9]/.test(p),
    spaces: p === p.trim(),
  };
}

const RULE_TEXT = {
  fr: { length: '10 caractères minimum', lower: 'une minuscule', upper: 'une majuscule', digit: 'un chiffre', spaces: "pas d'espace au début ni à la fin", match: 'les deux mots de passe sont identiques' },
  en: { length: 'at least 10 characters', lower: 'a lowercase letter', upper: 'an uppercase letter', digit: 'a digit', spaces: 'no leading or trailing space', match: 'both passwords match' },
  de: { length: 'mindestens 10 Zeichen', lower: 'ein Kleinbuchstabe', upper: 'ein Großbuchstabe', digit: 'eine Ziffer', spaces: 'kein Leerzeichen am Anfang oder Ende', match: 'beide Passwörter stimmen überein' },
  it: { length: 'almeno 10 caratteri', lower: 'una lettera minuscola', upper: 'una lettera maiuscola', digit: 'una cifra', spaces: "nessuno spazio all'inizio o alla fine", match: 'le due password coincidono' },
  es: { length: '10 caracteres como mínimo', lower: 'una minúscula', upper: 'una mayúscula', digit: 'un número', spaces: 'sin espacios al principio ni al final', match: 'las dos contraseñas coinciden' },
  pt: { length: 'pelo menos 10 caracteres', lower: 'uma minúscula', upper: 'uma maiúscula', digit: 'um algarismo', spaces: 'sem espaços no início nem no fim', match: 'as duas palavras-passe coincidem' },
  nl: { length: 'minimaal 10 tekens', lower: 'een kleine letter', upper: 'een hoofdletter', digit: 'een cijfer', spaces: 'geen spatie aan het begin of eind', match: 'beide wachtwoorden zijn gelijk' },
};

export function passwordRuleLabels(locale) {
  return RULE_TEXT[locale] || RULE_TEXT.fr;
}
