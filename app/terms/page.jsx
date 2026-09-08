'use client';
// app/terms/page.jsx
//
// Conditions générales d'utilisation et de vente (CGU/CGV).
//
// Cette page n'est pas seulement du confort juridique : elle est exigée par
// les deux plateformes dont dépendent nos connexions email/agenda.
//   - Microsoft Entra : champ « Conditions d'utilisation » de l'écran de
//     consentement, demandé pour la vérification d'éditeur.
//   - Google : la vérification OAuth des scopes restreints (Gmail) exige une
//     page de conditions ET une page de confidentialité publiques, sur le
//     domaine vérifié, accessibles sans authentification.
// Elle doit donc rester servie en clair sur https://meetaaron.app/terms,
// sans redirection vers /login.
//
// SEPT LANGUES (demande Alex, 08/09/2026), même forme que /privacy et même
// rendu partagé (components/LegalPage.jsx) : les deux pages sont ouvertes
// l'une après l'autre par les relecteurs Google et Apple, elles doivent se
// répondre exactement.
//
// Le français et l'anglais sont les versions de RÉFÉRENCE ; les cinq autres le
// disent en note de bas de page (en cas de divergence, l'anglais fait foi).
// Sans cette clause, sept textes contractuels légèrement différents créeraient
// une ambiguïté sur celui qui engage réellement les parties.
//
// SECTION 5 : elle décrit le fonctionnement RÉEL des plafonds depuis le
// 08/09/2026 — enveloppe mensuelle sur la prospection seule, suivi des
// conversations engagées hors enveloppe, plafond de sécurité global. Le texte
// est contractuel : il doit suivre lib/anthropic-client.ts, jamais l'inverse.
import { useLocale } from '@/lib/i18n';
import LegalPage, { MAIL } from '@/components/LegalPage';

const GOOGLE_LIMITED_USE_TERMS =
  '[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)';

const fr = {
  title: "Conditions générales d'utilisation",
  updated: 'Dernière mise à jour : 8 septembre 2026',
  intro: [
    "Les présentes conditions encadrent l'utilisation de Meet Aaron, un assistant commercial basé sur l'intelligence artificielle accessible sur meetaaron.app. En créant un compte, vous les acceptez sans réserve.",
  ],
  sections: [
    {
      h: '1. Éditeur du service',
      b: [
        `Meet Aaron est édité par **MEET AARON**, entreprise individuelle d'Alexandre Fevre, immatriculée en Australie sous l'ABN 72 369 751 951, établie à Perth (Australie-Occidentale). Contact : ${MAIL}`,
        'Le service est hébergé par Vercel Inc. (application) et Supabase Inc. (base de données et fichiers).',
      ],
    },
    {
      h: '2. Objet du service',
      b: [
        "Meet Aaron est un outil professionnel qui assiste les équipes commerciales : il rédige et envoie des emails de prospection en votre nom, suit les réponses de vos prospects, propose des créneaux de rendez-vous, tient à jour votre pipeline commercial et vous alerte sur les actions en attente.",
        "Aaron produit des **propositions**. Les emails, les devis et les rendez-vous générés par l'intelligence artificielle restent sous votre contrôle et sous votre responsabilité : c'est vous qui décidez ce qui part, à qui, et quand.",
      ],
    },
    {
      h: '3. Qui peut utiliser Meet Aaron',
      b: [
        "Meet Aaron est un service strictement professionnel (B2B), réservé aux personnes majeures agissant dans le cadre de leur activité professionnelle. Il n'est destiné ni à un usage personnel, ni à des mineurs.",
        'Vous êtes responsable de la confidentialité de vos identifiants et de toute activité menée depuis votre compte. Prévenez-nous sans délai en cas d\'utilisation non autorisée.',
      ],
    },
    {
      h: '4. Abonnement, prix et résiliation',
      b: [
        ['ul', [
          "L'abonnement Aaron est facturé **30 € par mois et par utilisateur**, sans engagement de durée.",
          'Le paiement est traité par Stripe. Nous ne stockons jamais vos coordonnées bancaires.',
          "L'abonnement se renouvelle automatiquement chaque mois jusqu'à résiliation.",
          'Vous pouvez résilier à tout moment depuis votre espace client. La résiliation prend effet à la fin de la période déjà payée : le service reste accessible jusque-là, et aucun prélèvement supplémentaire n\'est effectué ensuite.',
          "Les périodes entamées ne font pas l'objet d'un remboursement au prorata, sauf indisponibilité prolongée du service qui nous serait imputable.",
        ]],
        "S'agissant d'un contrat conclu entre professionnels, le droit de rétractation de quatorze jours prévu pour les consommateurs ne s'applique pas.",
      ],
    },
    {
      h: "5. Usage raisonnable de l'intelligence artificielle",
      b: [
        "Chaque abonnement inclut une enveloppe mensuelle de traitement par intelligence artificielle (de l'ordre de 20 € de consommation par utilisateur et par mois). Elle couvre très largement un usage commercial normal.",
        "Cette enveloppe s'applique à la **prospection** : recherche d'entreprises, qualification, rédaction des premiers emails et des relances. Une fois l'enveloppe consommée, la prospection automatique s'interrompt jusqu'au mois suivant.",
        "Le **suivi des conversations déjà engagées** — réponses à vos prospects, négociations, relation client — n'est pas décompté de cette enveloppe et se poursuit normalement. Une négociation en cours ne doit pas s'arrêter parce que le budget de prospection du mois est consommé.",
        "Un plafond de sécurité global reste en place pour couvrir les usages anormaux. Nous vous prévenons avant que l'enveloppe ne soit atteinte, et elle peut être relevée sur demande. Vos données et le reste de l'application ne sont jamais affectés.",
      ],
    },
    {
      h: '6. Vos obligations',
      b: [
        'Vous vous engagez à :',
        ['ul', [
          "respecter la réglementation applicable à la prospection commerciale, notamment le RGPD et les règles relatives aux communications électroniques : disposer d'une base légale pour contacter vos prospects, les informer, et honorer immédiatement toute demande de désinscription ou d'opposition ;",
          "n'utiliser Meet Aaron ni pour de l'envoi massif non sollicité (spam), ni pour des contenus trompeurs, illicites, diffamatoires ou portant atteinte aux droits d'autrui ;",
          "ne pas importer de données de prospects que vous n'êtes pas en droit de traiter ;",
          'relire les messages proposés par Aaron avant leur envoi, et vérifier les montants et engagements figurant dans les devis générés ;',
          "ne pas tenter de contourner les limitations techniques du service, ni d'accéder aux données d'autres clients.",
        ]],
        "Les emails partent depuis votre propre boîte et sous votre identité : vous en êtes l'expéditeur au sens juridique, et le responsable de traitement des données de vos prospects. Nous agissons comme sous-traitant pour votre compte.",
      ],
    },
    {
      h: '7. Accès à votre messagerie et à votre agenda',
      b: [
        "Meet Aaron ne fonctionne qu'avec les accès que vous autorisez explicitement lors de la connexion de votre compte Google ou Microsoft. Ces accès servent uniquement à fournir les fonctions que vous avez activées : lire les réponses de vos prospects, envoyer des emails en votre nom, et créer ou consulter des rendez-vous.",
        `L'utilisation et le transfert des informations reçues des API Google respectent la ${GOOGLE_LIMITED_USE_TERMS}, y compris ses exigences d'utilisation limitée (Limited Use). Concrètement : ces données ne sont jamais vendues, jamais utilisées à des fins publicitaires, jamais utilisées pour entraîner un modèle d'intelligence artificielle, et ne sont lues par un humain que si vous nous le demandez pour résoudre un problème, si la loi l'exige, ou pour des raisons de sécurité.`,
        "Vous pouvez révoquer ces accès à tout moment depuis l'écran « Connexions » de l'application, ou directement depuis les paramètres de sécurité de votre compte Google ou Microsoft.",
      ],
    },
    {
      h: '8. Disponibilité du service',
      b: [
        "Nous mettons tout en œuvre pour assurer un service continu, sans pouvoir garantir une disponibilité ininterrompue. Le service peut être suspendu temporairement pour maintenance, ou perturbé par une défaillance de l'un de nos prestataires techniques (hébergement, messagerie, fournisseur d'intelligence artificielle).",
      ],
    },
    {
      h: '9. Responsabilité',
      b: [
        "Meet Aaron est un outil d'aide à la vente. Nous ne garantissons aucun résultat commercial, aucun taux de réponse, ni l'exactitude des contenus générés par l'intelligence artificielle, qui doivent être relus avant usage.",
        "Notre responsabilité ne saurait être engagée pour les conséquences des messages que vous choisissez d'envoyer, ni pour les dommages indirects tels qu'une perte de chiffre d'affaires, de clientèle ou de données imputable à un tiers. En tout état de cause, notre responsabilité est limitée aux sommes que vous nous avez versées au cours des douze mois précédant le fait générateur.",
      ],
    },
    {
      h: '10. Propriété intellectuelle',
      b: [
        "L'application, sa marque et son code restent notre propriété exclusive. Votre abonnement vous confère un droit d'usage personnel, non exclusif et non transférable, pour la durée de l'abonnement.",
        "Vos données, vos documents et les contenus générés pour votre compte vous appartiennent. Nous ne les utilisons pas pour entraîner des modèles d'intelligence artificielle.",
      ],
    },
    {
      h: '11. Données personnelles',
      b: [
        'Le traitement de vos données et de celles de vos prospects est détaillé dans notre [politique de confidentialité](/privacy), qui fait partie intégrante des présentes conditions.',
      ],
    },
    {
      h: '12. Suspension et fermeture du compte',
      b: [
        "Nous pouvons suspendre ou fermer un compte en cas de manquement grave aux présentes conditions, notamment en cas d'envois abusifs ou d'usage illicite, après vous en avoir informé sauf urgence. Vous pouvez de votre côté demander la suppression de votre compte et des données associées à tout moment depuis l'application ou en nous écrivant.",
      ],
    },
    {
      h: '13. Évolution des conditions',
      b: [
        "Ces conditions peuvent évoluer avec le service. Toute modification substantielle vous sera notifiée par email au moins trente jours avant son entrée en vigueur. Si elle ne vous convient pas, vous pouvez résilier sans frais avant cette date.",
      ],
    },
    {
      h: '14. Droit applicable',
      b: [
        "Les présentes conditions sont soumises au droit français. En cas de litige, nous chercherons d'abord une solution amiable ; à défaut, les tribunaux français seront compétents.",
      ],
    },
    {
      h: '15. Contact',
      b: [`Pour toute question sur ces conditions : ${MAIL}.`],
    },
  ],
  footer: 'Voir aussi notre [politique de confidentialité](/privacy).',
};

const en = {
  title: 'Terms of Service',
  updated: 'Last updated: 8 September 2026',
  intro: [
    'These terms govern the use of Meet Aaron, an AI-powered sales assistant available at meetaaron.app. By creating an account, you accept them in full.',
  ],
  sections: [
    {
      h: '1. Who publishes the service',
      b: [
        `Meet Aaron is published by **MEET AARON**, the sole-trader business of Alexandre Fevre, registered in Australia under ABN 72 369 751 951 and based in Perth, Western Australia. Contact: ${MAIL}`,
        'The service is hosted by Vercel Inc. (application) and Supabase Inc. (database and files).',
      ],
    },
    {
      h: '2. What the service does',
      b: [
        'Meet Aaron is a professional tool that assists sales teams: it drafts and sends outreach emails on your behalf, follows up on your prospects\' replies, proposes meeting slots, keeps your sales pipeline up to date and alerts you to pending actions.',
        'Aaron produces **proposals**. The emails, quotes and meetings generated by artificial intelligence remain under your control and your responsibility: you decide what goes out, to whom, and when.',
      ],
    },
    {
      h: '3. Who may use Meet Aaron',
      b: [
        'Meet Aaron is a strictly professional (B2B) service, reserved for adults acting in the course of their professional activity. It is intended neither for personal use nor for minors.',
        'You are responsible for keeping your credentials confidential and for all activity carried out from your account. Tell us without delay in case of unauthorised use.',
      ],
    },
    {
      h: '4. Subscription, price and cancellation',
      b: [
        ['ul', [
          'The Aaron subscription is billed at **€30 per month per user**, with no minimum term.',
          'Payment is handled by Stripe. We never store your card details.',
          'The subscription renews automatically each month until cancelled.',
          'You can cancel at any time from your account area. Cancellation takes effect at the end of the period already paid for: the service stays available until then, and no further payment is taken.',
          'Started periods are not refunded pro rata, except in the event of prolonged unavailability attributable to us.',
        ]],
        'As this is a contract between businesses, the fourteen-day withdrawal right provided for consumers does not apply.',
      ],
    },
    {
      h: '5. Fair use of artificial intelligence',
      b: [
        'Each subscription includes a monthly artificial-intelligence processing allowance (in the order of €20 of consumption per user per month). It covers normal sales use very comfortably.',
        'This allowance applies to **prospecting**: finding companies, qualifying them, drafting first emails and follow-ups. Once the allowance is used up, automated prospecting pauses until the next month.',
        'The **handling of conversations already under way** — replies to your prospects, negotiations, customer relationships — is not deducted from this allowance and continues normally. A live negotiation should not stop because the month\'s prospecting budget is spent.',
        'A global safety ceiling remains in place to cover abnormal usage. We warn you before the allowance runs out, and it can be raised on request. Your data and the rest of the application are never affected.',
      ],
    },
    {
      h: '6. Your obligations',
      b: [
        'You undertake to:',
        ['ul', [
          'comply with the rules applicable to sales prospecting, in particular the GDPR and the rules on electronic communications: have a legal basis for contacting your prospects, inform them, and honour any unsubscribe or objection request immediately;',
          'not use Meet Aaron for unsolicited bulk sending (spam), nor for misleading, unlawful or defamatory content, nor content infringing the rights of others;',
          'not import prospect data you are not entitled to process;',
          'review the messages Aaron proposes before they are sent, and check the amounts and commitments in the quotes generated;',
          'not attempt to circumvent the technical limits of the service, nor to access other customers\' data.',
        ]],
        'Emails go out from your own mailbox and under your identity: you are the sender in the legal sense, and the controller of your prospects\' data. We act as your processor.',
      ],
    },
    {
      h: '7. Access to your mailbox and calendar',
      b: [
        'Meet Aaron works only with the access you explicitly grant when connecting your Google or Microsoft account. That access serves only to provide the features you enabled: reading your prospects\' replies, sending emails on your behalf, and creating or viewing meetings.',
        `The use and transfer of information received from Google APIs adheres to the ${GOOGLE_LIMITED_USE_TERMS}, including its Limited Use requirements. In practice: this data is never sold, never used for advertising, never used to train an artificial-intelligence model, and is read by a human only if you ask us to in order to resolve a problem, if the law requires it, or for security reasons.`,
        'You can revoke that access at any time from the "Connections" screen in the app, or directly from the security settings of your Google or Microsoft account.',
      ],
    },
    {
      h: '8. Availability',
      b: [
        'We do everything we can to keep the service running, without being able to guarantee uninterrupted availability. The service may be suspended temporarily for maintenance, or disrupted by a failure at one of our technical providers (hosting, email, artificial-intelligence provider).',
      ],
    },
    {
      h: '9. Liability',
      b: [
        'Meet Aaron is a sales support tool. We guarantee no commercial result, no reply rate, and not the accuracy of content generated by artificial intelligence, which must be reviewed before use.',
        'We cannot be held liable for the consequences of the messages you choose to send, nor for indirect damage such as loss of revenue, customers or data attributable to a third party. In any event, our liability is limited to the sums you have paid us during the twelve months preceding the triggering event.',
      ],
    },
    {
      h: '10. Intellectual property',
      b: [
        'The application, its brand and its code remain our exclusive property. Your subscription grants you a personal, non-exclusive and non-transferable right of use, for the duration of the subscription.',
        'Your data, your documents and the content generated for your account belong to you. We do not use them to train artificial-intelligence models.',
      ],
    },
    {
      h: '11. Personal data',
      b: [
        'The processing of your data and that of your prospects is set out in our [privacy policy](/privacy), which forms an integral part of these terms.',
      ],
    },
    {
      h: '12. Suspension and closure of the account',
      b: [
        'We may suspend or close an account in the event of a serious breach of these terms, in particular abusive sending or unlawful use, after informing you unless the matter is urgent. You may, for your part, request the deletion of your account and the associated data at any time from the app or by writing to us.',
      ],
    },
    {
      h: '13. Changes to these terms',
      b: [
        'These terms may change along with the service. Any substantial change will be notified to you by email at least thirty days before it takes effect. If it does not suit you, you may cancel free of charge before that date.',
      ],
    },
    {
      h: '14. Governing law',
      b: [
        'These terms are governed by French law. In the event of a dispute, we will first seek an amicable solution; failing that, the French courts will have jurisdiction.',
      ],
    },
    {
      h: '15. Contact',
      b: [`For any question about these terms: ${MAIL}.`],
    },
  ],
  footer: 'See also our [privacy policy](/privacy).',
};

const de = {
  title: 'Nutzungsbedingungen',
  updated: 'Zuletzt aktualisiert: 8. September 2026',
  intro: [
    'Diese Bedingungen regeln die Nutzung von Meet Aaron, einem KI-gestützten Vertriebsassistenten, erreichbar unter meetaaron.app. Mit der Erstellung eines Kontos akzeptieren Sie sie vollständig.',
  ],
  sections: [
    {
      h: '1. Anbieter des Dienstes',
      b: [
        `Meet Aaron wird herausgegeben von **MEET AARON**, dem Einzelunternehmen von Alexandre Fevre, in Australien unter der ABN 72 369 751 951 eingetragen, mit Sitz in Perth (Westaustralien). Kontakt: ${MAIL}`,
        'Der Dienst wird von Vercel Inc. (Anwendung) und Supabase Inc. (Datenbank und Dateien) gehostet.',
      ],
    },
    {
      h: '2. Gegenstand des Dienstes',
      b: [
        'Meet Aaron ist ein berufliches Werkzeug zur Unterstützung von Vertriebsteams: Es verfasst und versendet Akquise-E-Mails in Ihrem Namen, verfolgt die Antworten Ihrer Interessenten, schlägt Termine vor, hält Ihre Vertriebspipeline aktuell und weist Sie auf offene Aufgaben hin.',
        'Aaron erstellt **Vorschläge**. Die von der künstlichen Intelligenz erzeugten E-Mails, Angebote und Termine bleiben unter Ihrer Kontrolle und in Ihrer Verantwortung: Sie entscheiden, was hinausgeht, an wen und wann.',
      ],
    },
    {
      h: '3. Wer Meet Aaron nutzen darf',
      b: [
        'Meet Aaron ist ein rein beruflicher Dienst (B2B), vorbehalten volljährigen Personen, die im Rahmen ihrer beruflichen Tätigkeit handeln. Er ist weder für die private Nutzung noch für Minderjährige bestimmt.',
        'Sie sind für die Vertraulichkeit Ihrer Zugangsdaten und für jede über Ihr Konto ausgeführte Aktivität verantwortlich. Informieren Sie uns unverzüglich bei unbefugter Nutzung.',
      ],
    },
    {
      h: '4. Abonnement, Preis und Kündigung',
      b: [
        ['ul', [
          'Das Aaron-Abonnement wird mit **30 € pro Monat und Nutzer** abgerechnet, ohne Mindestlaufzeit.',
          'Die Zahlung wird von Stripe abgewickelt. Wir speichern niemals Ihre Kartendaten.',
          'Das Abonnement verlängert sich automatisch monatlich bis zur Kündigung.',
          'Sie können jederzeit in Ihrem Kundenbereich kündigen. Die Kündigung wird zum Ende des bereits bezahlten Zeitraums wirksam: Der Dienst bleibt bis dahin verfügbar, danach wird nichts mehr abgebucht.',
          'Angefangene Zeiträume werden nicht anteilig erstattet, außer bei längerer, von uns zu vertretender Nichtverfügbarkeit des Dienstes.',
        ]],
        'Da es sich um einen Vertrag zwischen Unternehmern handelt, gilt das für Verbraucher vorgesehene vierzehntägige Widerrufsrecht nicht.',
      ],
    },
    {
      h: '5. Angemessene Nutzung der künstlichen Intelligenz',
      b: [
        'Jedes Abonnement enthält ein monatliches Kontingent für die Verarbeitung durch künstliche Intelligenz (in der Größenordnung von 20 € Verbrauch pro Nutzer und Monat). Es deckt eine normale vertriebliche Nutzung sehr großzügig ab.',
        'Dieses Kontingent gilt für die **Akquise**: Unternehmen finden, qualifizieren, erste E-Mails und Nachfassungen verfassen. Ist es aufgebraucht, pausiert die automatische Akquise bis zum Folgemonat.',
        'Die **Betreuung bereits laufender Konversationen** — Antworten an Ihre Interessenten, Verhandlungen, Kundenbeziehung — wird nicht auf dieses Kontingent angerechnet und läuft normal weiter. Eine laufende Verhandlung soll nicht abbrechen, weil das Akquise-Budget des Monats verbraucht ist.',
        'Eine globale Sicherheitsobergrenze bleibt bestehen, um anormale Nutzung abzudecken. Wir informieren Sie, bevor das Kontingent erreicht ist, und es kann auf Anfrage angehoben werden. Ihre Daten und der Rest der Anwendung sind nie betroffen.',
      ],
    },
    {
      h: '6. Ihre Pflichten',
      b: [
        'Sie verpflichten sich:',
        ['ul', [
          'die für die Vertriebsakquise geltenden Vorschriften einzuhalten, insbesondere die DSGVO und die Regeln zur elektronischen Kommunikation: über eine Rechtsgrundlage für die Kontaktaufnahme zu verfügen, die Betroffenen zu informieren und jedem Abmelde- oder Widerspruchswunsch unverzüglich nachzukommen;',
          'Meet Aaron weder für unaufgeforderte Massensendungen (Spam) noch für irreführende, rechtswidrige, verleumderische oder Rechte Dritter verletzende Inhalte zu nutzen;',
          'keine Interessentendaten zu importieren, zu deren Verarbeitung Sie nicht berechtigt sind;',
          'die von Aaron vorgeschlagenen Nachrichten vor dem Versand zu prüfen und die Beträge und Zusagen in den erzeugten Angeboten zu kontrollieren;',
          'nicht zu versuchen, die technischen Grenzen des Dienstes zu umgehen oder auf Daten anderer Kunden zuzugreifen.',
        ]],
        'Die E-Mails gehen aus Ihrem eigenen Postfach und unter Ihrer Identität hinaus: Sie sind der Absender im Rechtssinne und Verantwortlicher für die Daten Ihrer Interessenten. Wir handeln als Auftragsverarbeiter für Sie.',
      ],
    },
    {
      h: '7. Zugriff auf Postfach und Kalender',
      b: [
        'Meet Aaron arbeitet ausschließlich mit den Berechtigungen, die Sie beim Verbinden Ihres Google- oder Microsoft-Kontos ausdrücklich erteilen. Diese dienen allein den von Ihnen aktivierten Funktionen: die Antworten Ihrer Interessenten lesen, E-Mails in Ihrem Namen senden und Termine anlegen oder einsehen.',
        `Die Nutzung und Weitergabe von über Google-APIs erhaltenen Informationen entspricht der ${GOOGLE_LIMITED_USE_TERMS}, einschließlich ihrer Limited-Use-Anforderungen. Konkret: Diese Daten werden nie verkauft, nie für Werbung genutzt, nie zum Training eines Modells künstlicher Intelligenz verwendet und nur dann von einem Menschen gelesen, wenn Sie uns zur Lösung eines Problems darum bitten, das Gesetz es verlangt oder Sicherheitsgründe es erfordern.`,
        'Sie können diese Berechtigungen jederzeit über den Bildschirm „Verbindungen" der Anwendung widerrufen oder direkt in den Sicherheitseinstellungen Ihres Google- oder Microsoft-Kontos.',
      ],
    },
    {
      h: '8. Verfügbarkeit des Dienstes',
      b: [
        'Wir tun alles für einen durchgehenden Betrieb, können eine ununterbrochene Verfügbarkeit aber nicht garantieren. Der Dienst kann vorübergehend für Wartungsarbeiten ausgesetzt oder durch den Ausfall eines unserer technischen Dienstleister (Hosting, E-Mail, KI-Anbieter) gestört sein.',
      ],
    },
    {
      h: '9. Haftung',
      b: [
        'Meet Aaron ist ein Hilfsmittel für den Vertrieb. Wir garantieren weder einen Vertriebserfolg noch eine Antwortquote noch die Richtigkeit der von der künstlichen Intelligenz erzeugten Inhalte, die vor der Verwendung zu prüfen sind.',
        'Für die Folgen der Nachrichten, die Sie zu versenden wählen, sowie für mittelbare Schäden wie Umsatz-, Kunden- oder Datenverluste, die einem Dritten zuzurechnen sind, haften wir nicht. In jedem Fall ist unsere Haftung auf die Beträge begrenzt, die Sie uns in den zwölf Monaten vor dem schadensauslösenden Ereignis gezahlt haben.',
      ],
    },
    {
      h: '10. Geistiges Eigentum',
      b: [
        'Die Anwendung, ihre Marke und ihr Code bleiben unser ausschließliches Eigentum. Ihr Abonnement gewährt Ihnen ein persönliches, nicht ausschließliches und nicht übertragbares Nutzungsrecht für die Dauer des Abonnements.',
        'Ihre Daten, Ihre Dokumente und die für Ihr Konto erzeugten Inhalte gehören Ihnen. Wir verwenden sie nicht zum Training von Modellen künstlicher Intelligenz.',
      ],
    },
    {
      h: '11. Personenbezogene Daten',
      b: [
        'Die Verarbeitung Ihrer Daten und derjenigen Ihrer Interessenten ist in unserer [Datenschutzerklärung](/privacy) beschrieben, die Bestandteil dieser Bedingungen ist.',
      ],
    },
    {
      h: '12. Sperrung und Schließung des Kontos',
      b: [
        'Wir können ein Konto bei einem schweren Verstoß gegen diese Bedingungen sperren oder schließen, insbesondere bei missbräuchlichem Versand oder rechtswidriger Nutzung, nach vorheriger Information außer in dringenden Fällen. Sie können Ihrerseits jederzeit die Löschung Ihres Kontos und der zugehörigen Daten verlangen, über die Anwendung oder schriftlich an uns.',
      ],
    },
    {
      h: '13. Änderung der Bedingungen',
      b: [
        'Diese Bedingungen können sich mit dem Dienst weiterentwickeln. Jede wesentliche Änderung wird Ihnen mindestens dreißig Tage vor Inkrafttreten per E-Mail mitgeteilt. Sind Sie damit nicht einverstanden, können Sie vor diesem Datum kostenfrei kündigen.',
      ],
    },
    {
      h: '14. Anwendbares Recht',
      b: [
        'Diese Bedingungen unterliegen französischem Recht. Im Streitfall suchen wir zunächst eine gütliche Lösung; andernfalls sind die französischen Gerichte zuständig.',
      ],
    },
    {
      h: '15. Kontakt',
      b: [`Bei Fragen zu diesen Bedingungen: ${MAIL}.`],
    },
  ],
  footer: 'Siehe auch unsere [Datenschutzerklärung](/privacy). Diese Übersetzung dient Ihrer Bequemlichkeit; bei Abweichungen ist die englische Fassung maßgeblich.',
};

const it = {
  title: 'Condizioni generali di utilizzo',
  updated: 'Ultimo aggiornamento: 8 settembre 2026',
  intro: [
    "Le presenti condizioni disciplinano l'utilizzo di Meet Aaron, un assistente commerciale basato sull'intelligenza artificiale accessibile su meetaaron.app. Creando un account, le accettate integralmente.",
  ],
  sections: [
    {
      h: '1. Editore del servizio',
      b: [
        `Meet Aaron è edito da **MEET AARON**, impresa individuale di Alexandre Fevre, registrata in Australia con ABN 72 369 751 951 e con sede a Perth (Australia Occidentale). Contatto: ${MAIL}`,
        'Il servizio è ospitato da Vercel Inc. (applicazione) e Supabase Inc. (banca dati e file).',
      ],
    },
    {
      h: '2. Oggetto del servizio',
      b: [
        'Meet Aaron è uno strumento professionale che assiste i team commerciali: redige e invia email di prospezione a vostro nome, segue le risposte dei vostri contatti, propone fasce orarie per gli appuntamenti, tiene aggiornata la vostra pipeline commerciale e vi avvisa delle azioni in sospeso.',
        "Aaron produce **proposte**. Le email, i preventivi e gli appuntamenti generati dall'intelligenza artificiale restano sotto il vostro controllo e la vostra responsabilità: siete voi a decidere cosa parte, a chi e quando.",
      ],
    },
    {
      h: '3. Chi può usare Meet Aaron',
      b: [
        "Meet Aaron è un servizio strettamente professionale (B2B), riservato a persone maggiorenni che agiscono nell'ambito della propria attività professionale. Non è destinato né a un uso personale né ai minori.",
        "Siete responsabili della riservatezza delle vostre credenziali e di ogni attività svolta dal vostro account. Avvisateci senza indugio in caso di utilizzo non autorizzato.",
      ],
    },
    {
      h: '4. Abbonamento, prezzo e disdetta',
      b: [
        ['ul', [
          "L'abbonamento Aaron è fatturato **30 € al mese per utente**, senza vincolo di durata.",
          'Il pagamento è gestito da Stripe. Non conserviamo mai i dati della vostra carta.',
          "L'abbonamento si rinnova automaticamente ogni mese fino alla disdetta.",
          'Potete disdire in qualsiasi momento dalla vostra area cliente. La disdetta ha effetto alla fine del periodo già pagato: il servizio resta accessibile fino ad allora e non viene effettuato alcun ulteriore addebito.',
          'I periodi iniziati non sono rimborsati pro rata, salvo indisponibilità prolungata del servizio a noi imputabile.',
        ]],
        "Trattandosi di un contratto tra professionisti, il diritto di recesso di quattordici giorni previsto per i consumatori non si applica.",
      ],
    },
    {
      h: "5. Uso ragionevole dell'intelligenza artificiale",
      b: [
        "Ogni abbonamento include un plafond mensile di elaborazione tramite intelligenza artificiale (nell'ordine di 20 € di consumo per utente al mese). Copre ampiamente un uso commerciale normale.",
        "Questo plafond si applica alla **prospezione**: ricerca di imprese, qualificazione, redazione delle prime email e dei solleciti. Una volta esaurito, la prospezione automatica si interrompe fino al mese successivo.",
        "La **gestione delle conversazioni già avviate** — risposte ai vostri contatti, trattative, relazione con il cliente — non è scalata da questo plafond e prosegue normalmente. Una trattativa in corso non deve fermarsi perché il budget di prospezione del mese è esaurito.",
        "Resta in vigore un tetto di sicurezza globale per coprire gli usi anomali. Vi avvisiamo prima che il plafond sia raggiunto, e può essere aumentato su richiesta. I vostri dati e il resto dell'applicazione non sono mai toccati.",
      ],
    },
    {
      h: '6. I vostri obblighi',
      b: [
        'Vi impegnate a:',
        ['ul', [
          "rispettare la normativa applicabile alla prospezione commerciale, in particolare il GDPR e le regole sulle comunicazioni elettroniche: disporre di una base giuridica per contattare i vostri contatti, informarli e onorare immediatamente ogni richiesta di cancellazione o opposizione;",
          "non usare Meet Aaron né per invii massivi non sollecitati (spam), né per contenuti ingannevoli, illeciti, diffamatori o lesivi dei diritti altrui;",
          'non importare dati di contatti che non avete diritto di trattare;',
          "rileggere i messaggi proposti da Aaron prima dell'invio e verificare importi e impegni contenuti nei preventivi generati;",
          "non tentare di aggirare i limiti tecnici del servizio, né di accedere ai dati di altri clienti.",
        ]],
        "Le email partono dalla vostra casella e sotto la vostra identità: ne siete il mittente in senso giuridico e il titolare del trattamento dei dati dei vostri contatti. Noi agiamo come responsabili del trattamento per vostro conto.",
      ],
    },
    {
      h: '7. Accesso alla casella di posta e al calendario',
      b: [
        "Meet Aaron funziona solo con gli accessi che autorizzate esplicitamente al collegamento del vostro account Google o Microsoft. Tali accessi servono unicamente a fornire le funzioni che avete attivato: leggere le risposte dei vostri contatti, inviare email a vostro nome e creare o consultare appuntamenti.",
        `L'utilizzo e il trasferimento delle informazioni ricevute dalle API Google rispettano la ${GOOGLE_LIMITED_USE_TERMS}, comprese le sue esigenze di uso limitato (Limited Use). In concreto: questi dati non sono mai venduti, mai usati a fini pubblicitari, mai usati per addestrare un modello di intelligenza artificiale, e sono letti da un essere umano solo se ce lo chiedete per risolvere un problema, se la legge lo impone o per ragioni di sicurezza.`,
        "Potete revocare questi accessi in qualsiasi momento dalla schermata « Connessioni » dell'applicazione, oppure direttamente dalle impostazioni di sicurezza del vostro account Google o Microsoft.",
      ],
    },
    {
      h: '8. Disponibilità del servizio',
      b: [
        "Facciamo il possibile per assicurare un servizio continuo, senza poter garantire una disponibilità ininterrotta. Il servizio può essere sospeso temporaneamente per manutenzione, o perturbato da un guasto di uno dei nostri fornitori tecnici (hosting, posta, fornitore di intelligenza artificiale).",
      ],
    },
    {
      h: '9. Responsabilità',
      b: [
        "Meet Aaron è uno strumento di supporto alla vendita. Non garantiamo alcun risultato commerciale, alcun tasso di risposta, né l'esattezza dei contenuti generati dall'intelligenza artificiale, che devono essere riletti prima dell'uso.",
        "Non possiamo essere ritenuti responsabili delle conseguenze dei messaggi che scegliete di inviare, né dei danni indiretti quali perdita di fatturato, di clientela o di dati imputabile a un terzo. In ogni caso, la nostra responsabilità è limitata alle somme che ci avete versato nei dodici mesi precedenti il fatto generatore.",
      ],
    },
    {
      h: '10. Proprietà intellettuale',
      b: [
        "L'applicazione, il suo marchio e il suo codice restano di nostra proprietà esclusiva. Il vostro abbonamento vi conferisce un diritto d'uso personale, non esclusivo e non trasferibile, per la durata dell'abbonamento.",
        'I vostri dati, i vostri documenti e i contenuti generati per il vostro account vi appartengono. Non li usiamo per addestrare modelli di intelligenza artificiale.',
      ],
    },
    {
      h: '11. Dati personali',
      b: [
        "Il trattamento dei vostri dati e di quelli dei vostri contatti è descritto nella nostra [informativa sulla privacy](/privacy), che costituisce parte integrante delle presenti condizioni.",
      ],
    },
    {
      h: '12. Sospensione e chiusura del conto',
      b: [
        "Possiamo sospendere o chiudere un account in caso di grave violazione delle presenti condizioni, in particolare invii abusivi o uso illecito, dopo avervene informato salvo urgenza. Voi potete, da parte vostra, chiedere in qualsiasi momento la cancellazione del vostro account e dei dati associati, dall'applicazione o scrivendoci.",
      ],
    },
    {
      h: '13. Evoluzione delle condizioni',
      b: [
        "Queste condizioni possono evolvere con il servizio. Ogni modifica sostanziale vi sarà notificata via email almeno trenta giorni prima della sua entrata in vigore. Se non vi conviene, potete disdire senza spese prima di tale data.",
      ],
    },
    {
      h: '14. Legge applicabile',
      b: [
        "Le presenti condizioni sono soggette al diritto francese. In caso di controversia, cercheremo dapprima una soluzione amichevole; in mancanza, saranno competenti i tribunali francesi.",
      ],
    },
    {
      h: '15. Contatti',
      b: [`Per qualsiasi domanda su queste condizioni: ${MAIL}.`],
    },
  ],
  footer: "Vedi anche la nostra [informativa sulla privacy](/privacy). Questa traduzione è fornita per comodità; in caso di divergenza prevale la versione inglese.",
};

const es = {
  title: 'Condiciones generales de uso',
  updated: 'Última actualización: 8 de septiembre de 2026',
  intro: [
    'Estas condiciones regulan el uso de Meet Aaron, un asistente comercial basado en inteligencia artificial accesible en meetaaron.app. Al crear una cuenta, las aceptas sin reservas.',
  ],
  sections: [
    {
      h: '1. Editor del servicio',
      b: [
        `Meet Aaron está editado por **MEET AARON**, empresa individual de Alexandre Fevre, registrada en Australia con el ABN 72 369 751 951 y con sede en Perth (Australia Occidental). Contacto: ${MAIL}`,
        'El servicio está alojado por Vercel Inc. (aplicación) y Supabase Inc. (base de datos y archivos).',
      ],
    },
    {
      h: '2. Objeto del servicio',
      b: [
        'Meet Aaron es una herramienta profesional que asiste a los equipos comerciales: redacta y envía correos de prospección en tu nombre, hace seguimiento de las respuestas de tus posibles clientes, propone franjas para citas, mantiene al día tu pipeline comercial y te avisa de las acciones pendientes.',
        'Aaron produce **propuestas**. Los correos, presupuestos y citas generados por la inteligencia artificial siguen bajo tu control y tu responsabilidad: tú decides qué sale, a quién y cuándo.',
      ],
    },
    {
      h: '3. Quién puede usar Meet Aaron',
      b: [
        'Meet Aaron es un servicio estrictamente profesional (B2B), reservado a personas mayores de edad que actúan en el marco de su actividad profesional. No está destinado ni a un uso personal ni a menores.',
        'Eres responsable de la confidencialidad de tus credenciales y de toda actividad realizada desde tu cuenta. Avísanos sin demora en caso de uso no autorizado.',
      ],
    },
    {
      h: '4. Suscripción, precio y cancelación',
      b: [
        ['ul', [
          'La suscripción Aaron se factura a **30 € al mes por usuario**, sin permanencia.',
          'El pago lo gestiona Stripe. Nunca almacenamos los datos de tu tarjeta.',
          'La suscripción se renueva automáticamente cada mes hasta su cancelación.',
          'Puedes cancelar en cualquier momento desde tu área de cliente. La cancelación surte efecto al final del periodo ya pagado: el servicio sigue disponible hasta entonces y no se efectúa ningún cargo adicional.',
          'Los periodos iniciados no se reembolsan a prorrata, salvo indisponibilidad prolongada del servicio que nos sea imputable.',
        ]],
        'Al tratarse de un contrato entre profesionales, no se aplica el derecho de desistimiento de catorce días previsto para los consumidores.',
      ],
    },
    {
      h: '5. Uso razonable de la inteligencia artificial',
      b: [
        'Cada suscripción incluye una bolsa mensual de procesamiento por inteligencia artificial (del orden de 20 € de consumo por usuario y mes). Cubre con holgura un uso comercial normal.',
        'Esta bolsa se aplica a la **prospección**: búsqueda de empresas, cualificación, redacción de los primeros correos y de los recordatorios. Una vez agotada, la prospección automática se interrumpe hasta el mes siguiente.',
        'El **seguimiento de las conversaciones ya iniciadas** — respuestas a tus posibles clientes, negociaciones, relación con el cliente — no se descuenta de esta bolsa y continúa con normalidad. Una negociación en curso no debe detenerse porque el presupuesto de prospección del mes esté agotado.',
        'Se mantiene un techo de seguridad global para cubrir usos anómalos. Te avisamos antes de que se agote la bolsa, y puede ampliarse a petición. Tus datos y el resto de la aplicación nunca se ven afectados.',
      ],
    },
    {
      h: '6. Tus obligaciones',
      b: [
        'Te comprometes a:',
        ['ul', [
          'cumplir la normativa aplicable a la prospección comercial, en particular el RGPD y las normas sobre comunicaciones electrónicas: disponer de una base jurídica para contactar con tus posibles clientes, informarles y atender de inmediato cualquier solicitud de baja u oposición;',
          'no usar Meet Aaron ni para envíos masivos no solicitados (spam), ni para contenidos engañosos, ilícitos, difamatorios o lesivos de los derechos de terceros;',
          'no importar datos de posibles clientes que no tengas derecho a tratar;',
          'releer los mensajes propuestos por Aaron antes de su envío, y verificar los importes y compromisos que figuran en los presupuestos generados;',
          'no intentar eludir las limitaciones técnicas del servicio, ni acceder a los datos de otros clientes.',
        ]],
        'Los correos salen desde tu propio buzón y bajo tu identidad: eres el remitente en sentido jurídico y el responsable del tratamiento de los datos de tus posibles clientes. Nosotros actuamos como encargado del tratamiento por tu cuenta.',
      ],
    },
    {
      h: '7. Acceso a tu buzón y a tu calendario',
      b: [
        'Meet Aaron solo funciona con los accesos que autorizas explícitamente al conectar tu cuenta de Google o Microsoft. Esos accesos sirven únicamente para prestar las funciones que has activado: leer las respuestas de tus posibles clientes, enviar correos en tu nombre y crear o consultar citas.',
        `El uso y la transferencia de la información recibida de las API de Google respetan la ${GOOGLE_LIMITED_USE_TERMS}, incluidos sus requisitos de uso limitado (Limited Use). En concreto: estos datos nunca se venden, nunca se usan con fines publicitarios, nunca se usan para entrenar un modelo de inteligencia artificial, y solo los lee una persona si nos lo pides para resolver un problema, si la ley lo exige o por razones de seguridad.`,
        'Puedes revocar estos accesos en cualquier momento desde la pantalla «Conexiones» de la aplicación, o directamente desde los ajustes de seguridad de tu cuenta de Google o Microsoft.',
      ],
    },
    {
      h: '8. Disponibilidad del servicio',
      b: [
        'Hacemos todo lo posible para asegurar un servicio continuo, sin poder garantizar una disponibilidad ininterrumpida. El servicio puede suspenderse temporalmente por mantenimiento, o verse perturbado por un fallo de alguno de nuestros proveedores técnicos (alojamiento, correo, proveedor de inteligencia artificial).',
      ],
    },
    {
      h: '9. Responsabilidad',
      b: [
        'Meet Aaron es una herramienta de apoyo a la venta. No garantizamos ningún resultado comercial, ninguna tasa de respuesta, ni la exactitud de los contenidos generados por la inteligencia artificial, que deben releerse antes de su uso.',
        'No se nos podrá exigir responsabilidad por las consecuencias de los mensajes que decidas enviar, ni por daños indirectos como una pérdida de facturación, de clientela o de datos imputable a un tercero. En todo caso, nuestra responsabilidad se limita a las cantidades que nos hayas abonado durante los doce meses anteriores al hecho generador.',
      ],
    },
    {
      h: '10. Propiedad intelectual',
      b: [
        'La aplicación, su marca y su código siguen siendo de nuestra propiedad exclusiva. Tu suscripción te confiere un derecho de uso personal, no exclusivo y no transferible, mientras dure la suscripción.',
        'Tus datos, tus documentos y los contenidos generados para tu cuenta te pertenecen. No los usamos para entrenar modelos de inteligencia artificial.',
      ],
    },
    {
      h: '11. Datos personales',
      b: [
        'El tratamiento de tus datos y de los de tus posibles clientes se detalla en nuestra [política de privacidad](/privacy), que forma parte integrante de estas condiciones.',
      ],
    },
    {
      h: '12. Suspensión y cierre de la cuenta',
      b: [
        'Podemos suspender o cerrar una cuenta en caso de incumplimiento grave de estas condiciones, en particular por envíos abusivos o uso ilícito, tras habértelo comunicado salvo urgencia. Tú puedes, por tu parte, solicitar la eliminación de tu cuenta y de los datos asociados en cualquier momento desde la aplicación o escribiéndonos.',
      ],
    },
    {
      h: '13. Evolución de las condiciones',
      b: [
        'Estas condiciones pueden evolucionar con el servicio. Toda modificación sustancial te será notificada por correo al menos treinta días antes de su entrada en vigor. Si no te conviene, puedes cancelar sin gastos antes de esa fecha.',
      ],
    },
    {
      h: '14. Ley aplicable',
      b: [
        'Estas condiciones se rigen por el derecho francés. En caso de litigio, buscaremos primero una solución amistosa; en su defecto, serán competentes los tribunales franceses.',
      ],
    },
    {
      h: '15. Contacto',
      b: [`Para cualquier pregunta sobre estas condiciones: ${MAIL}.`],
    },
  ],
  footer: 'Consulta también nuestra [política de privacidad](/privacy). Esta traducción se ofrece por comodidad; en caso de discrepancia prevalece la versión en inglés.',
};

const pt = {
  title: 'Condições gerais de utilização',
  updated: 'Última atualização: 8 de setembro de 2026',
  intro: [
    'Estas condições regulam a utilização da Meet Aaron, um assistente comercial baseado em inteligência artificial acessível em meetaaron.app. Ao criar uma conta, aceita-as sem reservas.',
  ],
  sections: [
    {
      h: '1. Editor do serviço',
      b: [
        `A Meet Aaron é editada pela **MEET AARON**, empresa em nome individual de Alexandre Fevre, registada na Austrália com o ABN 72 369 751 951 e sediada em Perth (Austrália Ocidental). Contacto: ${MAIL}`,
        'O serviço é alojado pela Vercel Inc. (aplicação) e pela Supabase Inc. (base de dados e ficheiros).',
      ],
    },
    {
      h: '2. Objeto do serviço',
      b: [
        'A Meet Aaron é uma ferramenta profissional que apoia as equipas comerciais: redige e envia emails de prospeção em seu nome, acompanha as respostas dos seus potenciais clientes, propõe horários para reuniões, mantém atualizado o seu pipeline comercial e avisa-o das ações pendentes.',
        'O Aaron produz **propostas**. Os emails, orçamentos e reuniões gerados pela inteligência artificial permanecem sob o seu controlo e a sua responsabilidade: é você que decide o que sai, para quem e quando.',
      ],
    },
    {
      h: '3. Quem pode usar a Meet Aaron',
      b: [
        'A Meet Aaron é um serviço estritamente profissional (B2B), reservado a maiores de idade que atuam no âmbito da sua atividade profissional. Não se destina a uso pessoal nem a menores.',
        'É responsável pela confidencialidade das suas credenciais e por toda a atividade realizada a partir da sua conta. Avise-nos sem demora em caso de utilização não autorizada.',
      ],
    },
    {
      h: '4. Subscrição, preço e cancelamento',
      b: [
        ['ul', [
          'A subscrição Aaron é faturada a **30 € por mês e por utilizador**, sem período mínimo.',
          'O pagamento é tratado pela Stripe. Nunca guardamos os dados do seu cartão.',
          'A subscrição renova-se automaticamente todos os meses até ao cancelamento.',
          'Pode cancelar a qualquer momento na sua área de cliente. O cancelamento produz efeitos no fim do período já pago: o serviço permanece acessível até lá e não é efetuada qualquer cobrança adicional.',
          'Os períodos iniciados não são reembolsados proporcionalmente, salvo indisponibilidade prolongada do serviço que nos seja imputável.',
        ]],
        'Tratando-se de um contrato entre profissionais, o direito de livre resolução de catorze dias previsto para os consumidores não se aplica.',
      ],
    },
    {
      h: '5. Utilização razoável da inteligência artificial',
      b: [
        'Cada subscrição inclui um plafond mensal de processamento por inteligência artificial (da ordem de 20 € de consumo por utilizador e por mês). Cobre folgadamente uma utilização comercial normal.',
        'Este plafond aplica-se à **prospeção**: pesquisa de empresas, qualificação, redação dos primeiros emails e das insistências. Uma vez esgotado, a prospeção automática interrompe-se até ao mês seguinte.',
        'O **acompanhamento das conversas já iniciadas** — respostas aos seus potenciais clientes, negociações, relação com o cliente — não é descontado deste plafond e prossegue normalmente. Uma negociação em curso não deve parar porque o orçamento de prospeção do mês está esgotado.',
        'Mantém-se um teto de segurança global para cobrir utilizações anómalas. Avisamo-lo antes de o plafond ser atingido, e este pode ser aumentado a pedido. Os seus dados e o resto da aplicação nunca são afetados.',
      ],
    },
    {
      h: '6. As suas obrigações',
      b: [
        'Compromete-se a:',
        ['ul', [
          'respeitar a regulamentação aplicável à prospeção comercial, nomeadamente o RGPD e as regras relativas às comunicações eletrónicas: dispor de um fundamento jurídico para contactar os seus potenciais clientes, informá-los e satisfazer imediatamente qualquer pedido de cancelamento de subscrição ou de oposição;',
          'não usar a Meet Aaron para envios massivos não solicitados (spam), nem para conteúdos enganosos, ilícitos, difamatórios ou lesivos dos direitos de terceiros;',
          'não importar dados de potenciais clientes que não tem o direito de tratar;',
          'reler as mensagens propostas pelo Aaron antes do envio, e verificar os montantes e compromissos que constam dos orçamentos gerados;',
          'não tentar contornar as limitações técnicas do serviço, nem aceder aos dados de outros clientes.',
        ]],
        'Os emails partem da sua própria caixa de correio e sob a sua identidade: é o remetente no sentido jurídico e o responsável pelo tratamento dos dados dos seus potenciais clientes. Nós atuamos como subcontratante por sua conta.',
      ],
    },
    {
      h: '7. Acesso à sua caixa de correio e à sua agenda',
      b: [
        'A Meet Aaron só funciona com os acessos que autoriza explicitamente ao ligar a sua conta Google ou Microsoft. Esses acessos servem unicamente para prestar as funcionalidades que ativou: ler as respostas dos seus potenciais clientes, enviar emails em seu nome e criar ou consultar reuniões.',
        `A utilização e a transferência das informações recebidas das API Google respeitam a ${GOOGLE_LIMITED_USE_TERMS}, incluindo as suas exigências de utilização limitada (Limited Use). Concretamente: estes dados nunca são vendidos, nunca utilizados para fins publicitários, nunca utilizados para treinar um modelo de inteligência artificial, e só são lidos por uma pessoa se nos pedir para resolver um problema, se a lei o exigir, ou por razões de segurança.`,
        'Pode revogar estes acessos a qualquer momento no ecrã «Ligações» da aplicação, ou diretamente nas definições de segurança da sua conta Google ou Microsoft.',
      ],
    },
    {
      h: '8. Disponibilidade do serviço',
      b: [
        'Fazemos tudo o que está ao nosso alcance para assegurar um serviço contínuo, sem poder garantir uma disponibilidade ininterrupta. O serviço pode ser suspenso temporariamente para manutenção, ou perturbado por uma falha de um dos nossos prestadores técnicos (alojamento, correio, fornecedor de inteligência artificial).',
      ],
    },
    {
      h: '9. Responsabilidade',
      b: [
        'A Meet Aaron é uma ferramenta de apoio à venda. Não garantimos qualquer resultado comercial, qualquer taxa de resposta, nem a exatidão dos conteúdos gerados pela inteligência artificial, que devem ser relidos antes de utilizados.',
        'A nossa responsabilidade não pode ser invocada pelas consequências das mensagens que decide enviar, nem por danos indiretos como uma perda de faturação, de clientela ou de dados imputável a um terceiro. Em qualquer caso, a nossa responsabilidade está limitada às quantias que nos pagou nos doze meses anteriores ao facto gerador.',
      ],
    },
    {
      h: '10. Propriedade intelectual',
      b: [
        'A aplicação, a sua marca e o seu código permanecem nossa propriedade exclusiva. A sua subscrição confere-lhe um direito de utilização pessoal, não exclusivo e não transmissível, pela duração da subscrição.',
        'Os seus dados, os seus documentos e os conteúdos gerados para a sua conta pertencem-lhe. Não os utilizamos para treinar modelos de inteligência artificial.',
      ],
    },
    {
      h: '11. Dados pessoais',
      b: [
        'O tratamento dos seus dados e dos dos seus potenciais clientes é detalhado na nossa [política de privacidade](/privacy), que faz parte integrante das presentes condições.',
      ],
    },
    {
      h: '12. Suspensão e encerramento da conta',
      b: [
        'Podemos suspender ou encerrar uma conta em caso de incumprimento grave das presentes condições, nomeadamente em caso de envios abusivos ou utilização ilícita, depois de o termos informado salvo urgência. Pode, por seu lado, pedir a eliminação da sua conta e dos dados associados a qualquer momento, na aplicação ou escrevendo-nos.',
      ],
    },
    {
      h: '13. Evolução das condições',
      b: [
        'Estas condições podem evoluir com o serviço. Qualquer alteração substancial ser-lhe-á notificada por email pelo menos trinta dias antes da sua entrada em vigor. Se não lhe convier, pode cancelar sem custos antes dessa data.',
      ],
    },
    {
      h: '14. Lei aplicável',
      b: [
        'As presentes condições estão sujeitas ao direito francês. Em caso de litígio, procuraremos primeiro uma solução amigável; na sua falta, serão competentes os tribunais franceses.',
      ],
    },
    {
      h: '15. Contacto',
      b: [`Para qualquer questão sobre estas condições: ${MAIL}.`],
    },
  ],
  footer: 'Consulte também a nossa [política de privacidade](/privacy). Esta tradução é fornecida por conveniência; em caso de divergência prevalece a versão inglesa.',
};

const nl = {
  title: 'Gebruiksvoorwaarden',
  updated: 'Laatst bijgewerkt: 8 september 2026',
  intro: [
    'Deze voorwaarden regelen het gebruik van Meet Aaron, een verkoopassistent op basis van kunstmatige intelligentie, bereikbaar op meetaaron.app. Door een account aan te maken aanvaardt u ze zonder voorbehoud.',
  ],
  sections: [
    {
      h: '1. Uitgever van de dienst',
      b: [
        `Meet Aaron wordt uitgegeven door **MEET AARON**, de eenmanszaak van Alexandre Fevre, in Australië ingeschreven onder ABN 72 369 751 951 en gevestigd in Perth (West-Australië). Contact: ${MAIL}`,
        'De dienst wordt gehost door Vercel Inc. (applicatie) en Supabase Inc. (database en bestanden).',
      ],
    },
    {
      h: '2. Voorwerp van de dienst',
      b: [
        'Meet Aaron is een zakelijk hulpmiddel dat verkoopteams ondersteunt: het schrijft en verstuurt acquisitiemails namens u, volgt de antwoorden van uw prospects op, stelt afspraakmomenten voor, houdt uw verkooppijplijn bij en waarschuwt u voor openstaande acties.',
        'Aaron levert **voorstellen**. De door de kunstmatige intelligentie gegenereerde e-mails, offertes en afspraken blijven onder uw controle en uw verantwoordelijkheid: u bepaalt wat er uitgaat, naar wie en wanneer.',
      ],
    },
    {
      h: '3. Wie Meet Aaron mag gebruiken',
      b: [
        'Meet Aaron is een strikt zakelijke dienst (B2B), voorbehouden aan meerderjarigen die handelen in het kader van hun beroepsactiviteit. Hij is niet bestemd voor persoonlijk gebruik, noch voor minderjarigen.',
        'U bent verantwoordelijk voor de vertrouwelijkheid van uw inloggegevens en voor elke activiteit vanaf uw account. Laat het ons onverwijld weten bij ongeoorloofd gebruik.',
      ],
    },
    {
      h: '4. Abonnement, prijs en opzegging',
      b: [
        ['ul', [
          'Het Aaron-abonnement wordt gefactureerd tegen **€ 30 per maand per gebruiker**, zonder minimumduur.',
          'De betaling wordt door Stripe afgehandeld. Wij bewaren nooit uw kaartgegevens.',
          'Het abonnement wordt elke maand automatisch verlengd tot opzegging.',
          'U kunt op elk moment opzeggen via uw klantenruimte. De opzegging gaat in aan het einde van de reeds betaalde periode: de dienst blijft tot dan beschikbaar en er wordt daarna niets meer afgeschreven.',
          'Begonnen periodes worden niet pro rata terugbetaald, behalve bij langdurige onbeschikbaarheid van de dienst die ons toe te rekenen is.',
        ]],
        'Aangezien het om een overeenkomst tussen ondernemingen gaat, geldt het voor consumenten voorziene herroepingsrecht van veertien dagen niet.',
      ],
    },
    {
      h: '5. Redelijk gebruik van kunstmatige intelligentie',
      b: [
        'Elk abonnement bevat een maandelijks verwerkingstegoed voor kunstmatige intelligentie (in de orde van € 20 verbruik per gebruiker per maand). Het dekt een normaal commercieel gebruik ruimschoots.',
        'Dit tegoed geldt voor **acquisitie**: bedrijven zoeken, kwalificeren, eerste e-mails en herinneringen schrijven. Zodra het op is, pauzeert de automatische acquisitie tot de volgende maand.',
        'Het **opvolgen van reeds lopende gesprekken** — antwoorden aan uw prospects, onderhandelingen, klantrelatie — wordt niet van dit tegoed afgetrokken en loopt gewoon door. Een lopende onderhandeling hoort niet te stoppen omdat het acquisitiebudget van de maand op is.',
        'Er blijft een algemeen veiligheidsplafond van kracht voor afwijkend gebruik. Wij waarschuwen u voordat het tegoed op is, en het kan op verzoek worden verhoogd. Uw gegevens en de rest van de applicatie worden nooit geraakt.',
      ],
    },
    {
      h: '6. Uw verplichtingen',
      b: [
        'U verbindt zich ertoe:',
        ['ul', [
          'de regelgeving inzake commerciële acquisitie na te leven, in het bijzonder de AVG en de regels voor elektronische communicatie: over een rechtsgrond beschikken om uw prospects te benaderen, hen informeren, en elk verzoek tot afmelding of bezwaar onmiddellijk inwilligen;',
          'Meet Aaron niet te gebruiken voor ongevraagde massaverzendingen (spam), noch voor misleidende, onrechtmatige of lasterlijke inhoud of inhoud die de rechten van anderen schendt;',
          'geen prospectgegevens te importeren die u niet gerechtigd bent te verwerken;',
          'de door Aaron voorgestelde berichten vóór verzending na te lezen, en de bedragen en verbintenissen in de gegenereerde offertes te controleren;',
          'niet te proberen de technische beperkingen van de dienst te omzeilen, noch toegang te krijgen tot gegevens van andere klanten.',
        ]],
        'De e-mails vertrekken vanuit uw eigen mailbox en onder uw identiteit: u bent de afzender in juridische zin en de verwerkingsverantwoordelijke voor de gegevens van uw prospects. Wij treden op als verwerker voor uw rekening.',
      ],
    },
    {
      h: '7. Toegang tot uw mailbox en uw agenda',
      b: [
        'Meet Aaron werkt uitsluitend met de toegang die u uitdrukkelijk verleent bij het koppelen van uw Google- of Microsoft-account. Die toegang dient enkel om de functies te leveren die u hebt ingeschakeld: de antwoorden van uw prospects lezen, e-mails namens u versturen, en afspraken aanmaken of inzien.',
        `Het gebruik en de doorgifte van informatie ontvangen via de Google-API's voldoen aan de ${GOOGLE_LIMITED_USE_TERMS}, met inbegrip van de Limited Use-vereisten. Concreet: deze gegevens worden nooit verkocht, nooit voor reclame gebruikt, nooit gebruikt om een model voor kunstmatige intelligentie te trainen, en worden alleen door een mens gelezen als u ons daarom vraagt om een probleem op te lossen, als de wet dat vereist, of om veiligheidsredenen.`,
        'U kunt deze toegang op elk moment intrekken via het scherm „Verbindingen" van de applicatie, of rechtstreeks in de beveiligingsinstellingen van uw Google- of Microsoft-account.',
      ],
    },
    {
      h: '8. Beschikbaarheid van de dienst',
      b: [
        'Wij doen er alles aan om een doorlopende dienst te verzekeren, zonder een ononderbroken beschikbaarheid te kunnen garanderen. De dienst kan tijdelijk worden opgeschort voor onderhoud, of verstoord door een storing bij een van onze technische dienstverleners (hosting, e-mail, aanbieder van kunstmatige intelligentie).',
      ],
    },
    {
      h: '9. Aansprakelijkheid',
      b: [
        'Meet Aaron is een hulpmiddel voor de verkoop. Wij garanderen geen commercieel resultaat, geen antwoordpercentage, en evenmin de juistheid van de door de kunstmatige intelligentie gegenereerde inhoud, die vóór gebruik moet worden nagelezen.',
        'Wij kunnen niet aansprakelijk worden gesteld voor de gevolgen van de berichten die u verkiest te versturen, noch voor indirecte schade zoals verlies van omzet, klanten of gegevens die aan een derde toe te rekenen is. In elk geval is onze aansprakelijkheid beperkt tot de bedragen die u ons hebt betaald in de twaalf maanden voorafgaand aan het schadeveroorzakende feit.',
      ],
    },
    {
      h: '10. Intellectuele eigendom',
      b: [
        'De applicatie, haar merk en haar code blijven onze exclusieve eigendom. Uw abonnement verleent u een persoonlijk, niet-exclusief en niet-overdraagbaar gebruiksrecht voor de duur van het abonnement.',
        'Uw gegevens, uw documenten en de voor uw account gegenereerde inhoud behoren u toe. Wij gebruiken ze niet om modellen voor kunstmatige intelligentie te trainen.',
      ],
    },
    {
      h: '11. Persoonsgegevens',
      b: [
        'De verwerking van uw gegevens en die van uw prospects staat beschreven in ons [privacybeleid](/privacy), dat integraal deel uitmaakt van deze voorwaarden.',
      ],
    },
    {
      h: '12. Opschorting en sluiting van het account',
      b: [
        'Wij kunnen een account opschorten of sluiten bij een ernstige inbreuk op deze voorwaarden, in het bijzonder bij misbruik van verzendingen of onrechtmatig gebruik, na u te hebben ingelicht behalve in spoedgevallen. U kunt van uw kant op elk moment de verwijdering van uw account en de bijbehorende gegevens vragen, via de applicatie of door ons te schrijven.',
      ],
    },
    {
      h: '13. Wijziging van de voorwaarden',
      b: [
        'Deze voorwaarden kunnen mee evolueren met de dienst. Elke wezenlijke wijziging wordt u ten minste dertig dagen vóór de inwerkingtreding per e-mail meegedeeld. Als zij u niet past, kunt u vóór die datum kosteloos opzeggen.',
      ],
    },
    {
      h: '14. Toepasselijk recht',
      b: [
        'Deze voorwaarden zijn onderworpen aan het Franse recht. Bij een geschil zoeken wij eerst een minnelijke oplossing; bij gebreke daarvan zijn de Franse rechtbanken bevoegd.',
      ],
    },
    {
      h: '15. Contact',
      b: [`Voor elke vraag over deze voorwaarden: ${MAIL}.`],
    },
  ],
  footer: 'Zie ook ons [privacybeleid](/privacy). Deze vertaling is bedoeld voor uw gemak; bij afwijkingen prevaleert de Engelse versie.',
};

const TERMS = { fr, en, de, it, es, pt, nl };

const BACK_LABEL = {
  fr: '← Retour aux préférences',
  en: '← Back to preferences',
  de: '← Zurück zu den Einstellungen',
  it: '← Torna alle preferenze',
  es: '← Volver a las preferencias',
  pt: '← Voltar às preferências',
  nl: '← Terug naar voorkeuren',
};

export default function TermsPage() {
  const [locale] = useLocale();
  return <LegalPage documents={TERMS} backLabel={BACK_LABEL} locale={locale} />;
}
