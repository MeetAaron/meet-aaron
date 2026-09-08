'use client';
// app/privacy/page.jsx
//
// Politique de confidentialité — page publique, servie en clair sur
// https://meetaaron.app/privacy sans authentification.
//
// Refonte du 07/09/2026 (demande Alex : « quand on va ajouter iOS et Android,
// il faut s'assurer que la privacy policy soit à jour »). Trois lecteurs
// exigeants pour cette page, chacun avec ses propres attentes :
//   - Google (vérification OAuth, scopes Gmail restreints) : la clause
//     Limited Use en anglais, mot pour mot, et la cohérence entre ce qui est
//     déclaré ici et ce que fait réellement l'application.
//   - Apple App Store et Google Play : une politique accessible par URL, qui
//     nomme les prestataires, précise la conservation, et — exigence Google
//     Play — décrit comment supprimer son compte (section « Supprimer votre
//     compte », ancre #delete-account).
//   - Le RGPD : responsable de traitement identifié, bases légales, transferts
//     hors UE, droits des personnes — y compris ceux des PROSPECTS, qui ne
//     sont pas nos utilisateurs mais dont on traite les données.
//
// SEPT LANGUES (demande Alex, 08/09/2026 : « fais-la dans toutes les langues
// qu'on avait parlé »). D'où la réécriture en DONNÉES plutôt qu'en JSX : sept
// versions écrites à la main en JSX, c'est 1 300 lignes que personne ne
// maintiendra, et la garantie qu'une correction n'est appliquée qu'à deux ou
// trois d'entre elles. Ici chaque version est un objet {title, updated, intro,
// sections, footer} de forme identique, rendu par un composant unique : une
// section ajoutée ou corrigée se voit immédiatement manquante ailleurs.
//
// Le français et l'anglais sont les versions de RÉFÉRENCE (ce sont celles que
// lisent les relecteurs Google et Apple, et celles rédigées en premier). Les
// cinq autres sont des traductions de confort et le disent explicitement dans
// leur note de bas de page : en cas de divergence, l'anglais fait foi. Sans
// cette clause, sept textes juridiques légèrement différents créeraient une
// ambiguïté sur celui qui engage réellement l'éditeur.
//
// Le rendu (parseur **gras** / [lien](url), mise en forme, repli de langue)
// est partagé avec /terms dans components/LegalPage.jsx — cette page ne
// contient plus que ses textes.
//
// Le texte est la source de vérité : ne rien y écrire que le code ne fasse pas
// réellement.
import { useLocale } from '@/lib/i18n';
import LegalPage, { GOOGLE_LIMITED_USE, MAIL } from '@/components/LegalPage';

const fr = {
  title: 'Politique de confidentialité',
  updated: 'Dernière mise à jour : 8 septembre 2026',
  intro: [
    "Meet Aaron (« nous », « le service ») est un assistant commercial fondé sur l'intelligence artificielle, accessible sur meetaaron.app et, à terme, via ses applications mobiles. Cette politique explique quelles données nous traitons, pourquoi, avec qui, et comment vous gardez la main dessus.",
  ],
  sections: [
    {
      h: '1. Qui est responsable',
      b: [
        `Le service est édité par **MEET AARON**, entreprise individuelle d'Alexandre Fevre, immatriculée en Australie sous l'ABN 72 369 751 951, établie à Perth (Australie-Occidentale). Contact pour toute question relative à vos données : ${MAIL}.`,
        "Pour les données de votre compte (identité, connexion, facturation, usage du service), Meet Aaron est **responsable du traitement**. Pour les données de vos prospects et de vos échanges avec eux, c'est **vous** — ou votre entreprise — qui êtes responsable du traitement, et Meet Aaron agit comme **sous-traitant**, sur vos instructions.",
      ],
    },
    {
      h: '2. Qui utilise Meet Aaron',
      b: [
        "Meet Aaron est un outil strictement professionnel (B2B), destiné aux commerciaux et à leurs entreprises. Il n'est pas conçu pour un usage personnel ni pour des mineurs, et nous ne collectons pas sciemment de données de personnes de moins de 18 ans.",
      ],
    },
    {
      h: '3. Les données que nous traitons',
      b: [
        ['ul', [
          '**Votre compte** : nom, adresse email, société, langue, préférences.',
          "**Votre messagerie** : lorsque vous connectez Gmail ou Outlook, Aaron lit les réponses de vos prospects à vos emails de prospection, envoie des emails en votre nom, et pose un libellé « Géré par Aaron » sur les fils qu'il traite. Il ne lit pas votre boîte dans son ensemble : seulement les conversations qu'il a lui-même ouvertes.",
          "**Votre agenda** : Aaron crée des rendez-vous dans Google Agenda ou Outlook quand un prospect accepte un créneau, et consulte vos événements pour éviter les doublons. Il ne touche jamais aux paramètres ni au partage de votre agenda.",
          "**Vos prospects** : nom, fonction, email, téléphone, société, et le contenu des échanges. Ces données viennent de vous (import de fichier), de sources publiques d'entreprises (voir section 5), ou des réponses des prospects eux-mêmes.",
          "**Vos documents** (devis types, tarifs, plaquettes), pour qu'Aaron adapte ses messages à votre métier.",
          '**Votre facturation** : traitée par Stripe ; nous ne stockons aucun numéro de carte.',
          "**Les notifications** : si vous les activez, un identifiant technique d'abonnement push par appareil.",
          "**Les données techniques** habituelles (adresse IP, navigateur, journaux d'erreurs), nécessaires au fonctionnement et à la sécurité.",
        ]],
      ],
    },
    {
      h: '4. Pourquoi nous les traitons',
      b: [
        'Uniquement pour :',
        ['ul', [
          'faire fonctionner la prospection que vous avez configurée, et rien d’autre ;',
          'rédiger des emails et des réponses à l’aide de modèles d’intelligence artificielle ;',
          'afficher votre pipeline, vos statistiques et l’historique de vos échanges ;',
          'vous prévenir (rendez-vous, réponses, budget) ;',
          'facturer votre abonnement et sécuriser le service.',
        ]],
        "Bases légales : l'exécution du contrat qui nous lie (votre abonnement), notre intérêt légitime à sécuriser et améliorer le service, et votre consentement pour les accès à votre messagerie et à votre agenda, que vous pouvez retirer à tout moment.",
        "Nous ne vendons jamais vos données ni celles de vos prospects, et n'en faisons aucun usage publicitaire.",
      ],
    },
    {
      h: '5. Avec qui les données transitent',
      b: [
        'Pour faire fonctionner le service, nous nous appuyons sur des prestataires techniques :',
        ['ul', [
          "**Anthropic** (États-Unis) et **OpenAI** (États-Unis) — modèles d'intelligence artificielle qui rédigent et classent les messages. Ces prestataires n'utilisent pas vos données pour entraîner leurs modèles et ne les conservent que temporairement, à des fins de sécurité.",
          '**Google** et **Microsoft** — Gmail, Outlook et agendas, uniquement dans la limite des accès que vous autorisez.',
          '**Supabase** — base de données et stockage des fichiers.',
          "**Vercel** (États-Unis) — hébergement de l'application.",
          '**Stripe** — paiements et facturation.',
        ]],
        "Pour trouver et vérifier des entreprises, Aaron consulte aussi des **sources publiques** : registres officiels (INSEE-SIRENE en France, Companies House au Royaume-Uni, ABN Lookup en Australie) et annuaires d'établissements sous licence ouverte. Ces sources ne reçoivent aucune donnée de votre part.",
        "Certains prestataires sont établis hors de l'Union européenne, principalement aux États-Unis. Ces transferts reposent sur les clauses contractuelles types de la Commission européenne et, le cas échéant, sur le Data Privacy Framework.",
      ],
    },
    {
      h: '6. Utilisation limitée des données Google et Microsoft',
      b: [
        GOOGLE_LIMITED_USE,
        'Le même engagement s’applique aux données reçues des API Microsoft. Concrètement, le contenu de votre messagerie et de votre agenda :',
        ['ul', [
          'ne sert qu’à fournir les fonctions que vous avez activées dans l’application ;',
          'n’est jamais vendu, ni transmis à des tiers pour leurs propres fins, ni utilisé pour de la publicité ;',
          'n’est jamais utilisé pour entraîner ou améliorer un modèle d’intelligence artificielle ;',
          'n’est lu par un humain que si vous nous le demandez expressément pour résoudre un problème, si la loi nous y oblige, ou pour des raisons de sécurité.',
        ]],
      ],
    },
    {
      h: '7. Les droits de vos prospects',
      b: [
        `Chaque email de prospection envoyé par Aaron indique à son destinataire qu'il peut, par une simple réponse, demander à ne plus être contacté ; Aaron enregistre cette demande et cesse le contact. Un prospect peut aussi exercer ses droits d'accès, de rectification ou d'effacement en écrivant à ${MAIL} — nous transmettons la demande à l'entreprise responsable et l'aidons à y répondre.`,
      ],
    },
    {
      h: '8. Conservation',
      b: [
        "Vos données sont conservées tant que votre compte est actif, puis supprimées dans les 30 jours suivant sa fermeture, à l'exception des données de facturation que la loi nous impose de garder. Les jetons d'accès à votre messagerie sont supprimés dès que vous déconnectez le compte concerné.",
      ],
    },
    {
      id: 'delete-account',
      h: '9. Supprimer votre compte',
      b: [
        `Vous pouvez supprimer votre compte et l'ensemble des données associées vous-même, sans nous contacter : dans l'application, ouvrez **Mon compte**, puis l'onglet **Supprimer mon compte**, et confirmez. La suppression est définitive et effective sous 30 jours. Si vous n'avez plus accès à l'application, écrivez à ${MAIL} depuis l'adresse de votre compte.`,
      ],
    },
    {
      h: '10. Sécurité',
      b: [
        "Les jetons d'accès à vos comptes Gmail et Outlook sont chiffrés avant stockage. L'accès à la base de données est restreint, journalisé, et les échanges avec nos prestataires se font exclusivement par connexions chiffrées.",
      ],
    },
    {
      h: '11. Cookies et suivi',
      b: [
        "Nous n'utilisons que les cookies strictement nécessaires au fonctionnement (session, préférences). Aucun cookie publicitaire, aucun traqueur tiers.",
      ],
    },
    {
      h: '12. Vos droits',
      b: [
        "Vous pouvez à tout moment consulter, corriger, exporter ou supprimer vos données, et déconnecter Meet Aaron de votre Gmail ou Outlook depuis l'écran **Connexions** — ou révoquer l'accès directement depuis les paramètres de sécurité de votre compte Google ou Microsoft. Vous pouvez aussi vous adresser à l'autorité de protection des données de votre pays (en France, la CNIL).",
      ],
    },
    {
      h: '13. Contact et évolutions',
      b: [
        `Pour toute question : ${MAIL}. Cette politique peut évoluer ; nous vous informerons de tout changement important, dans l'application ou par email.`,
      ],
    },
  ],
  footer: 'Voir aussi nos [conditions générales d’utilisation](/terms).',
};

const en = {
  title: 'Privacy Policy',
  updated: 'Last updated: 8 September 2026',
  intro: [
    'Meet Aaron ("we", "the service") is an AI-powered sales assistant available at meetaaron.app and, in due course, through its mobile apps. This policy explains what data we process, why, with whom, and how you stay in control of it.',
  ],
  sections: [
    {
      h: '1. Who is responsible',
      b: [
        `The service is published by **MEET AARON**, the sole-trader business of Alexandre Fevre, registered in Australia under ABN 72 369 751 951 and based in Perth, Western Australia. Contact for any data-related question: ${MAIL}.`,
        'For your account data (identity, sign-in, billing, usage), Meet Aaron is the **data controller**. For the data of your prospects and your exchanges with them, **you** — or your company — are the controller, and Meet Aaron acts as your **processor**, on your instructions.',
      ],
    },
    {
      h: '2. Who uses Meet Aaron',
      b: [
        'Meet Aaron is a strictly professional (B2B) tool for salespeople and their companies. It is not designed for personal use or for minors, and we do not knowingly collect data from anyone under 18.',
      ],
    },
    {
      h: '3. The data we process',
      b: [
        ['ul', [
          '**Your account**: name, email address, company, language, preferences.',
          '**Your mailbox**: when you connect Gmail or Outlook, Aaron reads the replies prospects send to your outreach emails, sends emails on your behalf, and applies a "Managed by Aaron" label to the threads it handles. It does not read your mailbox at large — only the conversations it started itself.',
          '**Your calendar**: Aaron creates events in Google Calendar or Outlook when a prospect accepts a meeting slot, and reads your events to avoid double-booking. It never touches calendar settings or sharing.',
          "**Your prospects**: name, job title, email, phone, company, and the content of the exchanges. This data comes from you (file import), from public company sources (see section 5), or from the prospects' own replies.",
          '**Your documents** (sample quotes, price lists, brochures), so Aaron can tailor its messages to your business.',
          '**Billing**: handled by Stripe; we never store card numbers.',
          '**Notifications**: if you enable them, a technical push-subscription identifier per device.',
          '**Technical data** (IP address, browser, error logs) needed to run and secure the service.',
        ]],
      ],
    },
    {
      h: '4. Why we process it',
      b: [
        'Solely to:',
        ['ul', [
          'run the outreach you configured, and nothing else;',
          'draft emails and replies using artificial-intelligence models;',
          'display your pipeline, statistics and conversation history;',
          'notify you (meetings, replies, budget);',
          'bill your subscription and secure the service.',
        ]],
        'Legal bases: performance of our contract with you (your subscription), our legitimate interest in securing and improving the service, and your consent for access to your mailbox and calendar, which you can withdraw at any time.',
        "We never sell your data or your prospects' data, and never use it for advertising.",
      ],
    },
    {
      h: '5. Who the data passes through',
      b: [
        'To run the service we rely on technical providers:',
        ['ul', [
          '**Anthropic** (United States) and **OpenAI** (United States) — AI models that draft and classify messages. These providers do not use your data to train their models and retain it only temporarily, for safety purposes.',
          '**Google** and **Microsoft** — Gmail, Outlook and calendars, strictly within the access you grant.',
          '**Supabase** — database and file storage.',
          '**Vercel** (United States) — application hosting.',
          '**Stripe** — payments and invoicing.',
        ]],
        'To find and verify companies, Aaron also consults **public sources**: official registers (INSEE-SIRENE in France, Companies House in the United Kingdom, ABN Lookup in Australia) and openly-licensed business directories. No data of yours is sent to these sources.',
        "Some providers are located outside the European Union, mainly in the United States. These transfers rely on the European Commission's Standard Contractual Clauses and, where applicable, the Data Privacy Framework.",
      ],
    },
    {
      h: '6. Limited use of Google and Microsoft data',
      b: [
        GOOGLE_LIMITED_USE,
        'The same commitment applies to data received from Microsoft APIs. In practice, the content of your mailbox and calendar:',
        ['ul', [
          'is used only to provide the features you enabled in the application;',
          'is never sold, shared with third parties for their own purposes, or used for advertising;',
          'is never used to train or improve any artificial-intelligence model;',
          'is read by a human only if you expressly ask us to, to resolve a problem, if the law requires it, or for security reasons.',
        ]],
      ],
    },
    {
      h: "7. Your prospects' rights",
      b: [
        `Every outreach email Aaron sends tells its recipient that a simple reply is enough to ask not to be contacted again; Aaron records that request and stops. A prospect can also exercise their rights of access, rectification or erasure by writing to ${MAIL} — we forward the request to the responsible company and help it respond.`,
      ],
    },
    {
      h: '8. Retention',
      b: [
        'Your data is kept while your account is active, then deleted within 30 days of closure, except billing records we are legally required to keep. Mailbox access tokens are deleted as soon as you disconnect the account concerned.',
      ],
    },
    {
      id: 'delete-account',
      h: '9. Delete your account',
      b: [
        `You can delete your account and all associated data yourself, without contacting us: in the app, open **My account**, then the **Delete my account** tab, and confirm. Deletion is permanent and takes effect within 30 days. If you no longer have access to the app, email ${MAIL} from your account address.`,
      ],
    },
    {
      h: '10. Security',
      b: [
        'Access tokens for your Gmail and Outlook accounts are encrypted before storage. Database access is restricted and logged, and all exchanges with our providers use encrypted connections.',
      ],
    },
    {
      h: '11. Cookies and tracking',
      b: [
        'We only use cookies strictly necessary to operate the service (session, preferences). No advertising cookies, no third-party trackers.',
      ],
    },
    {
      h: '12. Your rights',
      b: [
        "You can at any time view, correct, export or delete your data, and disconnect Meet Aaron from your Gmail or Outlook from the **Connections** screen — or revoke access directly from your Google or Microsoft account's security settings. You may also contact your country's data-protection authority.",
      ],
    },
    {
      h: '13. Contact and changes',
      b: [
        `Any question: ${MAIL}. This policy may change; we will inform you of any material change in the app or by email.`,
      ],
    },
  ],
  footer: 'See also our [terms of service](/terms).',
};

const de = {
  title: 'Datenschutzerklärung',
  updated: 'Zuletzt aktualisiert: 8. September 2026',
  intro: [
    'Meet Aaron („wir“, „der Dienst“) ist ein KI-gestützter Vertriebsassistent, erreichbar unter meetaaron.app und künftig über seine mobilen Apps. Diese Erklärung beschreibt, welche Daten wir verarbeiten, wozu, mit wem, und wie Sie die Kontrolle darüber behalten.',
  ],
  sections: [
    {
      h: '1. Wer verantwortlich ist',
      b: [
        `Der Dienst wird herausgegeben von **MEET AARON**, dem Einzelunternehmen von Alexandre Fevre, in Australien unter der ABN 72 369 751 951 eingetragen, mit Sitz in Perth (Westaustralien). Kontakt für alle Fragen zu Ihren Daten: ${MAIL}.`,
        'Für Ihre Kontodaten (Identität, Anmeldung, Abrechnung, Nutzung) ist Meet Aaron **Verantwortlicher** im Sinne der DSGVO. Für die Daten Ihrer Interessenten und Ihren Schriftwechsel mit ihnen sind **Sie** — oder Ihr Unternehmen — der Verantwortliche, und Meet Aaron handelt als **Auftragsverarbeiter** nach Ihren Weisungen.',
      ],
    },
    {
      h: '2. Wer Meet Aaron nutzt',
      b: [
        'Meet Aaron ist ein rein berufliches Werkzeug (B2B) für Vertriebsmitarbeitende und ihre Unternehmen. Es ist weder für die private Nutzung noch für Minderjährige bestimmt, und wir erheben wissentlich keine Daten von Personen unter 18 Jahren.',
      ],
    },
    {
      h: '3. Welche Daten wir verarbeiten',
      b: [
        ['ul', [
          '**Ihr Konto**: Name, E-Mail-Adresse, Unternehmen, Sprache, Einstellungen.',
          '**Ihr Postfach**: Wenn Sie Gmail oder Outlook verbinden, liest Aaron die Antworten Ihrer Interessenten auf Ihre Akquise-E-Mails, versendet E-Mails in Ihrem Namen und versieht die bearbeiteten Konversationen mit der Kennzeichnung „Von Aaron betreut“. Aaron liest nicht Ihr gesamtes Postfach, sondern ausschließlich die Konversationen, die er selbst begonnen hat.',
          '**Ihr Kalender**: Aaron legt Termine in Google Kalender oder Outlook an, wenn ein Interessent einen Terminvorschlag annimmt, und sieht Ihre Termine ein, um Doppelbuchungen zu vermeiden. Einstellungen und Freigaben Ihres Kalenders bleiben unangetastet.',
          '**Ihre Interessenten**: Name, Funktion, E-Mail, Telefon, Unternehmen sowie der Inhalt des Schriftwechsels. Diese Daten stammen von Ihnen (Dateiimport), aus öffentlichen Unternehmensquellen (siehe Abschnitt 5) oder aus den Antworten der Interessenten selbst.',
          '**Ihre Dokumente** (Musterangebote, Preislisten, Broschüren), damit Aaron seine Nachrichten auf Ihr Geschäft abstimmen kann.',
          '**Ihre Abrechnung**: über Stripe abgewickelt; wir speichern keine Kartennummern.',
          '**Benachrichtigungen**: sofern aktiviert, eine technische Push-Abonnement-Kennung je Gerät.',
          '**Technische Daten** (IP-Adresse, Browser, Fehlerprotokolle), die für Betrieb und Sicherheit erforderlich sind.',
        ]],
      ],
    },
    {
      h: '4. Wozu wir sie verarbeiten',
      b: [
        'Ausschließlich, um:',
        ['ul', [
          'die von Ihnen eingerichtete Akquise auszuführen, und nichts anderes;',
          'E-Mails und Antworten mithilfe von KI-Modellen zu verfassen;',
          'Ihre Pipeline, Ihre Statistiken und den Verlauf Ihrer Konversationen anzuzeigen;',
          'Sie zu benachrichtigen (Termine, Antworten, Budget);',
          'Ihr Abonnement abzurechnen und den Dienst abzusichern.',
        ]],
        'Rechtsgrundlagen: die Erfüllung unseres Vertrags mit Ihnen (Ihr Abonnement), unser berechtigtes Interesse an Sicherheit und Verbesserung des Dienstes sowie Ihre Einwilligung in den Zugriff auf Postfach und Kalender, die Sie jederzeit widerrufen können.',
        'Wir verkaufen weder Ihre Daten noch die Ihrer Interessenten und nutzen sie niemals für Werbezwecke.',
      ],
    },
    {
      h: '5. An wen die Daten weitergegeben werden',
      b: [
        'Für den Betrieb des Dienstes greifen wir auf technische Dienstleister zurück:',
        ['ul', [
          '**Anthropic** (USA) und **OpenAI** (USA) — KI-Modelle, die Nachrichten verfassen und einordnen. Diese Anbieter verwenden Ihre Daten nicht zum Training ihrer Modelle und speichern sie nur vorübergehend, zu Sicherheitszwecken.',
          '**Google** und **Microsoft** — Gmail, Outlook und Kalender, ausschließlich im Rahmen der von Ihnen erteilten Berechtigungen.',
          '**Supabase** — Datenbank und Dateispeicher.',
          '**Vercel** (USA) — Hosting der Anwendung.',
          '**Stripe** — Zahlungen und Rechnungsstellung.',
        ]],
        'Um Unternehmen zu finden und zu prüfen, nutzt Aaron außerdem **öffentliche Quellen**: amtliche Register (INSEE-SIRENE in Frankreich, Companies House im Vereinigten Königreich, ABN Lookup in Australien) und Branchenverzeichnisse unter offener Lizenz. An diese Quellen werden keinerlei Daten von Ihnen übermittelt.',
        'Einige Dienstleister sind außerhalb der Europäischen Union ansässig, überwiegend in den USA. Diese Übermittlungen stützen sich auf die Standardvertragsklauseln der Europäischen Kommission und, soweit einschlägig, auf das Data Privacy Framework.',
      ],
    },
    {
      h: '6. Eingeschränkte Nutzung von Google- und Microsoft-Daten',
      b: [
        GOOGLE_LIMITED_USE,
        'Dieselbe Verpflichtung gilt für Daten, die wir über Microsoft-APIs erhalten. Konkret werden die Inhalte Ihres Postfachs und Ihres Kalenders:',
        ['ul', [
          'ausschließlich verwendet, um die von Ihnen in der Anwendung aktivierten Funktionen bereitzustellen;',
          'niemals verkauft, an Dritte für deren eigene Zwecke weitergegeben oder für Werbung genutzt;',
          'niemals zum Trainieren oder Verbessern eines KI-Modells verwendet;',
          'nur dann von einem Menschen gelesen, wenn Sie uns ausdrücklich darum bitten, um ein Problem zu lösen, wenn das Gesetz es verlangt, oder aus Sicherheitsgründen.',
        ]],
      ],
    },
    {
      h: '7. Die Rechte Ihrer Interessenten',
      b: [
        `Jede von Aaron versandte Akquise-E-Mail weist den Empfänger darauf hin, dass eine einfache Antwort genügt, um nicht weiter kontaktiert zu werden; Aaron vermerkt diesen Wunsch und stellt den Kontakt ein. Ein Interessent kann seine Rechte auf Auskunft, Berichtigung oder Löschung außerdem per E-Mail an ${MAIL} geltend machen — wir leiten die Anfrage an das verantwortliche Unternehmen weiter und unterstützen es bei der Beantwortung.`,
      ],
    },
    {
      h: '8. Speicherdauer',
      b: [
        'Ihre Daten werden gespeichert, solange Ihr Konto aktiv ist, und danach innerhalb von 30 Tagen nach dessen Schließung gelöscht — mit Ausnahme der Abrechnungsdaten, zu deren Aufbewahrung wir gesetzlich verpflichtet sind. Die Zugriffstoken für Ihr Postfach werden gelöscht, sobald Sie das betreffende Konto trennen.',
      ],
    },
    {
      id: 'delete-account',
      h: '9. Ihr Konto löschen',
      b: [
        `Sie können Ihr Konto und sämtliche zugehörigen Daten selbst löschen, ohne uns zu kontaktieren: Öffnen Sie in der Anwendung **Mein Konto**, dann den Reiter **Mein Konto löschen**, und bestätigen Sie. Die Löschung ist endgültig und innerhalb von 30 Tagen wirksam. Wenn Sie keinen Zugang zur Anwendung mehr haben, schreiben Sie von der Adresse Ihres Kontos an ${MAIL}.`,
      ],
    },
    {
      h: '10. Sicherheit',
      b: [
        'Die Zugriffstoken für Ihre Gmail- und Outlook-Konten werden vor der Speicherung verschlüsselt. Der Zugriff auf die Datenbank ist beschränkt und protokolliert, und der Austausch mit unseren Dienstleistern erfolgt ausschließlich über verschlüsselte Verbindungen.',
      ],
    },
    {
      h: '11. Cookies und Tracking',
      b: [
        'Wir verwenden ausschließlich Cookies, die für den Betrieb unbedingt erforderlich sind (Sitzung, Einstellungen). Keine Werbe-Cookies, keine Tracker von Dritten.',
      ],
    },
    {
      h: '12. Ihre Rechte',
      b: [
        'Sie können Ihre Daten jederzeit einsehen, berichtigen, exportieren oder löschen und Meet Aaron im Bildschirm **Verbindungen** von Ihrem Gmail oder Outlook trennen — oder den Zugriff direkt in den Sicherheitseinstellungen Ihres Google- oder Microsoft-Kontos widerrufen. Sie können sich außerdem an die Datenschutzaufsichtsbehörde Ihres Landes wenden.',
      ],
    },
    {
      h: '13. Kontakt und Änderungen',
      b: [
        `Bei Fragen: ${MAIL}. Diese Erklärung kann sich ändern; über wesentliche Änderungen informieren wir Sie in der Anwendung oder per E-Mail.`,
      ],
    },
  ],
  footer: 'Siehe auch unsere [Nutzungsbedingungen](/terms). Diese Übersetzung dient Ihrer Bequemlichkeit; bei Abweichungen ist die englische Fassung maßgeblich.',
};

const it = {
  title: 'Informativa sulla privacy',
  updated: 'Ultimo aggiornamento: 8 settembre 2026',
  intro: [
    "Meet Aaron (« noi », « il servizio ») è un assistente commerciale basato sull'intelligenza artificiale, accessibile su meetaaron.app e, in futuro, tramite le sue applicazioni mobili. Questa informativa spiega quali dati trattiamo, perché, con chi, e come mantenete il controllo su di essi.",
  ],
  sections: [
    {
      h: '1. Chi è il titolare',
      b: [
        `Il servizio è edito da **MEET AARON**, impresa individuale di Alexandre Fevre, registrata in Australia con ABN 72 369 751 951 e con sede a Perth (Australia Occidentale). Contatto per qualsiasi questione relativa ai vostri dati: ${MAIL}.`,
        "Per i dati del vostro account (identità, accesso, fatturazione, utilizzo del servizio), Meet Aaron è **titolare del trattamento**. Per i dati dei vostri contatti commerciali e per i vostri scambi con loro, il titolare siete **voi** — o la vostra azienda — e Meet Aaron agisce come **responsabile del trattamento**, secondo le vostre istruzioni.",
      ],
    },
    {
      h: '2. Chi usa Meet Aaron',
      b: [
        "Meet Aaron è uno strumento strettamente professionale (B2B), destinato ai commerciali e alle loro aziende. Non è pensato per un uso personale né per i minori, e non raccogliamo consapevolmente dati di persone di età inferiore ai 18 anni.",
      ],
    },
    {
      h: '3. I dati che trattiamo',
      b: [
        ['ul', [
          '**Il vostro account**: nome, indirizzo email, azienda, lingua, preferenze.',
          '**La vostra casella di posta**: quando collegate Gmail o Outlook, Aaron legge le risposte dei vostri contatti alle email di prospezione, invia email a vostro nome e applica un\'etichetta « Gestito da Aaron » alle conversazioni che tratta. Non legge la vostra casella nel suo insieme: solo le conversazioni che ha aperto lui stesso.',
          '**Il vostro calendario**: Aaron crea appuntamenti in Google Calendar o Outlook quando un contatto accetta una fascia oraria, e consulta i vostri eventi per evitare sovrapposizioni. Non tocca mai le impostazioni né la condivisione del calendario.',
          '**I vostri contatti commerciali**: nome, ruolo, email, telefono, azienda e contenuto degli scambi. Questi dati provengono da voi (importazione di file), da fonti pubbliche sulle imprese (vedi sezione 5) o dalle risposte dei contatti stessi.',
          '**I vostri documenti** (preventivi tipo, listini, brochure), affinché Aaron adatti i suoi messaggi al vostro mestiere.',
          '**La vostra fatturazione**: gestita da Stripe; non conserviamo alcun numero di carta.',
          '**Le notifiche**: se le attivate, un identificativo tecnico di abbonamento push per dispositivo.',
          '**I dati tecnici** consueti (indirizzo IP, browser, registri degli errori), necessari al funzionamento e alla sicurezza.',
        ]],
      ],
    },
    {
      h: '4. Perché li trattiamo',
      b: [
        'Unicamente per:',
        ['ul', [
          'far funzionare la prospezione che avete configurato, e nulla di più;',
          "redigere email e risposte con l'aiuto di modelli di intelligenza artificiale;",
          'mostrare la vostra pipeline, le statistiche e lo storico degli scambi;',
          'avvisarvi (appuntamenti, risposte, budget);',
          'fatturare il vostro abbonamento e mettere in sicurezza il servizio.',
        ]],
        "Basi giuridiche: l'esecuzione del contratto che ci lega (il vostro abbonamento), il nostro legittimo interesse a proteggere e migliorare il servizio, e il vostro consenso per l'accesso alla casella di posta e al calendario, revocabile in qualsiasi momento.",
        'Non vendiamo mai i vostri dati né quelli dei vostri contatti, e non ne facciamo alcun uso pubblicitario.',
      ],
    },
    {
      h: '5. Con chi transitano i dati',
      b: [
        'Per far funzionare il servizio ci avvaliamo di fornitori tecnici:',
        ['ul', [
          '**Anthropic** (Stati Uniti) e **OpenAI** (Stati Uniti) — modelli di intelligenza artificiale che redigono e classificano i messaggi. Questi fornitori non usano i vostri dati per addestrare i loro modelli e li conservano solo temporaneamente, per finalità di sicurezza.',
          '**Google** e **Microsoft** — Gmail, Outlook e calendari, esclusivamente nei limiti degli accessi che autorizzate.',
          '**Supabase** — banca dati e archiviazione dei file.',
          "**Vercel** (Stati Uniti) — hosting dell'applicazione.",
          '**Stripe** — pagamenti e fatturazione.',
        ]],
        'Per trovare e verificare le imprese, Aaron consulta anche **fonti pubbliche**: registri ufficiali (INSEE-SIRENE in Francia, Companies House nel Regno Unito, ABN Lookup in Australia) ed elenchi di imprese con licenza aperta. Queste fonti non ricevono alcun dato da parte vostra.',
        "Alcuni fornitori hanno sede fuori dall'Unione europea, principalmente negli Stati Uniti. Questi trasferimenti si basano sulle clausole contrattuali tipo della Commissione europea e, ove applicabile, sul Data Privacy Framework.",
      ],
    },
    {
      h: '6. Uso limitato dei dati Google e Microsoft',
      b: [
        GOOGLE_LIMITED_USE,
        'Lo stesso impegno vale per i dati ricevuti dalle API Microsoft. Concretamente, il contenuto della vostra casella di posta e del vostro calendario:',
        ['ul', [
          "è usato solo per fornire le funzioni che avete attivato nell'applicazione;",
          'non è mai venduto, né trasmesso a terzi per finalità proprie, né usato per pubblicità;',
          'non è mai usato per addestrare o migliorare un modello di intelligenza artificiale;',
          'è letto da un essere umano solo se ce lo chiedete espressamente per risolvere un problema, se la legge ce lo impone, o per ragioni di sicurezza.',
        ]],
      ],
    },
    {
      h: '7. I diritti dei vostri contatti',
      b: [
        `Ogni email di prospezione inviata da Aaron indica al destinatario che, con una semplice risposta, può chiedere di non essere più contattato; Aaron registra la richiesta e interrompe il contatto. Un contatto può inoltre esercitare i diritti di accesso, rettifica o cancellazione scrivendo a ${MAIL} — trasmettiamo la richiesta all'azienda titolare e la aiutiamo a rispondere.`,
      ],
    },
    {
      h: '8. Conservazione',
      b: [
        "I vostri dati sono conservati finché il vostro account è attivo, poi cancellati entro 30 giorni dalla chiusura, salvo i dati di fatturazione che la legge ci impone di conservare. I token di accesso alla vostra casella di posta sono cancellati non appena disconnettete l'account interessato.",
      ],
    },
    {
      id: 'delete-account',
      h: '9. Eliminare il vostro account',
      b: [
        `Potete eliminare il vostro account e tutti i dati associati da soli, senza contattarci: nell'applicazione aprite **Il mio account**, poi la scheda **Elimina il mio account**, e confermate. L'eliminazione è definitiva ed efficace entro 30 giorni. Se non avete più accesso all'applicazione, scrivete a ${MAIL} dall'indirizzo del vostro account.`,
      ],
    },
    {
      h: '10. Sicurezza',
      b: [
        "I token di accesso ai vostri account Gmail e Outlook sono cifrati prima dell'archiviazione. L'accesso alla banca dati è limitato e registrato, e gli scambi con i nostri fornitori avvengono esclusivamente tramite connessioni cifrate.",
      ],
    },
    {
      h: '11. Cookie e tracciamento',
      b: [
        'Usiamo solo i cookie strettamente necessari al funzionamento (sessione, preferenze). Nessun cookie pubblicitario, nessun tracciatore di terze parti.',
      ],
    },
    {
      h: '12. I vostri diritti',
      b: [
        'Potete in qualsiasi momento consultare, correggere, esportare o cancellare i vostri dati, e scollegare Meet Aaron dal vostro Gmail o Outlook dalla schermata **Connessioni** — oppure revocare l\'accesso direttamente dalle impostazioni di sicurezza del vostro account Google o Microsoft. Potete anche rivolgervi all\'autorità di protezione dei dati del vostro Paese (in Italia, il Garante per la protezione dei dati personali).',
      ],
    },
    {
      h: '13. Contatti e modifiche',
      b: [
        `Per qualsiasi domanda: ${MAIL}. Questa informativa può evolvere; vi informeremo di ogni modifica rilevante, nell'applicazione o via email.`,
      ],
    },
  ],
  footer: "Vedi anche i nostri [termini di servizio](/terms). Questa traduzione è fornita per comodità; in caso di divergenza prevale la versione inglese.",
};

const es = {
  title: 'Política de privacidad',
  updated: 'Última actualización: 8 de septiembre de 2026',
  intro: [
    'Meet Aaron («nosotros», «el servicio») es un asistente comercial basado en inteligencia artificial, accesible en meetaaron.app y, más adelante, a través de sus aplicaciones móviles. Esta política explica qué datos tratamos, por qué, con quién, y cómo mantienes el control sobre ellos.',
  ],
  sections: [
    {
      h: '1. Quién es el responsable',
      b: [
        `El servicio está editado por **MEET AARON**, empresa individual de Alexandre Fevre, registrada en Australia con el ABN 72 369 751 951 y con sede en Perth (Australia Occidental). Contacto para cualquier cuestión relativa a tus datos: ${MAIL}.`,
        'Respecto a los datos de tu cuenta (identidad, acceso, facturación, uso del servicio), Meet Aaron es **responsable del tratamiento**. Respecto a los datos de tus posibles clientes y de tus intercambios con ellos, el responsable eres **tú** — o tu empresa — y Meet Aaron actúa como **encargado del tratamiento**, siguiendo tus instrucciones.',
      ],
    },
    {
      h: '2. Quién usa Meet Aaron',
      b: [
        'Meet Aaron es una herramienta estrictamente profesional (B2B), destinada a comerciales y a sus empresas. No está diseñada para un uso personal ni para menores, y no recogemos conscientemente datos de personas menores de 18 años.',
      ],
    },
    {
      h: '3. Los datos que tratamos',
      b: [
        ['ul', [
          '**Tu cuenta**: nombre, dirección de correo, empresa, idioma, preferencias.',
          '**Tu buzón**: cuando conectas Gmail u Outlook, Aaron lee las respuestas de tus posibles clientes a tus correos de prospección, envía correos en tu nombre y coloca una etiqueta «Gestionado por Aaron» en los hilos que trata. No lee tu buzón en su conjunto: solo las conversaciones que él mismo ha iniciado.',
          '**Tu calendario**: Aaron crea citas en Google Calendar u Outlook cuando un posible cliente acepta una franja horaria, y consulta tus eventos para evitar solapamientos. Nunca toca los ajustes ni la compartición de tu calendario.',
          '**Tus posibles clientes**: nombre, cargo, correo, teléfono, empresa y el contenido de los intercambios. Estos datos provienen de ti (importación de archivo), de fuentes públicas de empresas (ver sección 5) o de las respuestas de los propios interesados.',
          '**Tus documentos** (presupuestos tipo, tarifas, folletos), para que Aaron adapte sus mensajes a tu actividad.',
          '**Tu facturación**: gestionada por Stripe; no almacenamos ningún número de tarjeta.',
          '**Las notificaciones**: si las activas, un identificador técnico de suscripción push por dispositivo.',
          '**Los datos técnicos** habituales (dirección IP, navegador, registros de errores), necesarios para el funcionamiento y la seguridad.',
        ]],
      ],
    },
    {
      h: '4. Por qué los tratamos',
      b: [
        'Únicamente para:',
        ['ul', [
          'hacer funcionar la prospección que has configurado, y nada más;',
          'redactar correos y respuestas con ayuda de modelos de inteligencia artificial;',
          'mostrar tu pipeline, tus estadísticas y el historial de tus intercambios;',
          'avisarte (citas, respuestas, presupuesto);',
          'facturar tu suscripción y asegurar el servicio.',
        ]],
        'Bases jurídicas: la ejecución del contrato que nos vincula (tu suscripción), nuestro interés legítimo en asegurar y mejorar el servicio, y tu consentimiento para los accesos a tu buzón y a tu calendario, que puedes retirar en cualquier momento.',
        'Nunca vendemos tus datos ni los de tus posibles clientes, y no hacemos ningún uso publicitario de ellos.',
      ],
    },
    {
      h: '5. Con quién circulan los datos',
      b: [
        'Para hacer funcionar el servicio nos apoyamos en proveedores técnicos:',
        ['ul', [
          '**Anthropic** (Estados Unidos) y **OpenAI** (Estados Unidos) — modelos de inteligencia artificial que redactan y clasifican los mensajes. Estos proveedores no usan tus datos para entrenar sus modelos y solo los conservan temporalmente, con fines de seguridad.',
          '**Google** y **Microsoft** — Gmail, Outlook y calendarios, únicamente dentro de los accesos que autorizas.',
          '**Supabase** — base de datos y almacenamiento de archivos.',
          '**Vercel** (Estados Unidos) — alojamiento de la aplicación.',
          '**Stripe** — pagos y facturación.',
        ]],
        'Para encontrar y verificar empresas, Aaron consulta además **fuentes públicas**: registros oficiales (INSEE-SIRENE en Francia, Companies House en el Reino Unido, ABN Lookup en Australia) y directorios de establecimientos con licencia abierta. Estas fuentes no reciben ningún dato por tu parte.',
        'Algunos proveedores están establecidos fuera de la Unión Europea, principalmente en Estados Unidos. Estas transferencias se basan en las cláusulas contractuales tipo de la Comisión Europea y, en su caso, en el Data Privacy Framework.',
      ],
    },
    {
      h: '6. Uso limitado de los datos de Google y Microsoft',
      b: [
        GOOGLE_LIMITED_USE,
        'El mismo compromiso se aplica a los datos recibidos de las API de Microsoft. En concreto, el contenido de tu buzón y de tu calendario:',
        ['ul', [
          'solo sirve para prestar las funciones que has activado en la aplicación;',
          'nunca se vende, ni se transmite a terceros para sus propios fines, ni se usa para publicidad;',
          'nunca se usa para entrenar ni mejorar un modelo de inteligencia artificial;',
          'solo lo lee una persona si nos lo pides expresamente para resolver un problema, si la ley nos obliga, o por razones de seguridad.',
        ]],
      ],
    },
    {
      h: '7. Los derechos de tus posibles clientes',
      b: [
        `Cada correo de prospección enviado por Aaron indica a su destinatario que, con una simple respuesta, puede pedir no ser contactado de nuevo; Aaron registra esa petición y cesa el contacto. Un interesado también puede ejercer sus derechos de acceso, rectificación o supresión escribiendo a ${MAIL} — trasladamos la petición a la empresa responsable y la ayudamos a responder.`,
      ],
    },
    {
      h: '8. Conservación',
      b: [
        'Tus datos se conservan mientras tu cuenta esté activa, y después se suprimen en los 30 días siguientes a su cierre, salvo los datos de facturación que la ley nos obliga a guardar. Los tokens de acceso a tu buzón se suprimen en cuanto desconectas la cuenta correspondiente.',
      ],
    },
    {
      id: 'delete-account',
      h: '9. Eliminar tu cuenta',
      b: [
        `Puedes eliminar tu cuenta y todos los datos asociados por ti mismo, sin contactarnos: en la aplicación, abre **Mi cuenta**, después la pestaña **Eliminar mi cuenta**, y confirma. La eliminación es definitiva y efectiva en un plazo de 30 días. Si ya no tienes acceso a la aplicación, escribe a ${MAIL} desde la dirección de tu cuenta.`,
      ],
    },
    {
      h: '10. Seguridad',
      b: [
        'Los tokens de acceso a tus cuentas de Gmail y Outlook se cifran antes de almacenarse. El acceso a la base de datos está restringido y registrado, y los intercambios con nuestros proveedores se realizan exclusivamente por conexiones cifradas.',
      ],
    },
    {
      h: '11. Cookies y seguimiento',
      b: [
        'Solo usamos las cookies estrictamente necesarias para el funcionamiento (sesión, preferencias). Ninguna cookie publicitaria, ningún rastreador de terceros.',
      ],
    },
    {
      h: '12. Tus derechos',
      b: [
        'Puedes en cualquier momento consultar, corregir, exportar o suprimir tus datos, y desconectar Meet Aaron de tu Gmail u Outlook desde la pantalla **Conexiones** — o revocar el acceso directamente desde los ajustes de seguridad de tu cuenta de Google o Microsoft. También puedes dirigirte a la autoridad de protección de datos de tu país (en España, la AEPD).',
      ],
    },
    {
      h: '13. Contacto y cambios',
      b: [
        `Para cualquier pregunta: ${MAIL}. Esta política puede evolucionar; te informaremos de cualquier cambio importante, en la aplicación o por correo.`,
      ],
    },
  ],
  footer: 'Consulta también nuestros [términos del servicio](/terms). Esta traducción se ofrece por comodidad; en caso de discrepancia prevalece la versión en inglés.',
};

const pt = {
  title: 'Política de privacidade',
  updated: 'Última atualização: 8 de setembro de 2026',
  intro: [
    'A Meet Aaron («nós», «o serviço») é um assistente comercial baseado em inteligência artificial, acessível em meetaaron.app e, futuramente, através das suas aplicações móveis. Esta política explica que dados tratamos, porquê, com quem, e como mantém o controlo sobre eles.',
  ],
  sections: [
    {
      h: '1. Quem é o responsável',
      b: [
        `O serviço é editado pela **MEET AARON**, empresa em nome individual de Alexandre Fevre, registada na Austrália com o ABN 72 369 751 951 e sediada em Perth (Austrália Ocidental). Contacto para qualquer questão relativa aos seus dados: ${MAIL}.`,
        'Quanto aos dados da sua conta (identidade, autenticação, faturação, utilização do serviço), a Meet Aaron é **responsável pelo tratamento**. Quanto aos dados dos seus potenciais clientes e às suas trocas com eles, o responsável é **você** — ou a sua empresa — e a Meet Aaron atua como **subcontratante**, seguindo as suas instruções.',
      ],
    },
    {
      h: '2. Quem usa a Meet Aaron',
      b: [
        'A Meet Aaron é uma ferramenta estritamente profissional (B2B), destinada a comerciais e às suas empresas. Não foi concebida para uso pessoal nem para menores, e não recolhemos conscientemente dados de pessoas com menos de 18 anos.',
      ],
    },
    {
      h: '3. Os dados que tratamos',
      b: [
        ['ul', [
          '**A sua conta**: nome, endereço de email, empresa, idioma, preferências.',
          '**A sua caixa de correio**: quando liga o Gmail ou o Outlook, o Aaron lê as respostas dos seus potenciais clientes aos seus emails de prospeção, envia emails em seu nome e coloca uma etiqueta «Gerido pelo Aaron» nas conversas que trata. Não lê a sua caixa no seu conjunto: apenas as conversas que ele próprio iniciou.',
          '**A sua agenda**: o Aaron cria reuniões no Google Calendar ou no Outlook quando um potencial cliente aceita um horário, e consulta os seus eventos para evitar sobreposições. Nunca mexe nas definições nem na partilha da sua agenda.',
          '**Os seus potenciais clientes**: nome, função, email, telefone, empresa e o conteúdo das trocas. Estes dados vêm de si (importação de ficheiro), de fontes públicas sobre empresas (ver secção 5) ou das respostas dos próprios interessados.',
          '**Os seus documentos** (orçamentos-tipo, tabelas de preços, brochuras), para que o Aaron adapte as mensagens à sua atividade.',
          '**A sua faturação**: tratada pela Stripe; não guardamos qualquer número de cartão.',
          '**As notificações**: se as ativar, um identificador técnico de subscrição push por dispositivo.',
          '**Os dados técnicos** habituais (endereço IP, navegador, registos de erros), necessários ao funcionamento e à segurança.',
        ]],
      ],
    },
    {
      h: '4. Porque os tratamos',
      b: [
        'Unicamente para:',
        ['ul', [
          'fazer funcionar a prospeção que configurou, e nada mais;',
          'redigir emails e respostas com o apoio de modelos de inteligência artificial;',
          'mostrar o seu pipeline, as suas estatísticas e o histórico das suas trocas;',
          'avisá-lo (reuniões, respostas, orçamento);',
          'faturar a sua subscrição e assegurar o serviço.',
        ]],
        'Fundamentos jurídicos: a execução do contrato que nos liga (a sua subscrição), o nosso interesse legítimo em proteger e melhorar o serviço, e o seu consentimento para os acessos à sua caixa de correio e à sua agenda, que pode retirar a qualquer momento.',
        'Nunca vendemos os seus dados nem os dos seus potenciais clientes, e não fazemos qualquer uso publicitário deles.',
      ],
    },
    {
      h: '5. Por quem passam os dados',
      b: [
        'Para fazer funcionar o serviço apoiamo-nos em prestadores técnicos:',
        ['ul', [
          '**Anthropic** (Estados Unidos) e **OpenAI** (Estados Unidos) — modelos de inteligência artificial que redigem e classificam as mensagens. Estes prestadores não usam os seus dados para treinar os seus modelos e conservam-nos apenas temporariamente, para fins de segurança.',
          '**Google** e **Microsoft** — Gmail, Outlook e agendas, unicamente dentro dos acessos que autorizar.',
          '**Supabase** — base de dados e armazenamento de ficheiros.',
          '**Vercel** (Estados Unidos) — alojamento da aplicação.',
          '**Stripe** — pagamentos e faturação.',
        ]],
        'Para encontrar e verificar empresas, o Aaron consulta ainda **fontes públicas**: registos oficiais (INSEE-SIRENE em França, Companies House no Reino Unido, ABN Lookup na Austrália) e diretórios de estabelecimentos sob licença aberta. Estas fontes não recebem qualquer dado da sua parte.',
        'Alguns prestadores estão estabelecidos fora da União Europeia, principalmente nos Estados Unidos. Estas transferências assentam nas cláusulas contratuais-tipo da Comissão Europeia e, se aplicável, no Data Privacy Framework.',
      ],
    },
    {
      h: '6. Utilização limitada dos dados Google e Microsoft',
      b: [
        GOOGLE_LIMITED_USE,
        'O mesmo compromisso aplica-se aos dados recebidos das API da Microsoft. Concretamente, o conteúdo da sua caixa de correio e da sua agenda:',
        ['ul', [
          'serve apenas para prestar as funcionalidades que ativou na aplicação;',
          'nunca é vendido, nem transmitido a terceiros para fins próprios, nem usado para publicidade;',
          'nunca é usado para treinar ou melhorar um modelo de inteligência artificial;',
          'só é lido por uma pessoa se nos pedir expressamente para resolver um problema, se a lei nos obrigar, ou por razões de segurança.',
        ]],
      ],
    },
    {
      h: '7. Os direitos dos seus potenciais clientes',
      b: [
        `Cada email de prospeção enviado pelo Aaron indica ao destinatário que, com uma simples resposta, pode pedir para não voltar a ser contactado; o Aaron regista esse pedido e cessa o contacto. Um interessado pode também exercer os seus direitos de acesso, retificação ou apagamento escrevendo para ${MAIL} — transmitimos o pedido à empresa responsável e ajudamo-la a responder.`,
      ],
    },
    {
      h: '8. Conservação',
      b: [
        'Os seus dados são conservados enquanto a sua conta estiver ativa, sendo depois apagados nos 30 dias seguintes ao seu encerramento, exceto os dados de faturação que a lei nos obriga a guardar. Os tokens de acesso à sua caixa de correio são apagados assim que desligar a conta em causa.',
      ],
    },
    {
      id: 'delete-account',
      h: '9. Eliminar a sua conta',
      b: [
        `Pode eliminar a sua conta e todos os dados associados por si próprio, sem nos contactar: na aplicação, abra **A minha conta**, depois o separador **Eliminar a minha conta**, e confirme. A eliminação é definitiva e efetiva no prazo de 30 dias. Se já não tiver acesso à aplicação, escreva para ${MAIL} a partir do endereço da sua conta.`,
      ],
    },
    {
      h: '10. Segurança',
      b: [
        'Os tokens de acesso às suas contas Gmail e Outlook são cifrados antes do armazenamento. O acesso à base de dados é restrito e registado, e as trocas com os nossos prestadores fazem-se exclusivamente por ligações cifradas.',
      ],
    },
    {
      h: '11. Cookies e rastreio',
      b: [
        'Usamos apenas os cookies estritamente necessários ao funcionamento (sessão, preferências). Nenhum cookie publicitário, nenhum rastreador de terceiros.',
      ],
    },
    {
      h: '12. Os seus direitos',
      b: [
        'Pode a qualquer momento consultar, corrigir, exportar ou apagar os seus dados, e desligar a Meet Aaron do seu Gmail ou Outlook a partir do ecrã **Ligações** — ou revogar o acesso diretamente nas definições de segurança da sua conta Google ou Microsoft. Pode também dirigir-se à autoridade de proteção de dados do seu país (em Portugal, a CNPD).',
      ],
    },
    {
      h: '13. Contacto e alterações',
      b: [
        `Para qualquer questão: ${MAIL}. Esta política pode evoluir; informá-lo-emos de qualquer alteração importante, na aplicação ou por email.`,
      ],
    },
  ],
  footer: 'Consulte também os nossos [termos de serviço](/terms). Esta tradução é fornecida por conveniência; em caso de divergência prevalece a versão inglesa.',
};

const nl = {
  title: 'Privacybeleid',
  updated: 'Laatst bijgewerkt: 8 september 2026',
  intro: [
    'Meet Aaron („wij”, „de dienst”) is een verkoopassistent op basis van kunstmatige intelligentie, bereikbaar op meetaaron.app en, na verloop van tijd, via de mobiele apps. Dit beleid legt uit welke gegevens wij verwerken, waarom, met wie, en hoe u er zeggenschap over houdt.',
  ],
  sections: [
    {
      h: '1. Wie verantwoordelijk is',
      b: [
        `De dienst wordt uitgegeven door **MEET AARON**, de eenmanszaak van Alexandre Fevre, in Australië ingeschreven onder ABN 72 369 751 951 en gevestigd in Perth (West-Australië). Contact voor elke vraag over uw gegevens: ${MAIL}.`,
        'Voor uw accountgegevens (identiteit, aanmelding, facturatie, gebruik van de dienst) is Meet Aaron **verwerkingsverantwoordelijke**. Voor de gegevens van uw prospects en uw correspondentie met hen bent **u** — of uw onderneming — de verwerkingsverantwoordelijke, en treedt Meet Aaron op als **verwerker**, volgens uw instructies.',
      ],
    },
    {
      h: '2. Wie Meet Aaron gebruikt',
      b: [
        'Meet Aaron is een strikt zakelijk hulpmiddel (B2B), bedoeld voor verkopers en hun ondernemingen. Het is niet ontworpen voor persoonlijk gebruik of voor minderjarigen, en wij verzamelen niet bewust gegevens van personen onder de 18 jaar.',
      ],
    },
    {
      h: '3. De gegevens die wij verwerken',
      b: [
        ['ul', [
          '**Uw account**: naam, e-mailadres, onderneming, taal, voorkeuren.',
          '**Uw mailbox**: wanneer u Gmail of Outlook koppelt, leest Aaron de antwoorden van uw prospects op uw acquisitiemails, verstuurt hij e-mails namens u en plaatst hij het label „Beheerd door Aaron” op de gesprekken die hij behandelt. Hij leest niet uw hele mailbox: uitsluitend de gesprekken die hij zelf is begonnen.',
          '**Uw agenda**: Aaron maakt afspraken aan in Google Agenda of Outlook wanneer een prospect een tijdslot aanvaardt, en raadpleegt uw afspraken om dubbele boekingen te vermijden. Hij raakt nooit de instellingen of het delen van uw agenda aan.',
          '**Uw prospects**: naam, functie, e-mail, telefoon, onderneming en de inhoud van de correspondentie. Deze gegevens komen van u (bestandsimport), uit openbare ondernemingsbronnen (zie punt 5) of uit de antwoorden van de prospects zelf.',
          '**Uw documenten** (voorbeeldoffertes, tarieven, brochures), zodat Aaron zijn berichten op uw vak afstemt.',
          '**Uw facturatie**: verwerkt door Stripe; wij bewaren geen enkel kaartnummer.',
          '**De meldingen**: als u ze inschakelt, een technische push-abonnementsidentificatie per apparaat.',
          '**De gebruikelijke technische gegevens** (IP-adres, browser, foutenlogboeken), nodig voor de werking en de beveiliging.',
        ]],
      ],
    },
    {
      h: '4. Waarom wij ze verwerken',
      b: [
        'Uitsluitend om:',
        ['ul', [
          'de acquisitie te laten werken die u hebt ingesteld, en niets anders;',
          'e-mails en antwoorden op te stellen met behulp van modellen voor kunstmatige intelligentie;',
          'uw pijplijn, uw statistieken en de geschiedenis van uw correspondentie te tonen;',
          'u te waarschuwen (afspraken, antwoorden, budget);',
          'uw abonnement te factureren en de dienst te beveiligen.',
        ]],
        'Rechtsgronden: de uitvoering van de overeenkomst tussen ons (uw abonnement), ons gerechtvaardigd belang bij het beveiligen en verbeteren van de dienst, en uw toestemming voor de toegang tot uw mailbox en uw agenda, die u op elk moment kunt intrekken.',
        'Wij verkopen nooit uw gegevens of die van uw prospects, en gebruiken ze nooit voor reclame.',
      ],
    },
    {
      h: '5. Met wie de gegevens worden gedeeld',
      b: [
        'Om de dienst te laten werken doen wij een beroep op technische dienstverleners:',
        ['ul', [
          '**Anthropic** (Verenigde Staten) en **OpenAI** (Verenigde Staten) — modellen voor kunstmatige intelligentie die berichten opstellen en indelen. Deze dienstverleners gebruiken uw gegevens niet om hun modellen te trainen en bewaren ze slechts tijdelijk, om veiligheidsredenen.',
          '**Google** en **Microsoft** — Gmail, Outlook en agenda’s, uitsluitend binnen de toegang die u verleent.',
          '**Supabase** — database en bestandsopslag.',
          '**Vercel** (Verenigde Staten) — hosting van de applicatie.',
          '**Stripe** — betalingen en facturatie.',
        ]],
        'Om ondernemingen te vinden en te verifiëren raadpleegt Aaron ook **openbare bronnen**: officiële registers (INSEE-SIRENE in Frankrijk, Companies House in het Verenigd Koninkrijk, ABN Lookup in Australië) en bedrijvengidsen onder open licentie. Deze bronnen ontvangen geen enkel gegeven van u.',
        'Sommige dienstverleners zijn buiten de Europese Unie gevestigd, hoofdzakelijk in de Verenigde Staten. Deze doorgiften steunen op de modelcontractbepalingen van de Europese Commissie en, waar van toepassing, op het Data Privacy Framework.',
      ],
    },
    {
      h: '6. Beperkt gebruik van Google- en Microsoft-gegevens',
      b: [
        GOOGLE_LIMITED_USE,
        'Dezelfde verbintenis geldt voor gegevens ontvangen via de Microsoft-API’s. Concreet wordt de inhoud van uw mailbox en uw agenda:',
        ['ul', [
          'uitsluitend gebruikt om de functies te leveren die u in de applicatie hebt ingeschakeld;',
          'nooit verkocht, aan derden doorgegeven voor hun eigen doeleinden, of gebruikt voor reclame;',
          'nooit gebruikt om een model voor kunstmatige intelligentie te trainen of te verbeteren;',
          'alleen door een mens gelezen als u ons daar uitdrukkelijk om vraagt om een probleem op te lossen, als de wet ons daartoe verplicht, of om veiligheidsredenen.',
        ]],
      ],
    },
    {
      h: '7. De rechten van uw prospects',
      b: [
        `Elke door Aaron verzonden acquisitiemail wijst de ontvanger erop dat een eenvoudig antwoord volstaat om niet meer gecontacteerd te worden; Aaron registreert dat verzoek en stopt het contact. Een prospect kan ook zijn recht op inzage, rectificatie of wissing uitoefenen door te schrijven naar ${MAIL} — wij sturen het verzoek door naar de verantwoordelijke onderneming en helpen haar te antwoorden.`,
      ],
    },
    {
      h: '8. Bewaartermijn',
      b: [
        'Uw gegevens worden bewaard zolang uw account actief is, en daarna binnen 30 dagen na afsluiting gewist, met uitzondering van de facturatiegegevens die wij wettelijk moeten bewaren. De toegangstokens voor uw mailbox worden gewist zodra u het betrokken account loskoppelt.',
      ],
    },
    {
      id: 'delete-account',
      h: '9. Uw account verwijderen',
      b: [
        `U kunt uw account en alle bijbehorende gegevens zelf verwijderen, zonder contact met ons op te nemen: open in de applicatie **Mijn account**, dan het tabblad **Mijn account verwijderen**, en bevestig. De verwijdering is definitief en wordt binnen 30 dagen van kracht. Hebt u geen toegang meer tot de applicatie, schrijf dan naar ${MAIL} vanaf het adres van uw account.`,
      ],
    },
    {
      h: '10. Beveiliging',
      b: [
        'De toegangstokens voor uw Gmail- en Outlook-accounts worden vóór opslag versleuteld. De toegang tot de database is beperkt en wordt gelogd, en het verkeer met onze dienstverleners verloopt uitsluitend via versleutelde verbindingen.',
      ],
    },
    {
      h: '11. Cookies en tracking',
      b: [
        'Wij gebruiken uitsluitend cookies die strikt noodzakelijk zijn voor de werking (sessie, voorkeuren). Geen reclamecookies, geen trackers van derden.',
      ],
    },
    {
      h: '12. Uw rechten',
      b: [
        'U kunt op elk moment uw gegevens inzien, corrigeren, exporteren of wissen, en Meet Aaron loskoppelen van uw Gmail of Outlook via het scherm **Verbindingen** — of de toegang rechtstreeks intrekken in de beveiligingsinstellingen van uw Google- of Microsoft-account. U kunt zich ook wenden tot de gegevensbeschermingsautoriteit van uw land.',
      ],
    },
    {
      h: '13. Contact en wijzigingen',
      b: [
        `Voor elke vraag: ${MAIL}. Dit beleid kan wijzigen; wij informeren u over elke belangrijke wijziging, in de applicatie of per e-mail.`,
      ],
    },
  ],
  footer: 'Zie ook onze [gebruiksvoorwaarden](/terms). Deze vertaling is bedoeld voor uw gemak; bij afwijkingen prevaleert de Engelse versie.',
};

const POLICIES = { fr, en, de, it, es, pt, nl };

const BACK_LABEL = {
  fr: '← Retour aux préférences',
  en: '← Back to preferences',
  de: '← Zurück zu den Einstellungen',
  it: '← Torna alle preferenze',
  es: '← Volver a las preferencias',
  pt: '← Voltar às preferências',
  nl: '← Terug naar voorkeuren',
};

export default function PrivacyPage() {
  const [locale] = useLocale();
  return <LegalPage documents={POLICIES} backLabel={BACK_LABEL} locale={locale} />;
}
