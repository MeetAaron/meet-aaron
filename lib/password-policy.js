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
