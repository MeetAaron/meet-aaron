// lib/i18n.js
//
// Infrastructure de traduction pour Meet Aaron. Le français reste la langue
// de référence (toutes les pages sont écrites en français en dur) — ce
// module ajoute une couche de traduction pour l'habillage commun (nav,
// boutons génériques, page de connexion) sans toucher au contenu métier de
// chaque page individuelle, qui reste un chantier séparé, page par page.
//
// Usage dans un composant client :
//   import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
//   const [locale, setLocale] = useLocale();
//   <p>{t('nav.dashboard', locale)}</p>
//
// La langue choisie est mémorisée dans localStorage (clé 'aaron_locale') et
// détectée automatiquement au premier chargement depuis la langue du
// navigateur si aucune préférence n'a encore été enregistrée. Une future
// évolution pourra la stocker aussi côté `users.locale` en base pour la
// faire suivre l'utilisateur d'un appareil à l'autre (non fait ici : pas de
// migration Supabase nécessaire pour cette première version, tout reste
// côté client).

import { useEffect, useState } from 'react';

export const LOCALES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl'];

export const LOCALE_LABELS = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
};

export const LOCALE_FLAGS = {
  fr: '🇫🇷',
  en: '🇬🇧',
  de: '🇩🇪',
  it: '🇮🇹',
  es: '🇪🇸',
  pt: '🇵🇹',
  nl: '🇳🇱',
};

const STORAGE_KEY = 'aaron_locale';

export const DICT = {
  fr: {
    'nav.dashboard': 'Tableau de bord',
    'nav.prospects': 'Prospects',
    'nav.opportunity': 'Aaron Opportunité',
    'nav.client': 'Aaron Client',
    'nav.campaigns': 'Campagnes',
    'nav.agenda': 'Agenda',
    'nav.results': 'Résultats',
    'nav.documents': 'Mes documents',
    'nav.chat': 'Chat avec Aaron',
    'nav.connections': 'Connexions',
    'nav.preferences': 'Préférences',
    'nav.team': 'Mon équipe',
    'nav.suggestions': 'Suggestions',
    'nav.products': 'Produits',
    'nav.availability': 'Disponibilités',
    'common.loading': 'Chargement…',
    'common.save': 'Enregistrer',
    'common.cancel': 'Annuler',
    'common.delete': 'Supprimer',
    'common.confirm': 'Confirmer',
    'common.back': 'Retour',
    'common.add': 'Ajouter',
    'common.edit': 'Modifier',
    'common.search': 'Rechercher',
    'common.close': 'Fermer',
    'common.yes': 'Oui',
    'common.no': 'Non',
    'common.error': 'Une erreur est survenue.',
    'common.success': 'Effectué avec succès.',
    'common.language': 'Langue',
    'auth.welcomeBack': 'Content de vous revoir',
    'auth.createAccount': 'Créer votre compte',
    'auth.emailLabel': 'Adresse email',
    'auth.passwordLabel': 'Mot de passe',
    'auth.signIn': 'Se connecter',
    'auth.signUp': "Créer un compte",
    'auth.signingIn': 'Connexion…',
    'auth.signingUp': 'Création…',
    'auth.noAccount': "Pas encore de compte ?",
    'auth.hasAccount': 'Déjà un compte ?',
    'auth.switchToSignup': "S'inscrire",
    'auth.switchToSignin': 'Se connecter',
    'auth.verifiedMessage': 'Adresse email confirmée ! Vous pouvez vous connecter.',
    'auth.verifyError': "Le lien de confirmation est invalide ou a expiré. Réessayez de créer un compte, ou contactez-nous.",
    'auth.taglineSignin': 'Connectez-vous à votre espace commercial.',
    'auth.taglineSignup': 'Créez votre compte.',
    'auth.or': 'ou',
    'auth.continueWithGoogle': 'Continuer avec Google',
    'auth.continueWithMicrosoft': 'Continuer avec Microsoft',
    'auth.signupPartialError': "Compte créé, mais l'envoi de l'email de confirmation a échoué — vous pouvez tout de même vous connecter dès maintenant.",
    'auth.signupSuccess': 'Compte créé ! Vérifiez votre boîte mail pour confirmer votre adresse (vous pouvez déjà vous connecter en attendant).',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.prospects': 'Prospects',
    'nav.opportunity': 'Aaron Opportunity',
    'nav.client': 'Aaron Client',
    'nav.campaigns': 'Campaigns',
    'nav.agenda': 'Calendar',
    'nav.results': 'Results',
    'nav.documents': 'My documents',
    'nav.chat': 'Chat with Aaron',
    'nav.connections': 'Connections',
    'nav.preferences': 'Preferences',
    'nav.team': 'My team',
    'nav.suggestions': 'Suggestions',
    'nav.products': 'Products',
    'nav.availability': 'Availability',
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'common.back': 'Back',
    'common.add': 'Add',
    'common.edit': 'Edit',
    'common.search': 'Search',
    'common.close': 'Close',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.error': 'Something went wrong.',
    'common.success': 'Done successfully.',
    'common.language': 'Language',
    'auth.welcomeBack': 'Welcome back',
    'auth.createAccount': 'Create your account',
    'auth.emailLabel': 'Email address',
    'auth.passwordLabel': 'Password',
    'auth.signIn': 'Sign in',
    'auth.signUp': 'Create account',
    'auth.signingIn': 'Signing in…',
    'auth.signingUp': 'Creating account…',
    'auth.noAccount': "Don't have an account yet?",
    'auth.hasAccount': 'Already have an account?',
    'auth.switchToSignup': 'Sign up',
    'auth.switchToSignin': 'Sign in',
    'auth.verifiedMessage': 'Email address confirmed! You can now sign in.',
    'auth.verifyError': 'This confirmation link is invalid or has expired. Try creating an account again, or contact us.',
    'auth.taglineSignin': 'Sign in to your sales workspace.',
    'auth.taglineSignup': 'Create your account.',
    'auth.or': 'or',
    'auth.continueWithGoogle': 'Continue with Google',
    'auth.continueWithMicrosoft': 'Continue with Microsoft',
    'auth.signupPartialError': 'Account created, but the confirmation email failed to send — you can still sign in right now.',
    'auth.signupSuccess': 'Account created! Check your inbox to confirm your address (you can already sign in in the meantime).',
  },
  de: {
    'nav.dashboard': 'Übersicht',
    'nav.prospects': 'Interessenten',
    'nav.opportunity': 'Aaron Opportunity',
    'nav.client': 'Aaron Kunde',
    'nav.campaigns': 'Kampagnen',
    'nav.agenda': 'Kalender',
    'nav.results': 'Ergebnisse',
    'nav.documents': 'Meine Dokumente',
    'nav.chat': 'Chat mit Aaron',
    'nav.connections': 'Verbindungen',
    'nav.preferences': 'Einstellungen',
    'nav.team': 'Mein Team',
    'nav.suggestions': 'Vorschläge',
    'nav.products': 'Produkte',
    'nav.availability': 'Verfügbarkeiten',
    'common.loading': 'Wird geladen…',
    'common.save': 'Speichern',
    'common.cancel': 'Abbrechen',
    'common.delete': 'Löschen',
    'common.confirm': 'Bestätigen',
    'common.back': 'Zurück',
    'common.add': 'Hinzufügen',
    'common.edit': 'Bearbeiten',
    'common.search': 'Suchen',
    'common.close': 'Schließen',
    'common.yes': 'Ja',
    'common.no': 'Nein',
    'common.error': 'Ein Fehler ist aufgetreten.',
    'common.success': 'Erfolgreich abgeschlossen.',
    'common.language': 'Sprache',
    'auth.welcomeBack': 'Willkommen zurück',
    'auth.createAccount': 'Konto erstellen',
    'auth.emailLabel': 'E-Mail-Adresse',
    'auth.passwordLabel': 'Passwort',
    'auth.signIn': 'Anmelden',
    'auth.signUp': 'Konto erstellen',
    'auth.signingIn': 'Anmeldung…',
    'auth.signingUp': 'Konto wird erstellt…',
    'auth.noAccount': 'Noch kein Konto?',
    'auth.hasAccount': 'Bereits ein Konto?',
    'auth.switchToSignup': 'Registrieren',
    'auth.switchToSignin': 'Anmelden',
    'auth.verifiedMessage': 'E-Mail-Adresse bestätigt! Sie können sich jetzt anmelden.',
    'auth.verifyError': 'Dieser Bestätigungslink ist ungültig oder abgelaufen. Versuchen Sie es erneut oder kontaktieren Sie uns.',
    'auth.taglineSignin': 'Melden Sie sich in Ihrem Vertriebsbereich an.',
    'auth.taglineSignup': 'Erstellen Sie Ihr Konto.',
    'auth.or': 'oder',
    'auth.continueWithGoogle': 'Weiter mit Google',
    'auth.continueWithMicrosoft': 'Weiter mit Microsoft',
    'auth.signupPartialError': 'Konto erstellt, aber die Bestätigungs-E-Mail konnte nicht gesendet werden — Sie können sich trotzdem sofort anmelden.',
    'auth.signupSuccess': 'Konto erstellt! Prüfen Sie Ihr Postfach, um Ihre Adresse zu bestätigen (Sie können sich in der Zwischenzeit bereits anmelden).',
  },
  it: {
    'nav.dashboard': 'Pannello',
    'nav.prospects': 'Prospect',
    'nav.opportunity': 'Aaron Opportunità',
    'nav.client': 'Aaron Cliente',
    'nav.campaigns': 'Campagne',
    'nav.agenda': 'Calendario',
    'nav.results': 'Risultati',
    'nav.documents': 'I miei documenti',
    'nav.chat': 'Chat con Aaron',
    'nav.connections': 'Connessioni',
    'nav.preferences': 'Preferenze',
    'nav.team': 'Il mio team',
    'nav.suggestions': 'Suggerimenti',
    'nav.products': 'Prodotti',
    'nav.availability': 'Disponibilità',
    'common.loading': 'Caricamento…',
    'common.save': 'Salva',
    'common.cancel': 'Annulla',
    'common.delete': 'Elimina',
    'common.confirm': 'Conferma',
    'common.back': 'Indietro',
    'common.add': 'Aggiungi',
    'common.edit': 'Modifica',
    'common.search': 'Cerca',
    'common.close': 'Chiudi',
    'common.yes': 'Sì',
    'common.no': 'No',
    'common.error': 'Si è verificato un errore.',
    'common.success': 'Operazione riuscita.',
    'common.language': 'Lingua',
    'auth.welcomeBack': 'Bentornato',
    'auth.createAccount': 'Crea il tuo account',
    'auth.emailLabel': 'Indirizzo email',
    'auth.passwordLabel': 'Password',
    'auth.signIn': 'Accedi',
    'auth.signUp': 'Crea account',
    'auth.signingIn': 'Accesso in corso…',
    'auth.signingUp': 'Creazione account…',
    'auth.noAccount': 'Non hai ancora un account?',
    'auth.hasAccount': 'Hai già un account?',
    'auth.switchToSignup': 'Registrati',
    'auth.switchToSignin': 'Accedi',
    'auth.verifiedMessage': 'Indirizzo email confermato! Ora puoi accedere.',
    'auth.verifyError': 'Il link di conferma non è valido o è scaduto. Riprova a creare un account o contattaci.',
    'auth.taglineSignin': 'Accedi al tuo spazio commerciale.',
    'auth.taglineSignup': 'Crea il tuo account.',
    'auth.or': 'oppure',
    'auth.continueWithGoogle': 'Continua con Google',
    'auth.continueWithMicrosoft': 'Continua con Microsoft',
    'auth.signupPartialError': "Account creato, ma l'invio dell'email di conferma non è riuscito — puoi comunque accedere subito.",
    'auth.signupSuccess': 'Account creato! Controlla la tua casella di posta per confermare il tuo indirizzo (nel frattempo puoi già accedere).',
  },
  es: {
    'nav.dashboard': 'Panel',
    'nav.prospects': 'Prospectos',
    'nav.opportunity': 'Aaron Oportunidad',
    'nav.client': 'Aaron Cliente',
    'nav.campaigns': 'Campañas',
    'nav.agenda': 'Calendario',
    'nav.results': 'Resultados',
    'nav.documents': 'Mis documentos',
    'nav.chat': 'Chat con Aaron',
    'nav.connections': 'Conexiones',
    'nav.preferences': 'Preferencias',
    'nav.team': 'Mi equipo',
    'nav.suggestions': 'Sugerencias',
    'nav.products': 'Productos',
    'nav.availability': 'Disponibilidad',
    'common.loading': 'Cargando…',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.confirm': 'Confirmar',
    'common.back': 'Atrás',
    'common.add': 'Añadir',
    'common.edit': 'Editar',
    'common.search': 'Buscar',
    'common.close': 'Cerrar',
    'common.yes': 'Sí',
    'common.no': 'No',
    'common.error': 'Se ha producido un error.',
    'common.success': 'Realizado con éxito.',
    'common.language': 'Idioma',
    'auth.welcomeBack': 'Bienvenido de nuevo',
    'auth.createAccount': 'Crea tu cuenta',
    'auth.emailLabel': 'Correo electrónico',
    'auth.passwordLabel': 'Contraseña',
    'auth.signIn': 'Iniciar sesión',
    'auth.signUp': 'Crear cuenta',
    'auth.signingIn': 'Iniciando sesión…',
    'auth.signingUp': 'Creando cuenta…',
    'auth.noAccount': '¿Aún no tienes cuenta?',
    'auth.hasAccount': '¿Ya tienes cuenta?',
    'auth.switchToSignup': 'Registrarse',
    'auth.switchToSignin': 'Iniciar sesión',
    'auth.verifiedMessage': '¡Correo confirmado! Ya puedes iniciar sesión.',
    'auth.verifyError': 'Este enlace de confirmación no es válido o ha caducado. Intenta crear una cuenta de nuevo o contáctanos.',
    'auth.taglineSignin': 'Inicia sesión en tu espacio comercial.',
    'auth.taglineSignup': 'Crea tu cuenta.',
    'auth.or': 'o',
    'auth.continueWithGoogle': 'Continuar con Google',
    'auth.continueWithMicrosoft': 'Continuar con Microsoft',
    'auth.signupPartialError': 'Cuenta creada, pero no se pudo enviar el correo de confirmación — aun así puedes iniciar sesión ahora.',
    'auth.signupSuccess': '¡Cuenta creada! Revisa tu bandeja de entrada para confirmar tu dirección (mientras tanto ya puedes iniciar sesión).',
  },
  pt: {
    'nav.dashboard': 'Painel',
    'nav.prospects': 'Prospetos',
    'nav.opportunity': 'Aaron Oportunidade',
    'nav.client': 'Aaron Cliente',
    'nav.campaigns': 'Campanhas',
    'nav.agenda': 'Calendário',
    'nav.results': 'Resultados',
    'nav.documents': 'Meus documentos',
    'nav.chat': 'Chat com o Aaron',
    'nav.connections': 'Conexões',
    'nav.preferences': 'Preferências',
    'nav.team': 'Minha equipa',
    'nav.suggestions': 'Sugestões',
    'nav.products': 'Produtos',
    'nav.availability': 'Disponibilidade',
    'common.loading': 'A carregar…',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.confirm': 'Confirmar',
    'common.back': 'Voltar',
    'common.add': 'Adicionar',
    'common.edit': 'Editar',
    'common.search': 'Pesquisar',
    'common.close': 'Fechar',
    'common.yes': 'Sim',
    'common.no': 'Não',
    'common.error': 'Ocorreu um erro.',
    'common.success': 'Concluído com sucesso.',
    'common.language': 'Idioma',
    'auth.welcomeBack': 'Bem-vindo de volta',
    'auth.createAccount': 'Crie a sua conta',
    'auth.emailLabel': 'Endereço de email',
    'auth.passwordLabel': 'Palavra-passe',
    'auth.signIn': 'Entrar',
    'auth.signUp': 'Criar conta',
    'auth.signingIn': 'A entrar…',
    'auth.signingUp': 'A criar conta…',
    'auth.noAccount': 'Ainda não tem conta?',
    'auth.hasAccount': 'Já tem conta?',
    'auth.switchToSignup': 'Registar',
    'auth.switchToSignin': 'Entrar',
    'auth.verifiedMessage': 'Endereço de email confirmado! Já pode entrar.',
    'auth.verifyError': 'Este link de confirmação é inválido ou expirou. Tente criar uma conta novamente ou contacte-nos.',
    'auth.taglineSignin': 'Entre no seu espaço comercial.',
    'auth.taglineSignup': 'Crie a sua conta.',
    'auth.or': 'ou',
    'auth.continueWithGoogle': 'Continuar com o Google',
    'auth.continueWithMicrosoft': 'Continuar com a Microsoft',
    'auth.signupPartialError': 'Conta criada, mas o envio do email de confirmação falhou — ainda assim já pode entrar.',
    'auth.signupSuccess': 'Conta criada! Verifique a sua caixa de entrada para confirmar o seu endereço (já pode entrar entretanto).',
  },
  nl: {
    'nav.dashboard': 'Dashboard',
    'nav.prospects': 'Prospects',
    'nav.opportunity': 'Aaron Kans',
    'nav.client': 'Aaron Klant',
    'nav.campaigns': "Campagnes",
    'nav.agenda': 'Agenda',
    'nav.results': 'Resultaten',
    'nav.documents': "Mijn documenten",
    'nav.chat': 'Chat met Aaron',
    'nav.connections': 'Verbindingen',
    'nav.preferences': 'Voorkeuren',
    'nav.team': 'Mijn team',
    'nav.suggestions': 'Suggesties',
    'nav.products': 'Producten',
    'nav.availability': 'Beschikbaarheid',
    'common.loading': 'Laden…',
    'common.save': 'Opslaan',
    'common.cancel': 'Annuleren',
    'common.delete': 'Verwijderen',
    'common.confirm': 'Bevestigen',
    'common.back': 'Terug',
    'common.add': 'Toevoegen',
    'common.edit': 'Bewerken',
    'common.search': 'Zoeken',
    'common.close': 'Sluiten',
    'common.yes': 'Ja',
    'common.no': 'Nee',
    'common.error': 'Er is een fout opgetreden.',
    'common.success': 'Succesvol voltooid.',
    'common.language': 'Taal',
    'auth.welcomeBack': 'Welkom terug',
    'auth.createAccount': 'Maak uw account aan',
    'auth.emailLabel': 'E-mailadres',
    'auth.passwordLabel': 'Wachtwoord',
    'auth.signIn': 'Inloggen',
    'auth.signUp': 'Account aanmaken',
    'auth.signingIn': 'Bezig met inloggen…',
    'auth.signingUp': 'Account wordt aangemaakt…',
    'auth.noAccount': 'Nog geen account?',
    'auth.hasAccount': 'Al een account?',
    'auth.switchToSignup': 'Registreren',
    'auth.switchToSignin': 'Inloggen',
    'auth.verifiedMessage': 'E-mailadres bevestigd! U kunt nu inloggen.',
    'auth.verifyError': 'Deze bevestigingslink is ongeldig of verlopen. Probeer opnieuw een account aan te maken of neem contact met ons op.',
    'auth.taglineSignin': 'Log in op uw verkoopomgeving.',
    'auth.taglineSignup': 'Maak uw account aan.',
    'auth.or': 'of',
    'auth.continueWithGoogle': 'Doorgaan met Google',
    'auth.continueWithMicrosoft': 'Doorgaan met Microsoft',
    'auth.signupPartialError': 'Account aangemaakt, maar de bevestigingsmail kon niet worden verzonden — u kunt nu al inloggen.',
    'auth.signupSuccess': 'Account aangemaakt! Controleer uw inbox om uw adres te bevestigen (u kunt intussen al inloggen).',
  },
};

export function t(key, locale) {
  const l = locale && DICT[locale] ? locale : 'fr';
  return DICT[l][key] ?? DICT.fr[key] ?? key;
}

function detectBrowserLocale() {
  if (typeof navigator === 'undefined') return 'fr';
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const short = (raw || '').slice(0, 2).toLowerCase();
    if (LOCALES.includes(short)) return short;
  }
  return 'fr';
}

// Hook client : lit la préférence enregistrée (localStorage), sinon détecte
// la langue du navigateur, sinon retombe sur le français. Toutes les
// instances de ce hook dans l'app se synchronisent entre elles (même onglet)
// via un événement custom 'aaron-locale-change', pour que changer la langue
// dans un composant (ex: le sélecteur dans la barre latérale) mette
// immédiatement à jour tous les autres textes traduits affichés ailleurs
// dans la page sans recharger.
export function useLocale() {
  const [locale, setLocaleState] = useState('fr');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setLocaleState(stored && LOCALES.includes(stored) ? stored : detectBrowserLocale());
    } catch {
      setLocaleState(detectBrowserLocale());
    }

    function onChange(e) {
      if (e.detail && LOCALES.includes(e.detail)) setLocaleState(e.detail);
    }
    window.addEventListener('aaron-locale-change', onChange);
    return () => window.removeEventListener('aaron-locale-change', onChange);
  }, []);

  function setLocale(next) {
    if (!LOCALES.includes(next)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Stockage indisponible (navigation privée, etc.) : le changement
      // reste appliqué pour la session en cours via l'événement ci-dessous.
    }
    window.dispatchEvent(new CustomEvent('aaron-locale-change', { detail: next }));
  }

  return [locale, setLocale];
}
