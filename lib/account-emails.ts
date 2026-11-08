// lib/account-emails.ts
// Les trois emails de compte (confirmation d'adresse, nouveau lien,
// réinitialisation du mot de passe) dans les 7 langues de l'interface.
//
// Remarque d'Alex (08/11/2026) : « J'avais mon site en anglais et j'ai créé
// le compte. Pourtant l'email de confirmation était en français. » Ces
// textes étaient en dur en français, et le nom d'expéditeur retombait sur le
// français faute de ligne users au moment de l'inscription. La page
// d'inscription envoie désormais sa langue (`locale`), et sendSystemEmail la
// reçoit pour le nom d'expéditeur.

import { normalizeLocale } from './locale-instruction';

type AccountEmail = { subject: string; body: string };

const VERIFY: Record<string, { subject: string; intro: string; again: string; action: string; ignore: string }> = {
  fr: { subject: 'Confirmez votre adresse email — Meet Aaron', intro: 'Bienvenue sur Meet Aaron !', again: 'Voici un nouveau lien pour confirmer votre adresse email et activer votre compte Meet Aaron :', action: 'Pour confirmer votre adresse email et activer votre compte, cliquez sur ce lien :', ignore: "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet email." },
  en: { subject: 'Confirm your email address — Meet Aaron', intro: 'Welcome to Meet Aaron!', again: 'Here is a new link to confirm your email address and activate your Meet Aaron account:', action: 'To confirm your email address and activate your account, click this link:', ignore: 'If you did not sign up, simply ignore this email.' },
  de: { subject: 'Bestätigen Sie Ihre E-Mail-Adresse — Meet Aaron', intro: 'Willkommen bei Meet Aaron!', again: 'Hier ist ein neuer Link, um Ihre E-Mail-Adresse zu bestätigen und Ihr Meet-Aaron-Konto zu aktivieren:', action: 'Um Ihre E-Mail-Adresse zu bestätigen und Ihr Konto zu aktivieren, klicken Sie auf diesen Link:', ignore: 'Falls Sie sich nicht registriert haben, ignorieren Sie diese E-Mail einfach.' },
  it: { subject: 'Conferma il tuo indirizzo email — Meet Aaron', intro: 'Benvenuto su Meet Aaron!', again: 'Ecco un nuovo link per confermare il tuo indirizzo email e attivare il tuo account Meet Aaron:', action: 'Per confermare il tuo indirizzo email e attivare il tuo account, clicca su questo link:', ignore: 'Se non sei tu ad aver effettuato questa iscrizione, ignora semplicemente questa email.' },
  es: { subject: 'Confirma tu dirección de correo — Meet Aaron', intro: '¡Bienvenido a Meet Aaron!', again: 'Aquí tienes un nuevo enlace para confirmar tu dirección de correo y activar tu cuenta Meet Aaron:', action: 'Para confirmar tu dirección de correo y activar tu cuenta, haz clic en este enlace:', ignore: 'Si no has sido tú, ignora simplemente este correo.' },
  pt: { subject: 'Confirme o seu endereço de email — Meet Aaron', intro: 'Bem-vindo ao Meet Aaron!', again: 'Aqui está um novo link para confirmar o seu endereço de email e ativar a sua conta Meet Aaron:', action: 'Para confirmar o seu endereço de email e ativar a sua conta, clique neste link:', ignore: 'Se não foi você a inscrever-se, ignore simplesmente este email.' },
  nl: { subject: 'Bevestig je e-mailadres — Meet Aaron', intro: 'Welkom bij Meet Aaron!', again: 'Hier is een nieuwe link om je e-mailadres te bevestigen en je Meet Aaron-account te activeren:', action: 'Klik op deze link om je e-mailadres te bevestigen en je account te activeren:', ignore: 'Heb je je niet aangemeld? Negeer deze e-mail dan gewoon.' },
};

const RESET: Record<string, { subject: string; hello: string; body: string; ignore: string; sign: string }> = {
  fr: { subject: 'Réinitialise ton mot de passe Meet Aaron', hello: 'Bonjour{name},', body: 'Tu as demandé à réinitialiser le mot de passe de ton compte Meet Aaron. Clique sur ce lien (valable 1 heure) pour en choisir un nouveau :', ignore: "Si tu n'es pas à l'origine de cette demande, ignore simplement cet email : ton mot de passe reste inchangé.", sign: 'Aaron' },
  en: { subject: 'Reset your Meet Aaron password', hello: 'Hello{name},', body: 'You asked to reset the password of your Meet Aaron account. Click this link (valid for 1 hour) to choose a new one:', ignore: 'If you did not make this request, simply ignore this email: your password stays unchanged.', sign: 'Aaron' },
  de: { subject: 'Setze dein Meet-Aaron-Passwort zurück', hello: 'Hallo{name},', body: 'Du hast darum gebeten, das Passwort deines Meet-Aaron-Kontos zurückzusetzen. Klicke auf diesen Link (1 Stunde gültig), um ein neues zu wählen:', ignore: 'Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail einfach: dein Passwort bleibt unverändert.', sign: 'Aaron' },
  it: { subject: 'Reimposta la tua password Meet Aaron', hello: 'Ciao{name},', body: 'Hai chiesto di reimpostare la password del tuo account Meet Aaron. Clicca su questo link (valido 1 ora) per sceglierne una nuova:', ignore: 'Se non sei stato tu, ignora semplicemente questa email: la tua password resta invariata.', sign: 'Aaron' },
  es: { subject: 'Restablece tu contraseña de Meet Aaron', hello: 'Hola{name},', body: 'Has pedido restablecer la contraseña de tu cuenta Meet Aaron. Haz clic en este enlace (válido 1 hora) para elegir una nueva:', ignore: 'Si no has sido tú, ignora simplemente este correo: tu contraseña no cambia.', sign: 'Aaron' },
  pt: { subject: 'Repõe a tua palavra-passe Meet Aaron', hello: 'Olá{name},', body: 'Pediste para repor a palavra-passe da tua conta Meet Aaron. Clica neste link (válido 1 hora) para escolher uma nova:', ignore: 'Se não foste tu, ignora simplesmente este email: a tua palavra-passe mantém-se.', sign: 'Aaron' },
  nl: { subject: 'Stel je Meet Aaron-wachtwoord opnieuw in', hello: 'Hallo{name},', body: 'Je hebt gevraagd om het wachtwoord van je Meet Aaron-account opnieuw in te stellen. Klik op deze link (1 uur geldig) om een nieuw wachtwoord te kiezen:', ignore: 'Heb je dit niet aangevraagd? Negeer deze e-mail dan gewoon: je wachtwoord blijft ongewijzigd.', sign: 'Aaron' },
};

export function verificationEmail(locale: string | null | undefined, verifyUrl: string, again = false): AccountEmail {
  const T = VERIFY[normalizeLocale(locale)] || VERIFY.fr;
  const body = again
    ? `${T.again}\n${verifyUrl}\n\n${T.ignore}`
    : `${T.intro}\n\n${T.action}\n${verifyUrl}\n\n${T.ignore}`;
  return { subject: T.subject, body };
}

export function passwordResetEmail(locale: string | null | undefined, link: string, firstName?: string | null): AccountEmail {
  const T = RESET[normalizeLocale(locale)] || RESET.fr;
  const body = `${T.hello.replace('{name}', firstName ? ` ${firstName}` : '')}\n\n${T.body}\n\n${link}\n\n${T.ignore}\n\n${T.sign}`;
  return { subject: T.subject, body };
}
