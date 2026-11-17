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

const RESET: Record<string, { subject: string; hello: string; body: string; code: string; ignore: string; sign: string }> = {
  fr: { subject: 'Réinitialise ton mot de passe Meet Aaron', hello: 'Bonjour{name},', body: 'Tu as demandé à réinitialiser le mot de passe de ton compte Meet Aaron. Clique sur ce lien (valable 1 heure) pour en choisir un nouveau :', code: "Ou, dans l'application, saisis ce code (valable 1 heure) :", ignore: "Si tu n'es pas à l'origine de cette demande, ignore simplement cet email : ton mot de passe reste inchangé.", sign: 'Aaron' },
  en: { subject: 'Reset your Meet Aaron password', hello: 'Hello{name},', body: 'You asked to reset the password of your Meet Aaron account. Click this link (valid for 1 hour) to choose a new one:', code: "Or, in the app, enter this code (valid for 1 hour):", ignore: 'If you did not make this request, simply ignore this email: your password stays unchanged.', sign: 'Aaron' },
  de: { subject: 'Setze dein Meet-Aaron-Passwort zurück', hello: 'Hallo{name},', body: 'Du hast darum gebeten, das Passwort deines Meet-Aaron-Kontos zurückzusetzen. Klicke auf diesen Link (1 Stunde gültig), um ein neues zu wählen:', code: "Oder gib in der App diesen Code ein (1 Stunde gültig):", ignore: 'Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail einfach: dein Passwort bleibt unverändert.', sign: 'Aaron' },
  it: { subject: 'Reimposta la tua password Meet Aaron', hello: 'Ciao{name},', body: 'Hai chiesto di reimpostare la password del tuo account Meet Aaron. Clicca su questo link (valido 1 ora) per sceglierne una nuova:', code: "Oppure, nell'app, inserisci questo codice (valido 1 ora):", ignore: 'Se non sei stato tu, ignora semplicemente questa email: la tua password resta invariata.', sign: 'Aaron' },
  es: { subject: 'Restablece tu contraseña de Meet Aaron', hello: 'Hola{name},', body: 'Has pedido restablecer la contraseña de tu cuenta Meet Aaron. Haz clic en este enlace (válido 1 hora) para elegir una nueva:', code: "O, en la aplicación, introduce este código (válido 1 hora):", ignore: 'Si no has sido tú, ignora simplemente este correo: tu contraseña no cambia.', sign: 'Aaron' },
  pt: { subject: 'Repõe a tua palavra-passe Meet Aaron', hello: 'Olá{name},', body: 'Pediste para repor a palavra-passe da tua conta Meet Aaron. Clica neste link (válido 1 hora) para escolher uma nova:', code: "Ou, na aplicação, introduz este código (válido 1 hora):", ignore: 'Se não foste tu, ignora simplesmente este email: a tua palavra-passe mantém-se.', sign: 'Aaron' },
  nl: { subject: 'Stel je Meet Aaron-wachtwoord opnieuw in', hello: 'Hallo{name},', body: 'Je hebt gevraagd om het wachtwoord van je Meet Aaron-account opnieuw in te stellen. Klik op deze link (1 uur geldig) om een nieuw wachtwoord te kiezen:', code: "Of voer in de app deze code in (1 uur geldig):", ignore: 'Heb je dit niet aangevraagd? Negeer deze e-mail dan gewoon: je wachtwoord blijft ongewijzigd.', sign: 'Aaron' },
};

export function verificationEmail(locale: string | null | undefined, verifyUrl: string, again = false): AccountEmail {
  const T = VERIFY[normalizeLocale(locale)] || VERIFY.fr;
  const body = again
    ? `${T.again}\n${verifyUrl}\n\n${T.ignore}`
    : `${T.intro}\n\n${T.action}\n${verifyUrl}\n\n${T.ignore}`;
  return { subject: T.subject, body };
}

export function passwordResetEmail(locale: string | null | undefined, link: string, firstName?: string | null, code?: string | null): AccountEmail {
  const T = RESET[normalizeLocale(locale)] || RESET.fr;
  const codePart = code ? `${T.code}\n${code}\n\n` : '';
  const body = `${T.hello.replace('{name}', firstName ? ` ${firstName}` : '')}\n\n${T.body}\n\n${link}\n\n${codePart}${T.ignore}\n\n${T.sign}`;
  return { subject: T.subject, body };
}

// ALERTE « NOUVELLE CONNEXION » DANS LA LANGUE DU COMPTE (15/11/2026).
// Le texte était en dur en français dans app/api/auth/link : un commercial
// anglais ou allemand recevait une alerte de sécurité qu'il ne pouvait pas
// lire — donc qu'il ignorait, ce qui est le contraire du but recherché.
const NEW_DEVICE: Record<string, { subject: string; hello: string; intro: string; on: string; unknownDevice: string; unknownBrowser: string; when: string; ok: string; notYou: string; dateLocale: string }> = {
  fr: { subject: 'Nouvelle connexion à ton compte Meet Aaron', hello: 'Bonjour{name},', intro: "Une connexion à ton compte Meet Aaron vient d'être faite depuis un appareil jamais utilisé jusqu'ici :", on: '{browser} sur {os}', unknownDevice: 'appareil inconnu', unknownBrowser: 'navigateur inconnu', when: 'le {when} ({tz})', ok: "Si c'est bien toi (nouvel ordinateur, nouveau téléphone, nouveau navigateur), tu n'as rien à faire.", notYou: "Si ce n'est pas toi : change ton mot de passe dès maintenant (Mon compte → Mon profil → Changer le mot de passe) et écris-nous à aaron@meetaaron.app — on coupera l'accès de cet appareil.", dateLocale: 'fr-FR' },
  en: { subject: 'New sign-in to your Meet Aaron account', hello: 'Hello{name},', intro: 'Your Meet Aaron account was just signed in to from a device that has never been used before:', on: '{browser} on {os}', unknownDevice: 'unknown device', unknownBrowser: 'unknown browser', when: 'on {when} ({tz})', ok: 'If this was you (new computer, new phone, new browser), there is nothing to do.', notYou: 'If it was not you: change your password now (My account → My profile → Change password) and write to us at aaron@meetaaron.app — we will cut off that device.', dateLocale: 'en-GB' },
  de: { subject: 'Neue Anmeldung bei deinem Meet-Aaron-Konto', hello: 'Hallo{name},', intro: 'Bei deinem Meet-Aaron-Konto hat sich gerade ein Gerät angemeldet, das bisher noch nie verwendet wurde:', on: '{browser} auf {os}', unknownDevice: 'unbekanntes Gerät', unknownBrowser: 'unbekannter Browser', when: 'am {when} ({tz})', ok: 'Wenn du das warst (neuer Computer, neues Telefon, neuer Browser), musst du nichts tun.', notYou: 'Wenn du das nicht warst: Ändere jetzt dein Passwort (Mein Konto → Mein Profil → Passwort ändern) und schreib uns an aaron@meetaaron.app — wir sperren den Zugang dieses Geräts.', dateLocale: 'de-DE' },
  it: { subject: 'Nuovo accesso al tuo account Meet Aaron', hello: 'Ciao{name},', intro: 'È appena stato effettuato un accesso al tuo account Meet Aaron da un dispositivo mai usato finora:', on: '{browser} su {os}', unknownDevice: 'dispositivo sconosciuto', unknownBrowser: 'browser sconosciuto', when: 'il {when} ({tz})', ok: 'Se sei stato tu (nuovo computer, nuovo telefono, nuovo browser), non devi fare nulla.', notYou: "Se non sei stato tu: cambia subito la password (Il mio account → Il mio profilo → Cambia password) e scrivici a aaron@meetaaron.app — bloccheremo l'accesso di quel dispositivo.", dateLocale: 'it-IT' },
  es: { subject: 'Nuevo inicio de sesión en tu cuenta Meet Aaron', hello: 'Hola{name},', intro: 'Se acaba de iniciar sesión en tu cuenta Meet Aaron desde un dispositivo que nunca se había usado:', on: '{browser} en {os}', unknownDevice: 'dispositivo desconocido', unknownBrowser: 'navegador desconocido', when: 'el {when} ({tz})', ok: 'Si has sido tú (ordenador nuevo, teléfono nuevo, navegador nuevo), no tienes que hacer nada.', notYou: 'Si no has sido tú: cambia tu contraseña ahora (Mi cuenta → Mi perfil → Cambiar contraseña) y escríbenos a aaron@meetaaron.app — cortaremos el acceso de ese dispositivo.', dateLocale: 'es-ES' },
  pt: { subject: 'Novo início de sessão na tua conta Meet Aaron', hello: 'Olá{name},', intro: 'Acabou de ser iniciada uma sessão na tua conta Meet Aaron a partir de um dispositivo nunca antes utilizado:', on: '{browser} em {os}', unknownDevice: 'dispositivo desconhecido', unknownBrowser: 'navegador desconhecido', when: 'em {when} ({tz})', ok: 'Se foste tu (novo computador, novo telemóvel, novo navegador), não tens de fazer nada.', notYou: 'Se não foste tu: altera já a tua palavra-passe (A minha conta → O meu perfil → Alterar palavra-passe) e escreve-nos para aaron@meetaaron.app — cortaremos o acesso desse dispositivo.', dateLocale: 'pt-PT' },
  nl: { subject: 'Nieuwe aanmelding bij je Meet Aaron-account', hello: 'Hallo{name},', intro: 'Er is zojuist bij je Meet Aaron-account aangemeld vanaf een apparaat dat nog nooit eerder is gebruikt:', on: '{browser} op {os}', unknownDevice: 'onbekend apparaat', unknownBrowser: 'onbekende browser', when: 'op {when} ({tz})', ok: 'Was jij dit (nieuwe computer, nieuwe telefoon, nieuwe browser)? Dan hoef je niets te doen.', notYou: 'Was jij dit niet? Wijzig dan nu je wachtwoord (Mijn account → Mijn profiel → Wachtwoord wijzigen) en schrijf ons op aaron@meetaaron.app — wij blokkeren de toegang van dat apparaat.', dateLocale: 'nl-NL' },
};

export function newDeviceEmail(
  locale: string | null | undefined,
  info: { firstName?: string | null; userAgent: string; at: Date; timeZone: string }
): AccountEmail {
  const T = NEW_DEVICE[normalizeLocale(locale)] || NEW_DEVICE.fr;
  const ua = info.userAgent || '';
  const os = /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : T.unknownDevice;
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : T.unknownBrowser;
  let when: string;
  try {
    when = info.at.toLocaleString(T.dateLocale, { dateStyle: 'long', timeStyle: 'short', timeZone: info.timeZone });
  } catch {
    when = info.at.toISOString();
  }
  const body =
    `${T.hello.replace('{name}', info.firstName ? ` ${info.firstName}` : '')}\n\n` +
    `${T.intro}\n` +
    `• ${T.on.replace('{browser}', browser).replace('{os}', os)}\n` +
    `• ${T.when.replace('{when}', when).replace('{tz}', info.timeZone)}\n\n` +
    `${T.ok}\n\n` +
    `${T.notYou}\n\n` +
    `Aaron`;
  return { subject: T.subject, body };
}

// EMAIL D'ACTIVATION APRÈS UNE INSCRIPTION DANS L'APPLICATION (17/11/2026).
// Voir lib/signup-activation.ts : l'app ne peut pas mener au paiement, cet
// email le fait. Pas de prix ici : le montant exact et la devise s'affichent
// sur la page Stripe, d'après le pays de facturation.
const ACTIVATE: Record<string, { subject: string; hello: string; intro: string; action: string; valid: string; after: string; ignore: string }> = {
  fr: { subject: 'Active ton espace Meet Aaron', hello: 'Bonjour{name},', intro: 'Ton compte Meet Aaron est créé. Il reste une étape pour ouvrir ton espace : choisir ton abonnement.', action: 'Clique sur ce lien pour le faire en toute sécurité, sur notre site (paiement par carte avec Stripe) :', valid: 'Le lien est valable 14 jours.', after: "Une fois le paiement fait, retourne dans l'application Meet Aaron : ton espace t'y attend.", ignore: "Si tu n'es pas à l'origine de cette inscription, ignore simplement cet email." },
  en: { subject: 'Activate your Meet Aaron space', hello: 'Hello{name},', intro: 'Your Meet Aaron account has been created. One step remains to open your space: choosing your subscription.', action: 'Click this link to do it securely on our website (card payment with Stripe):', valid: 'The link is valid for 14 days.', after: 'Once the payment is done, go back to the Meet Aaron app: your space will be waiting for you.', ignore: 'If you did not sign up, simply ignore this email.' },
  de: { subject: 'Aktiviere deinen Meet-Aaron-Bereich', hello: 'Hallo{name},', intro: 'Dein Meet-Aaron-Konto ist erstellt. Ein Schritt fehlt noch, um deinen Bereich zu öffnen: die Wahl deines Abonnements.', action: 'Klicke auf diesen Link, um das sicher auf unserer Website zu erledigen (Kartenzahlung mit Stripe):', valid: 'Der Link ist 14 Tage gültig.', after: 'Sobald die Zahlung erfolgt ist, kehre in die Meet-Aaron-App zurück: Dein Bereich wartet dort auf dich.', ignore: 'Falls du dich nicht angemeldet hast, ignoriere diese E-Mail einfach.' },
  it: { subject: 'Attiva il tuo spazio Meet Aaron', hello: 'Ciao{name},', intro: 'Il tuo account Meet Aaron è stato creato. Manca un passaggio per aprire il tuo spazio: scegliere l\'abbonamento.', action: 'Clicca su questo link per farlo in sicurezza sul nostro sito (pagamento con carta tramite Stripe):', valid: 'Il link è valido 14 giorni.', after: 'Una volta effettuato il pagamento, torna nell\'app Meet Aaron: il tuo spazio ti aspetta.', ignore: 'Se non sei stato tu a iscriverti, ignora semplicemente questa email.' },
  es: { subject: 'Activa tu espacio Meet Aaron', hello: 'Hola{name},', intro: 'Tu cuenta Meet Aaron está creada. Queda un paso para abrir tu espacio: elegir tu suscripción.', action: 'Haz clic en este enlace para hacerlo de forma segura en nuestra web (pago con tarjeta mediante Stripe):', valid: 'El enlace es válido durante 14 días.', after: 'Una vez hecho el pago, vuelve a la aplicación Meet Aaron: tu espacio te estará esperando.', ignore: 'Si no te has registrado, simplemente ignora este correo.' },
  pt: { subject: 'Ativa o teu espaço Meet Aaron', hello: 'Olá{name},', intro: 'A tua conta Meet Aaron foi criada. Falta um passo para abrir o teu espaço: escolher a tua subscrição.', action: 'Clica neste link para o fazer em segurança no nosso site (pagamento com cartão através da Stripe):', valid: 'O link é válido durante 14 dias.', after: 'Depois do pagamento, volta à aplicação Meet Aaron: o teu espaço estará à tua espera.', ignore: 'Se não foste tu a inscrever-te, ignora simplesmente este email.' },
  nl: { subject: 'Activeer je Meet Aaron-omgeving', hello: 'Hallo{name},', intro: 'Je Meet Aaron-account is aangemaakt. Nog één stap om je omgeving te openen: je abonnement kiezen.', action: 'Klik op deze link om dat veilig op onze website te doen (betaling met kaart via Stripe):', valid: 'De link is 14 dagen geldig.', after: 'Ga na de betaling terug naar de Meet Aaron-app: je omgeving staat daar voor je klaar.', ignore: 'Heb je je niet aangemeld? Negeer deze e-mail dan gewoon.' },
};

export function activationEmail(locale: string | null | undefined, link: string, firstName?: string | null): AccountEmail {
  const T = ACTIVATE[normalizeLocale(locale)] || ACTIVATE.fr;
  const body =
    `${T.hello.replace('{name}', firstName ? ` ${firstName}` : '')}\n\n` +
    `${T.intro}\n\n${T.action}\n${link}\n\n${T.valid}\n\n${T.after}\n\n${T.ignore}\n\nAaron`;
  return { subject: T.subject, body };
}
