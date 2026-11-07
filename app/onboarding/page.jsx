// app/onboarding/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, consumePostLoginNext } from '@/lib/supabase-browser';
import { useLocale, localeForCountry, t } from '@/lib/i18n';
import { currencyForCountryText, subscriptionPrice, formatBoostPrice, yearlyPrice, yearlyPerMonth } from '@/lib/boost-tiers';
import Ic from '@/components/UiIcon';
import { isNativeApp } from '@/lib/native-app';

// Modules Aaron proposés dès l'inscription (demande d'Alex 2026-08-17) : avant,
// seul Aaron Prospect était proposé au patron, Opportunités/Clients ne
// s'activaient qu'après coup dans Préférences & abonnement. Même
// architecture Stripe (voir lib/subscription.ts, app/api/checkout/route.ts) :
// chaque module choisi ici devient sa propre ligne d'abonnement. Tarifs et
// descriptions repris tels quels de app/app/preferences/page.jsx
// (preferences.offers.apDesc/asDesc/acDesc) pour rester cohérent avec ce qui
// est affiché après-coup — cette page n'est pas traduite (comme le reste du
// tunnel d'inscription), donc textes en dur en français, pas de clé i18n.
const AARON_MODULES = [
  {
    value: 'AP',
    label: 'Aaron Prospect',
    price: '30€ / mois',
    desc: 'Prospection, relances et prise de rendez-vous.',
    info: "Aaron cherche et contacte de nouveaux prospects pour vous, relance ceux qui ne répondent pas, et prend des rendez-vous directement dans votre agenda — de la prospection jusqu'à l'obtention d'une opportunité.",
  },
  {
    value: 'AS',
    label: 'Aaron Opportunités',
    price: '30€ / mois',
    desc: 'Négociation, devis, gestion des objections.',
    info: "Une fois un rendez-vous obtenu, Aaron vous aide à faire avancer l'affaire : conseils avant RDV, devis chiffrés à partir de votre catalogue, gestion des objections, relances jusqu'à la signature — de la négociation jusqu'à l'obtention d'un nouveau client.",
  },
  {
    value: 'AC',
    label: 'Aaron Clients',
    price: '30€ / mois',
    desc: 'Fidélisation et relation client post-vente.',
    info: "Une fois le client signé, Aaron prend le relais sur la relation post-vente : suivi de satisfaction, réponses aux demandes courantes, alertes si un client montre des signes de mécontentement.",
  },
];

// Suggestions du champ pays (liste ouverte : on peut taper autre chose).
const COUNTRY_SUGGESTIONS = [
  'France', 'Belgique', 'Suisse', 'Luxembourg', 'Monaco', 'Canada',
  'Royaume-Uni', 'Irlande', 'Australie', 'Nouvelle-Zélande', 'États-Unis',
  'Allemagne', 'Autriche', 'Italie', 'Espagne', 'Portugal', 'Pays-Bas',
  'Maroc', 'Tunisie', 'Sénégal', "Côte d'Ivoire", 'Brésil', 'Mexique',
];

// Écran d'inscription en 7 langues (06/11/2026, retour Alex : « tout n'est pas traduit »).
const SIGNUP_TEXT = {
  "fr": {
    "welcome": "Bienvenue sur Meet Aaron",
    "who": "Pour commencer, dites-nous qui vous êtes.",
    "rolePatron": "Je suis fondateur(trice) / dirigeant(e)",
    "rolePatronDesc": "Je crée l'espace Meet Aaron de mon entreprise et je configure l'abonnement (carte bancaire). Pas besoin d'inviter toute mon équipe dès maintenant : je pourrai ajouter les sessions de mes employés plus tard directement depuis l'application, au même prix.",
    "roleCommercial": "Je suis commercial(e)",
    "roleCommercialDesc": "Je fais de la prospection/vente pour une entreprise — avec ou sans code transmis par mon employeur.",
    "lastDetail": "Une dernière précision avant de continuer.",
    "pathCode": "J'ai un code d'activation de mon entreprise",
    "pathCodeDesc": "Mon entreprise a déjà un abonnement Meet Aaron actif et m'a transmis un code pour rejoindre son espace, sans payer individuellement.",
    "pathOwn": "Je crée mon propre espace",
    "pathOwnDesc": "Je n'ai pas de code : je configure mon propre abonnement (carte bancaire) pour utiliser Meet Aaron seul(e).",
    "back": "← Retour",
    "createTitle": "Créez votre espace Meet Aaron",
    "createSub": "Quelques infos, puis direction le paiement pour activer votre compte.",
    "firstName": "Prénom",
    "lastName": "Nom",
    "companyName": "Nom de votre société",
    "companyHint": "Si vous êtes seul(e), indiquez simplement votre nom ou celui de votre activité.",
    "country": "Pays de votre société",
    "countryPh": "ex : France",
    "subscription": "Votre abonnement",
    "offerDesc": "300 prospects par mois. Prospection, relances, prise de rendez-vous, suivi des opportunités jusqu'à la signature — tout est inclus.",
    "offerHint": "Sans engagement, résiliable à tout moment depuis l'application. Mises à jour et maintenance comprises.",
    "attest": "Je certifie être autorisé(e) par mon entreprise à créer ce compte et à partager les documents commerciaux nécessaires au fonctionnement d'Aaron.",
    "redirecting": "Redirection…",
    "continuePay": "Continuer vers le paiement",
    "joinTitle": "Rejoignez votre équipe",
    "joinSub": "Entrez le code d'invitation transmis par votre dirigeant(e).",
    "inviteCode": "Code d'invitation de votre entreprise",
    "inviteHint": "Ce code vous a été transmis par votre dirigeant(e) ou responsable — il vous fait rejoindre l'abonnement déjà actif de votre entreprise, sans paiement de votre part.",
    "connecting": "Connexion…",
    "join": "Rejoindre mon équipe",
    "noCode": "Vous n'avez pas de code ? Créez votre propre espace Meet Aaron →",
    "loading": "Chargement…",
    "selectModule": "Sélectionnez au moins un module Aaron avant de continuer.",
    "attestFirst": "Merci de confirmer la case ci-dessous avant de continuer.",
    "countries": [
      "France",
      "Belgique",
      "Suisse",
      "Luxembourg",
      "Monaco",
      "Canada",
      "Royaume-Uni",
      "Irlande",
      "Australie",
      "Nouvelle-Zélande",
      "États-Unis",
      "Allemagne",
      "Autriche",
      "Italie",
      "Espagne",
      "Portugal",
      "Pays-Bas",
      "Maroc",
      "Tunisie",
      "Sénégal",
      "Côte d'Ivoire",
      "Brésil",
      "Mexique"
    ]
  },
  "en": {
    "welcome": "Welcome to Meet Aaron",
    "who": "To start, tell us who you are.",
    "rolePatron": "I'm a founder / business owner",
    "rolePatronDesc": "I create my company's Meet Aaron space and set up the subscription (bank card). No need to invite my whole team right now: I can add my employees' seats later, straight from the app, at the same price.",
    "roleCommercial": "I'm a salesperson",
    "roleCommercialDesc": "I prospect or sell for a company — with or without a code from my employer.",
    "lastDetail": "One last detail before we continue.",
    "pathCode": "I have an activation code from my company",
    "pathCodeDesc": "My company already has an active Meet Aaron subscription and gave me a code to join its space, without paying individually.",
    "pathOwn": "I create my own space",
    "pathOwnDesc": "I have no code: I set up my own subscription (bank card) to use Meet Aaron on my own.",
    "back": "← Back",
    "createTitle": "Create your Meet Aaron space",
    "createSub": "A few details, then on to payment to activate your account.",
    "firstName": "First name",
    "lastName": "Last name",
    "companyName": "Your company name",
    "companyHint": "If you work alone, simply enter your name or the name of your business.",
    "country": "Your company's country",
    "countryPh": "e.g. United Kingdom",
    "subscription": "Your subscription",
    "offerDesc": "300 prospects a month. Prospecting, follow-ups, meeting booking, opportunity tracking through to signature — everything included.",
    "offerHint": "No commitment, cancel any time from the app. Updates and maintenance included.",
    "attest": "I confirm that my company authorises me to create this account and to share the sales documents Aaron needs to work.",
    "redirecting": "Redirecting…",
    "continuePay": "Continue to payment",
    "joinTitle": "Join your team",
    "joinSub": "Enter the invitation code your manager gave you.",
    "inviteCode": "Your company's invitation code",
    "inviteHint": "This code was given to you by your manager — it adds you to your company's active subscription, with no payment on your side.",
    "connecting": "Signing in…",
    "join": "Join my team",
    "noCode": "No code? Create your own Meet Aaron space →",
    "loading": "Loading…",
    "selectModule": "Select at least one Aaron module before continuing.",
    "attestFirst": "Please tick the box below before continuing.",
    "countries": [
      "United Kingdom",
      "Ireland",
      "United States",
      "Canada",
      "Australia",
      "New Zealand",
      "France",
      "Belgium",
      "Switzerland",
      "Luxembourg",
      "Germany",
      "Austria",
      "Italy",
      "Spain",
      "Portugal",
      "Netherlands",
      "South Africa",
      "Singapore",
      "India",
      "Morocco",
      "Brazil",
      "Mexico"
    ]
  },
  "de": {
    "welcome": "Willkommen bei Meet Aaron",
    "who": "Sagen Sie uns zum Einstieg, wer Sie sind.",
    "rolePatron": "Ich bin Gründer(in) / Geschäftsführer(in)",
    "rolePatronDesc": "Ich lege den Meet-Aaron-Bereich meines Unternehmens an und richte das Abonnement ein (Bankkarte). Ich muss mein Team nicht sofort einladen: Ich kann die Plätze meiner Mitarbeiter später direkt in der App hinzufügen, zum gleichen Preis.",
    "roleCommercial": "Ich bin im Vertrieb",
    "roleCommercialDesc": "Ich akquiriere oder verkaufe für ein Unternehmen — mit oder ohne Code von meinem Arbeitgeber.",
    "lastDetail": "Eine letzte Angabe, bevor es weitergeht.",
    "pathCode": "Ich habe einen Aktivierungscode meines Unternehmens",
    "pathCodeDesc": "Mein Unternehmen hat bereits ein aktives Meet-Aaron-Abonnement und mir einen Code gegeben, um seinem Bereich beizutreten, ohne selbst zu zahlen.",
    "pathOwn": "Ich lege meinen eigenen Bereich an",
    "pathOwnDesc": "Ich habe keinen Code: Ich richte mein eigenes Abonnement ein (Bankkarte), um Meet Aaron allein zu nutzen.",
    "back": "← Zurück",
    "createTitle": "Legen Sie Ihren Meet-Aaron-Bereich an",
    "createSub": "Ein paar Angaben, dann geht es zur Zahlung, um Ihr Konto zu aktivieren.",
    "firstName": "Vorname",
    "lastName": "Nachname",
    "companyName": "Name Ihres Unternehmens",
    "companyHint": "Wenn Sie allein arbeiten, geben Sie einfach Ihren Namen oder den Ihrer Tätigkeit an.",
    "country": "Land Ihres Unternehmens",
    "countryPh": "z. B. Deutschland",
    "subscription": "Ihr Abonnement",
    "offerDesc": "300 Interessenten pro Monat. Akquise, Nachfassen, Terminvereinbarung, Begleitung der Verkaufschancen bis zur Unterschrift — alles inklusive.",
    "offerHint": "Keine Bindung, jederzeit in der App kündbar. Updates und Wartung inklusive.",
    "attest": "Ich bestätige, dass mein Unternehmen mich berechtigt, dieses Konto anzulegen und die für Aarons Arbeit nötigen Vertriebsunterlagen zu teilen.",
    "redirecting": "Weiterleitung…",
    "continuePay": "Weiter zur Zahlung",
    "joinTitle": "Treten Sie Ihrem Team bei",
    "joinSub": "Geben Sie den Einladungscode Ihrer Geschäftsführung ein.",
    "inviteCode": "Einladungscode Ihres Unternehmens",
    "inviteHint": "Diesen Code haben Sie von Ihrer Geschäftsführung erhalten — er fügt Sie dem aktiven Abonnement Ihres Unternehmens hinzu, ohne Zahlung Ihrerseits.",
    "connecting": "Anmeldung…",
    "join": "Meinem Team beitreten",
    "noCode": "Kein Code? Legen Sie Ihren eigenen Meet-Aaron-Bereich an →",
    "loading": "Wird geladen…",
    "selectModule": "Wählen Sie mindestens ein Aaron-Modul, bevor Sie fortfahren.",
    "attestFirst": "Bitte bestätigen Sie das Kästchen unten, bevor Sie fortfahren.",
    "countries": [
      "Deutschland",
      "Österreich",
      "Schweiz",
      "Liechtenstein",
      "Luxemburg",
      "Frankreich",
      "Belgien",
      "Niederlande",
      "Italien",
      "Spanien",
      "Portugal",
      "Vereinigtes Königreich",
      "Irland",
      "USA",
      "Kanada",
      "Australien",
      "Neuseeland"
    ]
  },
  "it": {
    "welcome": "Benvenuto su Meet Aaron",
    "who": "Per iniziare, dicci chi sei.",
    "rolePatron": "Sono fondatore / titolare",
    "rolePatronDesc": "Creo lo spazio Meet Aaron della mia azienda e configuro l'abbonamento (carta bancaria). Non serve invitare subito tutto il team: potrò aggiungere i posti dei miei collaboratori più tardi, direttamente dall'app, allo stesso prezzo.",
    "roleCommercial": "Sono un commerciale",
    "roleCommercialDesc": "Faccio prospezione o vendita per un'azienda — con o senza un codice dato dal mio datore di lavoro.",
    "lastDetail": "Un'ultima precisazione prima di continuare.",
    "pathCode": "Ho un codice di attivazione della mia azienda",
    "pathCodeDesc": "La mia azienda ha già un abbonamento Meet Aaron attivo e mi ha dato un codice per entrare nel suo spazio, senza pagare individualmente.",
    "pathOwn": "Creo il mio spazio",
    "pathOwnDesc": "Non ho un codice: configuro il mio abbonamento (carta bancaria) per usare Meet Aaron da solo.",
    "back": "← Indietro",
    "createTitle": "Crea il tuo spazio Meet Aaron",
    "createSub": "Qualche informazione, poi il pagamento per attivare l'account.",
    "firstName": "Nome",
    "lastName": "Cognome",
    "companyName": "Nome della tua azienda",
    "companyHint": "Se lavori da solo, indica semplicemente il tuo nome o quello della tua attività.",
    "country": "Paese della tua azienda",
    "countryPh": "es. Italia",
    "subscription": "Il tuo abbonamento",
    "offerDesc": "300 potenziali clienti al mese. Prospezione, solleciti, appuntamenti, seguito delle opportunità fino alla firma — tutto incluso.",
    "offerHint": "Senza vincoli, disdici quando vuoi dall'app. Aggiornamenti e manutenzione inclusi.",
    "attest": "Confermo che la mia azienda mi autorizza a creare questo account e a condividere i documenti commerciali necessari al funzionamento di Aaron.",
    "redirecting": "Reindirizzamento…",
    "continuePay": "Continua verso il pagamento",
    "joinTitle": "Unisciti al tuo team",
    "joinSub": "Inserisci il codice di invito ricevuto dal tuo responsabile.",
    "inviteCode": "Codice di invito della tua azienda",
    "inviteHint": "Questo codice ti è stato dato dal tuo responsabile — ti aggiunge all'abbonamento già attivo della tua azienda, senza alcun pagamento da parte tua.",
    "connecting": "Accesso…",
    "join": "Unirmi al mio team",
    "noCode": "Non hai un codice? Crea il tuo spazio Meet Aaron →",
    "loading": "Caricamento…",
    "selectModule": "Seleziona almeno un modulo Aaron prima di continuare.",
    "attestFirst": "Conferma la casella qui sotto prima di continuare.",
    "countries": [
      "Italia",
      "San Marino",
      "Svizzera",
      "Francia",
      "Germania",
      "Austria",
      "Spagna",
      "Portogallo",
      "Belgio",
      "Paesi Bassi",
      "Lussemburgo",
      "Regno Unito",
      "Irlanda",
      "Stati Uniti",
      "Canada",
      "Australia",
      "Nuova Zelanda"
    ]
  },
  "es": {
    "welcome": "Bienvenido a Meet Aaron",
    "who": "Para empezar, dinos quién eres.",
    "rolePatron": "Soy fundador(a) / director(a)",
    "rolePatronDesc": "Creo el espacio Meet Aaron de mi empresa y configuro la suscripción (tarjeta bancaria). No hace falta invitar a todo mi equipo ahora: podré añadir los puestos de mis empleados más tarde, directamente desde la aplicación, al mismo precio.",
    "roleCommercial": "Soy comercial",
    "roleCommercialDesc": "Hago prospección o venta para una empresa — con o sin un código de mi empleador.",
    "lastDetail": "Una última precisión antes de continuar.",
    "pathCode": "Tengo un código de activación de mi empresa",
    "pathCodeDesc": "Mi empresa ya tiene una suscripción Meet Aaron activa y me ha dado un código para unirme a su espacio, sin pagar individualmente.",
    "pathOwn": "Creo mi propio espacio",
    "pathOwnDesc": "No tengo código: configuro mi propia suscripción (tarjeta bancaria) para usar Meet Aaron por mi cuenta.",
    "back": "← Volver",
    "createTitle": "Crea tu espacio Meet Aaron",
    "createSub": "Unos datos y luego el pago para activar tu cuenta.",
    "firstName": "Nombre",
    "lastName": "Apellido",
    "companyName": "Nombre de tu empresa",
    "companyHint": "Si trabajas solo, indica simplemente tu nombre o el de tu actividad.",
    "country": "País de tu empresa",
    "countryPh": "ej. España",
    "subscription": "Tu suscripción",
    "offerDesc": "300 prospectos al mes. Prospección, seguimientos, citas, seguimiento de oportunidades hasta la firma — todo incluido.",
    "offerHint": "Sin permanencia, cancela cuando quieras desde la aplicación. Actualizaciones y mantenimiento incluidos.",
    "attest": "Confirmo que mi empresa me autoriza a crear esta cuenta y a compartir los documentos comerciales necesarios para el funcionamiento de Aaron.",
    "redirecting": "Redirigiendo…",
    "continuePay": "Continuar al pago",
    "joinTitle": "Únete a tu equipo",
    "joinSub": "Introduce el código de invitación que te ha dado tu responsable.",
    "inviteCode": "Código de invitación de tu empresa",
    "inviteHint": "Este código te lo ha dado tu responsable — te añade a la suscripción ya activa de tu empresa, sin ningún pago por tu parte.",
    "connecting": "Conectando…",
    "join": "Unirme a mi equipo",
    "noCode": "¿No tienes código? Crea tu propio espacio Meet Aaron →",
    "loading": "Cargando…",
    "selectModule": "Selecciona al menos un módulo Aaron antes de continuar.",
    "attestFirst": "Marca la casilla de abajo antes de continuar.",
    "countries": [
      "España",
      "México",
      "Argentina",
      "Chile",
      "Colombia",
      "Perú",
      "Francia",
      "Portugal",
      "Italia",
      "Alemania",
      "Reino Unido",
      "Irlanda",
      "Estados Unidos",
      "Canadá",
      "Australia"
    ]
  },
  "pt": {
    "welcome": "Bem-vindo ao Meet Aaron",
    "who": "Para começar, diz-nos quem és.",
    "rolePatron": "Sou fundador(a) / dirigente",
    "rolePatronDesc": "Crio o espaço Meet Aaron da minha empresa e configuro a subscrição (cartão bancário). Não preciso de convidar já toda a equipa: posso adicionar os lugares dos meus colaboradores mais tarde, diretamente na aplicação, ao mesmo preço.",
    "roleCommercial": "Sou comercial",
    "roleCommercialDesc": "Faço prospeção ou venda para uma empresa — com ou sem código dado pelo meu empregador.",
    "lastDetail": "Uma última precisão antes de continuar.",
    "pathCode": "Tenho um código de ativação da minha empresa",
    "pathCodeDesc": "A minha empresa já tem uma subscrição Meet Aaron ativa e deu-me um código para entrar no seu espaço, sem pagar individualmente.",
    "pathOwn": "Crio o meu próprio espaço",
    "pathOwnDesc": "Não tenho código: configuro a minha própria subscrição (cartão bancário) para usar o Meet Aaron sozinho.",
    "back": "← Voltar",
    "createTitle": "Cria o teu espaço Meet Aaron",
    "createSub": "Alguns dados e depois o pagamento para ativar a tua conta.",
    "firstName": "Nome",
    "lastName": "Apelido",
    "companyName": "Nome da tua empresa",
    "companyHint": "Se trabalhas sozinho, indica simplesmente o teu nome ou o da tua atividade.",
    "country": "País da tua empresa",
    "countryPh": "ex.: Portugal",
    "subscription": "A tua subscrição",
    "offerDesc": "300 potenciais clientes por mês. Prospeção, seguimentos, marcação de reuniões, acompanhamento das oportunidades até à assinatura — tudo incluído.",
    "offerHint": "Sem fidelização, cancelas quando quiseres na aplicação. Atualizações e manutenção incluídas.",
    "attest": "Confirmo que a minha empresa me autoriza a criar esta conta e a partilhar os documentos comerciais necessários ao funcionamento do Aaron.",
    "redirecting": "A redirecionar…",
    "continuePay": "Continuar para o pagamento",
    "joinTitle": "Junta-te à tua equipa",
    "joinSub": "Introduz o código de convite que o teu responsável te deu.",
    "inviteCode": "Código de convite da tua empresa",
    "inviteHint": "Este código foi-te dado pelo teu responsável — junta-te à subscrição já ativa da tua empresa, sem qualquer pagamento da tua parte.",
    "connecting": "A ligar…",
    "join": "Juntar-me à minha equipa",
    "noCode": "Não tens código? Cria o teu próprio espaço Meet Aaron →",
    "loading": "A carregar…",
    "selectModule": "Seleciona pelo menos um módulo Aaron antes de continuar.",
    "attestFirst": "Confirma a caixa abaixo antes de continuar.",
    "countries": [
      "Portugal",
      "Brasil",
      "Angola",
      "Moçambique",
      "Cabo Verde",
      "Espanha",
      "França",
      "Itália",
      "Alemanha",
      "Reino Unido",
      "Irlanda",
      "Estados Unidos",
      "Canadá",
      "Austrália"
    ]
  },
  "nl": {
    "welcome": "Welkom bij Meet Aaron",
    "who": "Vertel ons om te beginnen wie je bent.",
    "rolePatron": "Ik ben oprichter / bedrijfsleider",
    "rolePatronDesc": "Ik maak de Meet Aaron-omgeving van mijn bedrijf aan en stel het abonnement in (bankkaart). Ik hoef mijn team niet meteen uit te nodigen: ik kan de plaatsen van mijn medewerkers later rechtstreeks in de app toevoegen, voor dezelfde prijs.",
    "roleCommercial": "Ik ben verkoper",
    "roleCommercialDesc": "Ik prospecteer of verkoop voor een bedrijf — met of zonder code van mijn werkgever.",
    "lastDetail": "Nog één ding voordat we verdergaan.",
    "pathCode": "Ik heb een activatiecode van mijn bedrijf",
    "pathCodeDesc": "Mijn bedrijf heeft al een actief Meet Aaron-abonnement en gaf me een code om bij zijn omgeving aan te sluiten, zonder zelf te betalen.",
    "pathOwn": "Ik maak mijn eigen omgeving aan",
    "pathOwnDesc": "Ik heb geen code: ik stel mijn eigen abonnement in (bankkaart) om Meet Aaron alleen te gebruiken.",
    "back": "← Terug",
    "createTitle": "Maak je Meet Aaron-omgeving aan",
    "createSub": "Een paar gegevens, daarna de betaling om je account te activeren.",
    "firstName": "Voornaam",
    "lastName": "Achternaam",
    "companyName": "Naam van je bedrijf",
    "companyHint": "Werk je alleen, vul dan gewoon je naam of die van je activiteit in.",
    "country": "Land van je bedrijf",
    "countryPh": "bv. Nederland",
    "subscription": "Je abonnement",
    "offerDesc": "300 prospects per maand. Prospectie, opvolging, afspraken, opvolging van kansen tot de handtekening — alles inbegrepen.",
    "offerHint": "Zonder verplichting, op elk moment opzegbaar in de app. Updates en onderhoud inbegrepen.",
    "attest": "Ik bevestig dat mijn bedrijf me toestaat dit account aan te maken en de commerciële documenten te delen die Aaron nodig heeft.",
    "redirecting": "Doorsturen…",
    "continuePay": "Doorgaan naar betaling",
    "joinTitle": "Sluit je aan bij je team",
    "joinSub": "Voer de uitnodigingscode in die je van je leidinggevende kreeg.",
    "inviteCode": "Uitnodigingscode van je bedrijf",
    "inviteHint": "Deze code kreeg je van je leidinggevende — hij voegt je toe aan het actieve abonnement van je bedrijf, zonder betaling van jouw kant.",
    "connecting": "Aanmelden…",
    "join": "Bij mijn team aansluiten",
    "noCode": "Geen code? Maak je eigen Meet Aaron-omgeving aan →",
    "loading": "Laden…",
    "selectModule": "Kies minstens één Aaron-module voordat je verdergaat.",
    "attestFirst": "Vink het vakje hieronder aan voordat je verdergaat.",
    "countries": [
      "Nederland",
      "België",
      "Luxemburg",
      "Duitsland",
      "Frankrijk",
      "Verenigd Koninkrijk",
      "Ierland",
      "Verenigde Staten",
      "Canada",
      "Australië",
      "Nieuw-Zeeland"
    ]
  }
};
const st = (key, locale) => (SIGNUP_TEXT[locale] || SIGNUP_TEXT.fr)[key] ?? SIGNUP_TEXT.fr[key];

// Mensuel / annuel (06/11/2026). Textes locaux, comme ailleurs dans cette page.
const BILLING_TEXT = {
  "fr": {
    "label": "Rythme de facturation",
    "monthly": "Mensuel",
    "yearly": "Annuel",
    "save": "2 mois offerts",
    "billed": "facturé {total} par an"
  },
  "en": {
    "label": "Billing period",
    "monthly": "Monthly",
    "yearly": "Yearly",
    "save": "2 months free",
    "billed": "billed {total} per year"
  },
  "de": {
    "label": "Abrechnungszeitraum",
    "monthly": "Monatlich",
    "yearly": "Jährlich",
    "save": "2 Monate geschenkt",
    "billed": "{total} pro Jahr"
  },
  "it": {
    "label": "Periodo di fatturazione",
    "monthly": "Mensile",
    "yearly": "Annuale",
    "save": "2 mesi gratis",
    "billed": "{total} all’anno"
  },
  "es": {
    "label": "Periodo de facturación",
    "monthly": "Mensual",
    "yearly": "Anual",
    "save": "2 meses gratis",
    "billed": "{total} al año"
  },
  "pt": {
    "label": "Período de faturação",
    "monthly": "Mensal",
    "yearly": "Anual",
    "save": "2 meses grátis",
    "billed": "{total} por ano"
  },
  "nl": {
    "label": "Factureringsperiode",
    "monthly": "Maandelijks",
    "yearly": "Jaarlijks",
    "save": "2 maanden gratis",
    "billed": "{total} per jaar"
  }
};
const bt = (key, locale) => (BILLING_TEXT[locale] || BILLING_TEXT.fr)[key] || BILLING_TEXT.fr[key];

export default function OnboardingPage() {
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  const [checking, setChecking] = useState(true);
  // Application iOS (coque Capacitor) : pas d'inscription ni de paiement
  // dans l'app (règle Apple 3.1.1). Détecté après montage : au rendu serveur
  // on ne sait pas encore d'où vient la page.
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(isNativeApp());
  }, []);
  const [session, setSession] = useState(null);
  // Deux questions bien distinctes (retour Alex 25/08, après avoir testé
  // avec un 2e compte) : QUI la personne est (personRole — fondateur/
  // dirigeant(e) ou commercial(e), détermine le rôle en base et donc si
  // "Mon équipe" apparaît dans le menu, voir Shell) puis, seulement pour un
  // commercial, COMMENT il/elle rejoint Meet Aaron (signupPath — code
  // d'activation de son entreprise, ou création de son propre espace payant
  // s'il n'en a pas). Avant, ces deux questions étaient confondues en une
  // seule ("role"), ce qui laissait croire qu'un commercial solo devait
  // forcément avoir un code pour s'inscrire.
  const [personRole, setPersonRole] = useState(null); // null | 'patron' | 'commercial'
  const [signupPath, setSignupPath] = useState(null); // null | 'invite_code' | 'own_space'
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState('');
  const [selectedModules, setSelectedModules] = useState(['AP']);
  const [openInfo, setOpenInfo] = useState(null); // value du module dont l'explication est ouverte, ou null
  const [attested, setAttested] = useState(false);
  // Mensuel ou annuel (06/11/2026). L'annuel n'est proposé que si le prix
  // Stripe existe (NEXT_PUBLIC_YEARLY_PLAN=1 posé en même temps que le Price).
  const yearlyOffered = process.env.NEXT_PUBLIC_YEARLY_PLAN === '1';
  const [billing, setBilling] = useState('month');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function checkExisting() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      setSession(session);
      // Pré-remplissage best-effort depuis les infos OAuth (Google/Microsoft) si dispo.
      const metaFullName = session.user.user_metadata?.full_name || '';
      const [metaFirst, ...metaRest] = metaFullName.split(' ').filter(Boolean);
      setFirstName(metaFirst || '');
      setLastName(metaRest.join(' '));

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });

      if (res.ok) {
        // Page demandée avant la connexion (?next=… sur /login), sinon le
        // dashboard — voir rememberPostLoginNext dans lib/supabase-browser.ts.
        router.push(consumePostLoginNext() || '/app/campaigns');
        return;
      }

      setChecking(false);
    }

    checkExisting();
  }, [router]);

  function toggleModule(value) {
    setSelectedModules((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handlePatronSubmit(e) {
    e.preventDefault();
    if (selectedModules.length === 0) {
      setError(st('selectModule', locale));
      return;
    }
    if (!attested) {
      setError(st('attestFirst', locale));
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_user_id: session.user.id,
        email: session.user.email,
        first_name: firstName.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        company_name: companyName,
        country,
        locale,
        modules: selectedModules,
        billing_interval: yearlyOffered ? billing : 'month',
        // "patron" pour un(e) fondateur(trice)/dirigeant(e), "commercial"
        // pour un commercial solo qui paie pour lui-même sans code
        // d'activation (voir commentaire sur personRole/signupPath plus
        // haut) — lu par le webhook Stripe pour définir users.role, qui
        // détermine ensuite si "Mon équipe" apparaît dans le menu.
        role: personRole,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok || !body.url) {
      setError(body.error || 'Une erreur est survenue');
      return;
    }

    window.location.href = body.url;
  }

  async function handleJoinCompany(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch('/api/join-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_user_id: session.user.id,
        email: session.user.email,
        first_name: firstName.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        invite_code: inviteCode,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error || 'Une erreur est survenue');
      return;
    }

    // Parcours de première connexion (22/10/2026) : le commercial invité voit
    // Bienvenue, Boîte mail et Fin (son entreprise a déjà sa fiche).
    router.push('/app/bienvenue');
  }

  if (checking) {
    return (
      <div className="wrap">
        <p className="loading-text">{st('loading', locale)}</p>
        <style jsx>{`
          .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; }
          .loading-text { color: #8b90a8; font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  if (native) {
    return (
      <div className="wrap">
        <div className="card">
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>{st('welcome', locale)}</h1>
          <p className="subtitle">{t('native.signupNotInApp', locale)}</p>
          <button type="button" className="role-btn" onClick={() => router.push('/login')}>
            <span className="role-title">{t('auth.signIn', locale)}</span>
          </button>
        </div>
        <style jsx>{`
          .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; padding: 1.5rem; }
          .card { max-width: 420px; width: 100%; text-align: center; background: #141a2e; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 2rem 1.5rem; color: #f3f4f8; font-family: 'Inter', sans-serif; }
          .logo { width: 56px; height: 56px; border-radius: 14px; margin-bottom: 1rem; }
          h1 { font-size: 1.3rem; margin: 0 0 0.6rem; }
          .subtitle { color: #a3a9c2; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.4rem; }
          .role-btn { width: 100%; background: #5b6cff; border: none; color: #fff; border-radius: 10px; padding: 0.8rem 1rem; font-weight: 600; font-size: 0.95rem; cursor: pointer; }
        `}</style>
      </div>
    );
  }

  if (!personRole || (personRole === 'commercial' && !signupPath)) {
    // Deux questions successives (retour Alex 25/08) : d'abord QUI (fondateur/
    // dirigeant(e) vs commercial(e) — détermine le rôle en base, donc si "Mon
    // équipe" apparaît dans le menu), puis, seulement pour un commercial,
    // COMMENT il/elle rejoint Meet Aaron (code d'activation de son
    // entreprise, ou son propre espace payant s'il n'en a pas).
    const askingSignupPath = personRole === 'commercial' && !signupPath;
    return (
      <div className="wrap">
        <div className="card">
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>{st('welcome', locale)}</h1>

          {!askingSignupPath ? (
            <>
              <p className="subtitle">{st('who', locale)}</p>

              <button type="button" className="role-btn" onClick={() => setPersonRole('patron')}>
                <span className="role-title">{st('rolePatron', locale)}</span>
                <span className="role-desc">{st('rolePatronDesc', locale)}</span>
              </button>

              <button type="button" className="role-btn" onClick={() => setPersonRole('commercial')}>
                <span className="role-title">{st('roleCommercial', locale)}</span>
                <span className="role-desc">{st('roleCommercialDesc', locale)}</span>
              </button>
            </>
          ) : (
            <>
              <p className="subtitle">{st('lastDetail', locale)}</p>

              {/* Distinct de "Je suis commercial(e)" ci-dessus : avant, ce
                  choix ÉTAIT la question "qui êtes-vous", ce qui empêchait
                  un commercial solo (sans code, payant lui-même) de
                  simplement se déclarer commercial — il devait mentir et
                  se dire "dirigeant(e)" pour pouvoir payer. */}
              <button type="button" className="role-btn" onClick={() => setSignupPath('invite_code')}>
                <span className="role-title">{st('pathCode', locale)}</span>
                <span className="role-desc">{st('pathCodeDesc', locale)}</span>
              </button>

              <button type="button" className="role-btn" onClick={() => setSignupPath('own_space')}>
                <span className="role-title">{st('pathOwn', locale)}</span>
                <span className="role-desc">{st('pathOwnDesc', locale)}</span>
              </button>

              <button type="button" className="link-back" onClick={() => setPersonRole(null)}>
                {st('back', locale)}
              </button>
            </>
          )}
        </div>

        <style jsx>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
          .wrap {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0b0e1a;
            font-family: 'Inter', sans-serif;
            padding: 2rem 1rem;
          }
          .card {
            background: #131629;
            border: 1px solid #232744;
            border-radius: 16px;
            padding: 2.2rem;
            width: 420px;
            max-width: 100%;
          }
          .logo {
            width: 44px;
            height: 44px;
            border-radius: 11px;
            margin-bottom: 1rem;
          }
          h1 {
            font-family: 'Space Grotesk', sans-serif;
            color: #f4f1ea;
            font-size: 1.35rem;
            margin: 0 0 0.4rem;
          }
          .subtitle {
            color: #8b90a8;
            font-size: 0.86rem;
            margin: 0 0 1.4rem;
          }
          .role-btn {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.3rem;
            width: 100%;
            background: #0b0e1a;
            border: 1px solid #232744;
            border-radius: 10px;
            padding: 1rem 1.1rem;
            margin-bottom: 0.8rem;
            cursor: pointer;
            text-align: left;
            transition: border-color 0.15s ease;
          }
          .role-btn:hover {
            border-color: #4b39ef;
          }
          .role-title {
            color: #f4f1ea;
            font-weight: 600;
            font-size: 0.92rem;
          }
          .role-desc {
            color: #8b90a8;
            font-size: 0.8rem;
          }
        `}</style>
      </div>
    );
  }

  // PRIX AFFICHE (17/09/2026). Il etait ecrit « 30€ / mois » en dur alors que
  // le catalogue Stripe est passe a 59 EUR HT — afficher un prix et en
  // prelever un autre n'est pas un detail cosmetique. La valeur vient
  // desormais de lib/boost-tiers.ts : un seul endroit a tenir synchronise
  // avec le catalogue Stripe.
  //
  // La devise suit le pays saisi juste au-dessus dans le formulaire : sinon un
  // Australien voit « 30 € » pendant toute l'inscription puis un montant en
  // dollars australiens au Checkout. C'est de l'AFFICHAGE — le montant reel
  // vient du Price Stripe multi-devises, choisi d'apres l'adresse de
  // facturation saisie au Checkout.
  const billingCurrency = currencyForCountryText(country);
  const monthlyPriceLabel = formatBoostPrice(subscriptionPrice(billingCurrency), billingCurrency);
  const yearlyLabel = formatBoostPrice(yearlyPrice(billingCurrency), billingCurrency);
  const yearlyPerMonthLabel = formatBoostPrice(yearlyPerMonth(billingCurrency), billingCurrency);

  return (
    <div className="wrap">
      {signupPath !== 'invite_code' ? (
        <form className="card" onSubmit={handlePatronSubmit}>
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>{st('createTitle', locale)}</h1>
          <p className="subtitle">{st('createSub', locale)}</p>

          <div className="name-row">
            <label>
              {st('firstName', locale)}
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: Aaron" required />
            </label>
            <label>
              {st('lastName', locale)}
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Martin" required />
            </label>
          </div>

          <label>
            {st('companyName', locale)}
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ex: Dupont SARL" required />
          </label>
          {/* Précision ajoutée le 25/08 : un commercial solo qui découvre ce
              champ juste après avoir cliqué "Je crée mon espace Meet Aaron"
              peut se demander s'il a le droit de continuer alors qu'il n'a
              pas de société au sens juridique — on lève l'ambiguïté ici. */}
          <p className="field-hint">{st('companyHint', locale)}</p>

          <label>
            {st('country', locale)}
            <input
              value={country}
              onChange={(e) => {
                const next = e.target.value;
                setCountry(next);
                // Docx « derniers ajouts » (05/09/2026) : le pays choisit la
                // langue de l'app (France → français, UK → anglais…). On ne
                // change rien si le pays n'est pas reconnu — et l'utilisateur
                // garde le sélecteur de langue de l'app pour corriger.
                const guessed = localeForCountry(next);
                if (guessed && guessed !== locale) setLocale(guessed);
              }}
              list="country-suggestions"
              placeholder={st('countryPh', locale)}
              autoComplete="country-name"
              required
            />
            <datalist id="country-suggestions">
              {(st('countries', locale) || COUNTRY_SUGGESTIONS).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          {/* Abonnement unique Aaron (docx Modifs Aaron 30/08/2026 + décision
              Alex 31/08/2026) : plus de choix de modules à l'inscription —
              une seule offre à 30 €/mois qui inclut prospection,
              opportunités et suivi client. selectedModules reste ['AP']
              (le prix Aaron côté Stripe est l'ancien prix "AP"). */}
          <div className="modules-field">
            <span className="modules-label">{st('subscription', locale)}</span>
            <div className="modules-grid">
              <div className="module-card selected">
                <div className="module-toggle" aria-pressed="true">
                  <span className="module-check" aria-hidden="true"><Ic name="check" size={12} strokeWidth={3} /></span>
                  <span className="module-main">
                    <span className="module-title-row">
                      <span className="module-title">Aaron</span>
                    </span>
                    <span className="module-desc">{st('offerDesc', locale)}</span>
                  </span>
                  <span className="module-price">{billing === 'year' && yearlyOffered ? `${yearlyPerMonthLabel} ${t('onboarding.perMonth', locale)}` : `${monthlyPriceLabel} ${t('onboarding.perMonth', locale)}`}</span>
                </div>
              </div>
            </div>
            {yearlyOffered && (
              <div className="billing-switch" role="radiogroup" aria-label={bt('label', locale)}>
                <button type="button" className={`billing-opt${billing === 'month' ? ' on' : ''}`} role="radio" aria-checked={billing === 'month'} onClick={() => setBilling('month')}>
                  <strong>{bt('monthly', locale)}</strong>
                  <span>{monthlyPriceLabel} {t('onboarding.perMonth', locale)}</span>
                </button>
                <button type="button" className={`billing-opt${billing === 'year' ? ' on' : ''}`} role="radio" aria-checked={billing === 'year'} onClick={() => setBilling('year')}>
                  <strong>{bt('yearly', locale)} <em>{bt('save', locale)}</em></strong>
                  <span>{yearlyPerMonthLabel} {t('onboarding.perMonth', locale)} · {bt('billed', locale).replace('{total}', yearlyLabel)}</span>
                </button>
              </div>
            )}
            <p className="modules-hint">{st('offerHint', locale)}</p>
          </div>

          {/* Rassurance avant la case a cocher.
              17/09/2026 (demande Alex) : l'ancienne version nommait les
              prestataires techniques (Supabase / GitHub / Vercel). Retiree —
              ce niveau de detail a sa place dans la politique de
              confidentialite, pas sur un ecran de vente : citer trois
              fournisseurs inconnus du lecteur inquiete plus qu'il ne rassure,
              et alourdit l'ecran juste avant le paiement. On garde la
              promesse (securite + maitrise de ses donnees) et on renvoie vers
              les documents legaux, comme sur /login.
              Traduit dans les 7 langues : cet ecran precede le checkout, il
              ne doit pas etre le seul endroit en francais. */}
          <p className="field-hint">{t('onboarding.securityNotice', locale)}</p>
          <p className="legal-links">
            <span>{t('onboarding.securityMore', locale)}</span>{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {t('preferences.legalPrivacy', locale)}
            </a>
            <span aria-hidden="true"> · </span>
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              {t('preferences.legalTerms', locale)}
            </a>
          </p>

          <label className="checkbox-row">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>{st('attest', locale)}</span>
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting || selectedModules.length === 0}>
            {submitting ? st('redirecting', locale) : st('continuePay', locale)}
          </button>

          <button
            type="button"
            className="link-back"
            onClick={() => {
              if (personRole === 'patron') {
                setPersonRole(null);
              } else {
                setSignupPath(null);
              }
              setError(null);
            }}
          >
            {st('back', locale)}
          </button>
        </form>
      ) : (
        <form className="card" onSubmit={handleJoinCompany}>
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>{st('joinTitle', locale)}</h1>
          <p className="subtitle">{st('joinSub', locale)}</p>

          <div className="name-row">
            <label>
              {st('firstName', locale)}
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: Aaron" required />
            </label>
            <label>
              {st('lastName', locale)}
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Martin" required />
            </label>
          </div>

          <label>
            {st('inviteCode', locale)}
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="ex: OPENX-7K3F"
              style={{ textTransform: 'uppercase' }}
              required
            />
          </label>
          {/* Précision ajoutée le 25/08 (retour Alex) : "code d'invitation"
              seul n'était pas assez explicite sur ce qu'il fait concrètement
              (rejoindre un abonnement déjà payé par l'entreprise). */}
          <p className="field-hint">{st('inviteHint', locale)}</p>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? st('connecting', locale) : st('join', locale)}
          </button>

          {/* Échappatoire ajoutée le 25/08 : avant, quelqu'un arrivant ici
              sans code (cas Alex — commercial solo testant sans code
              d'entreprise) n'avait pas d'autre choix que "← Retour" puis
              redevine tout seul qu'il fallait cliquer l'autre bouton. */}
          <button type="button" className="link-secondary" onClick={() => { setSignupPath('own_space'); setError(null); }}>
            {st('noCode', locale)}
          </button>

          <button type="button" className="link-back" onClick={() => { setSignupPath(null); setError(null); }}>
            {st('back', locale)}
          </button>
        </form>
      )}

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          font-family: 'Inter', sans-serif;
          padding: 2rem 1rem;
        }
        .card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 16px;
          padding: 2.2rem;
          width: 420px;
          max-width: 100%;
        }
        .logo {
          width: 44px;
          height: 44px;
          border-radius: 11px;
          margin-bottom: 1rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-size: 1.35rem;
          margin: 0 0 0.4rem;
        }
        .subtitle {
          color: #8b90a8;
          font-size: 0.86rem;
          margin: 0 0 1.4rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: #8b90a8;
          margin-bottom: 1rem;
        }
        .name-row {
          display: flex;
          gap: 0.7rem;
        }
        .name-row label {
          flex: 1;
          min-width: 0;
        }
        input[type='text'], input:not([type]) {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: #f4f1ea;
          font-size: 0.88rem;
        }
        .field-hint {
          font-size: 0.78rem;
          color: #8b90a8;
          margin: -0.7rem 0 1rem;
          line-height: 1.4;
        }
        .legal-links {
          font-size: 0.78rem;
          color: #8b90a8;
          margin: -0.6rem 0 1.1rem;
          line-height: 1.5;
        }
        .legal-links a {
          color: #8b90a8;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .legal-links a:hover {
          color: #cfd3e6;
        }
        .modules-field {
          margin-bottom: 1.2rem;
        }
        .modules-label {
          display: block;
          font-size: 0.82rem;
          color: #8b90a8;
          margin-bottom: 0.5rem;
        }
        .modules-hint {
          font-size: 0.8rem;
          color: #8b90a8;
          margin: 0 0 0.7rem;
          line-height: 1.4;
        }
        .modules-grid {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .module-card {
          border-radius: 10px;
          overflow: hidden;
        }
        .module-toggle {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          width: 100%;
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 10px;
          padding: 0.7rem 0.9rem;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .module-card.selected .module-toggle {
          border-color: #4b39ef;
          background: rgba(75, 57, 239, 0.12);
        }
        .module-check {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border-radius: 6px;
          border: 1px solid #232744;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4b39ef;
          font-size: 0.8rem;
          font-weight: 700;
        }
        .module-card.selected .module-check {
          border-color: #4b39ef;
          background: #4b39ef;
          color: white;
        }
        .module-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .module-title-row {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .module-title {
          color: #f4f1ea;
          font-weight: 600;
          font-size: 0.88rem;
        }
        .info-btn {
          flex-shrink: 0;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 1px solid #8b90a8;
          background: none;
          color: #8b90a8;
          font-size: 0.66rem;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }
        .info-btn:hover {
          border-color: #4b39ef;
          color: #4b39ef;
        }
        .module-desc {
          color: #8b90a8;
          font-size: 0.76rem;
        }
        .billing-switch {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
          margin-top: 0.7rem;
        }
        .billing-opt {
          text-align: left;
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 10px;
          padding: 0.7rem 0.85rem;
          color: #e6e8f2;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font: inherit;
        }
        .billing-opt.on { border-color: #4b39ef; box-shadow: 0 0 0 1px #4b39ef inset; }
        .billing-opt strong { font-size: 0.88rem; }
        .billing-opt strong em { font-style: normal; font-size: 0.7rem; color: #3dd68c; margin-left: 0.4rem; }
        .billing-opt span { font-size: 0.78rem; color: #8b90a8; }
        .module-price {
          flex-shrink: 0;
          color: #4b39ef;
          font-weight: 700;
          font-size: 0.86rem;
        }
        .module-info {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-top: none;
          border-radius: 0 0 10px 10px;
          margin: 0;
          padding: 0.6rem 0.9rem 0.7rem;
          color: #8b90a8;
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .modules-total {
          text-align: right;
          color: #8b90a8;
          font-size: 0.78rem;
          margin: 0.6rem 0 0;
        }
        .checkbox-row {
          flex-direction: row;
          align-items: flex-start;
          gap: 0.6rem;
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .checkbox-row input {
          margin-top: 0.2rem;
          flex-shrink: 0;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
          margin-bottom: 1rem;
        }
        .btn-primary {
          width: 100%;
          background: #4b39ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .link-back {
          display: block;
          width: 100%;
          text-align: center;
          background: none;
          border: none;
          color: #8b90a8;
          font-size: 0.78rem;
          cursor: pointer;
          margin-top: 0.9rem;
          text-decoration: underline;
        }
        .link-secondary {
          display: block;
          width: 100%;
          text-align: center;
          background: none;
          border: none;
          color: #7c8cff;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          margin-top: 1rem;
        }
        .link-secondary:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
