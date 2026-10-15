'use client';
// app/incident-response/page.jsx
//
// Politique de réponse aux incidents de sécurité — page publique, servie sans
// authentification sur https://meetaaron.app/incident-response
//
// Pourquoi elle existe (15/10/2026) : deuxième des trois documents réclamés
// par le tableau de bord CASA de TAC Security, après /security et avant
// /vulnerability-disclosure.
//
// RÈGLE ABSOLUE, la même que pour /security : ce document ne promet que ce
// qui est réellement tenable par une entreprise individuelle d'une seule
// personne. Promettre une astreinte 24/7 ou une équipe de réponse serait un
// mensonge vérifiable en une question, et c'est précisément le genre de
// détail qui fait basculer un audit de routine en dossier à problème.
//
// Les délais annoncés ci-dessous sont donc volontairement modestes et
// atteignables seul, avec une distinction nette entre ce qui est GARANTI
// (notification réglementaire sous 72 h, qui est une obligation légale) et ce
// qui est un OBJECTIF (délais de première réponse). La section « Limites
// connues » déclare l'absence d'astreinte nocturne au lieu de la cacher.
//
// Anglais et français seulement : le lectorat est constitué d'évaluateurs de
// sécurité et de directions informatiques. LegalPage retombe sur l'anglais
// pour toute autre langue.
import LegalPage from '@/components/LegalPage';
import { useLocale } from '@/lib/i18n';

const UPDATED = '15 octobre 2026';
const UPDATED_EN = 'Last updated: 15 October 2026';
const MAIL = 'aaron@meetaaron.app';

const fr = {
  title: 'Politique de réponse aux incidents de sécurité',
  updated: `Dernière mise à jour : ${UPDATED}`,
  intro: [
    'Meet Aaron accède à la boîte mail et à l\'agenda professionnels de ses utilisateurs. Un incident de sécurité sur ce service peut donc exposer de la correspondance professionnelle, et ce document décrit exactement ce qui se passe dans ce cas : comment un incident est détecté, qui agit, dans quels délais, et qui est averti.',
    'Les délais annoncés ici sont ceux d\'une entreprise individuelle. Ils sont volontairement modestes plutôt qu\'ambitieux : un délai annoncé est un délai tenu.',
  ],
  sections: [
    {
      id: 'perimetre',
      h: '1. Périmètre',
      b: [
        'Ce document couvre l\'application Meet Aaron (https://meetaaron.app), ses interfaces de programmation, ses applications mobiles — qui ne sont que des coques affichant cette même application web — et les comptes d\'hébergement et de base de données qui la font tourner.',
        'L\'éditeur et seul responsable de la réponse aux incidents est **Alexandre Fevre**, entreprise individuelle australienne (ABN 72 369 751 951), exerçant sous le nom commercial **Meet Aaron**.',
      ],
    },
    {
      id: 'definition',
      h: '2. Ce que nous appelons un incident',
      b: [
        'Est traité comme incident de sécurité tout événement qui compromet, ou peut compromettre, la confidentialité, l\'intégrité ou la disponibilité des données des utilisateurs :',
        ['ul', [
          'un accès non autorisé à la base de données, à l\'hébergement, ou à un compte administrateur ;',
          'une fuite ou une exposition de jetons d\'accès à une boîte mail ou à un agenda ;',
          'une faille permettant à un utilisateur de voir les données d\'un autre ;',
          'un envoi de messages depuis la boîte d\'un utilisateur sans son accord ;',
          'une perte de données, ou une indisponibilité prolongée du service ;',
          'la compromission d\'un prestataire traitant des données utilisateurs.',
        ]],
        'Un simple dysfonctionnement sans conséquence sur les données — une page qui s\'affiche mal, un bouton qui ne répond pas — n\'est pas un incident de sécurité et suit le traitement de bogue ordinaire.',
      ],
    },
    {
      id: 'gravite',
      h: '3. Niveaux de gravité',
      b: [
        '**P1 — Critique.** Données d\'utilisateurs accessibles par un tiers, jetons d\'accès exposés, ou envoi de messages non autorisés en cours. Traitement immédiat, avant toute autre tâche.',
        '**P2 — Élevé.** Faille exploitable identifiée mais sans preuve d\'exploitation, ou compromission d\'un compte de service sans accès aux données utilisateurs.',
        '**P3 — Modéré.** Faiblesse réelle mais dont l\'exploitation suppose des conditions improbables, ou indisponibilité du service sans perte de données.',
        '**P4 — Faible.** Écart de configuration ou de bonne pratique sans voie d\'exploitation identifiée.',
      ],
    },
    {
      id: 'detection',
      h: '4. Détection',
      b: [
        'Un incident peut nous parvenir par quatre voies :',
        ['ul', [
          'une alerte automatique de l\'hébergeur ou de la base de données (erreurs applicatives, pics de trafic, échecs d\'authentification répétés) ;',
          'une anomalie relevée lors de la lecture des journaux applicatifs ;',
          'un signalement d\'utilisateur, par courriel ou depuis l\'application ;',
          'un signalement externe de chercheur en sécurité, selon notre [politique de divulgation des vulnérabilités](/vulnerability-disclosure).',
        ]],
        'Nous ne disposons pas d\'un centre de surveillance permanent. Les alertes automatiques arrivent par courriel et par notification mobile, et sont relevées aux heures ouvrées australiennes (AWST).',
      ],
    },
    {
      id: 'roles',
      h: '5. Rôles',
      b: [
        'Meet Aaron est édité par une seule personne. En cas d\'incident, cette personne cumule les rôles de coordinateur, d\'analyste technique et de point de contact pour les utilisateurs et les autorités.',
        'C\'est une limite et nous la déclarons comme telle à la dernière section. Son revers est qu\'il n\'y a aucune chaîne d\'escalade à remonter : la décision de couper le service, de révoquer tous les jetons ou de notifier les utilisateurs peut être prise en quelques minutes.',
      ],
    },
    {
      id: 'procedure',
      h: '6. Procédure de réponse',
      b: [
        '**Étape 1 — Confinement.** Avant tout diagnostic, arrêter l\'exposition. Selon l\'incident : révocation des jetons d\'accès concernés, désactivation des tâches planifiées qui envoient des messages, suspension du compte compromis, retrait en ligne de la version fautive, ou mise hors service du site si rien d\'autre ne suffit. Couper le service est une décision acceptable ; laisser une fuite ouverte pendant l\'enquête ne l\'est pas.',
        '**Étape 2 — Évaluation.** Déterminer ce qui a été atteint, par qui, pendant combien de temps, et quels utilisateurs sont concernés. Les journaux d\'accès de l\'hébergement et de la base de données sont conservés à cette fin.',
        '**Étape 3 — Éradication.** Corriger la cause, pas seulement le symptôme : rotation de tous les secrets susceptibles d\'avoir été exposés, correctif de code, fermeture de l\'accès utilisé.',
        '**Étape 4 — Rétablissement.** Remettre le service en ligne, vérifier que la voie d\'accès est fermée, surveiller les journaux de façon rapprochée pendant les sept jours qui suivent.',
        '**Étape 5 — Notification.** Informer les personnes concernées et, le cas échéant, les autorités et les prestataires, selon la section 8.',
        '**Étape 6 — Revue.** Consigner l\'incident par écrit et en tirer une mesure concrète, selon la section 9.',
      ],
    },
    {
      id: 'delais',
      h: '7. Délais',
      b: [
        'Les délais ci-dessous courent à partir du moment où l\'incident nous est **connu**, et non du moment où il s\'est produit.',
        ['ul', [
          '**P1** : première action de confinement sous 4 heures ; information des utilisateurs concernés sous 72 heures.',
          '**P2** : prise en charge sous 1 jour ouvré ; correctif sous 7 jours.',
          '**P3** : prise en charge sous 5 jours ouvrés ; correctif sous 30 jours.',
          '**P4** : traité dans le cadre du cycle de développement ordinaire.',
        ]],
        'Le délai de notification réglementaire de 72 heures prévu à la section 8 n\'est pas un objectif : c\'est une obligation légale, et il prime sur tout le reste, y compris sur le fait de disposer d\'un diagnostic complet. Une notification partielle dans les délais vaut mieux qu\'une notification complète en retard.',
      ],
    },
    {
      id: 'notification',
      h: '8. Notification',
      b: [
        '**Aux utilisateurs concernés.** En cas de violation de données personnelles susceptible de leur porter atteinte, nous les informons par courriel à l\'adresse de leur compte, sous 72 heures à compter de la prise de connaissance. Le message indique ce qui s\'est passé, quelles données sont concernées, ce que nous avons fait, et ce qu\'ils doivent faire de leur côté.',
        '**Aux autorités de protection des données.** Pour les utilisateurs établis dans l\'Union européenne, nous notifions l\'autorité compétente sous 72 heures lorsque le RGPD l\'exige. Pour l\'Australie, nous notifions l\'Office of the Australian Information Commissioner lorsque le régime des Notifiable Data Breaches s\'applique, et nous le faisons volontairement lorsqu\'un doute subsiste sur son applicabilité à une entreprise de notre taille.',
        '**Aux prestataires.** Si l\'incident implique Google, Microsoft, Supabase, Vercel, Stripe, Anthropic ou OpenAI, nous les informons par leurs canaux de signalement dédiés. Pour les données issues des interfaces Google, nous respectons les obligations de notification du programme de vérification OAuth.',
        '**Publiquement.** Un incident de niveau P1 ayant touché des données d\'utilisateurs fait l\'objet d\'une description écrite publiée après rétablissement, sans détail exploitable et sans information permettant d\'identifier un utilisateur.',
      ],
    },
    {
      id: 'preuves',
      h: '9. Preuves et revue',
      b: [
        'Chaque incident, à partir du niveau P3, donne lieu à une fiche écrite conservée au moins deux ans : date de détection, voie de détection, gravité retenue, chronologie des actions, données concernées, cause racine, et la mesure prise pour que cela ne se reproduise pas.',
        'Une revue est menée dans les deux semaines qui suivent le rétablissement. Elle doit produire au moins une modification concrète — un correctif, un contrôle supplémentaire, une alerte, une procédure — et non un simple constat. Un incident sans mesure corrective est considéré comme non clos.',
      ],
    },
    {
      id: 'limites',
      h: '10. Limites connues',
      b: [
        'Nous préférons les déclarer plutôt que de laisser croire à des moyens que nous n\'avons pas :',
        ['ul', [
          '**Pas d\'astreinte 24/7.** Meet Aaron est édité par une seule personne. Un incident survenant la nuit australienne peut n\'être pris en charge qu\'au matin. Les alertes automatiques et les notifications mobiles réduisent ce délai mais ne le suppriment pas.',
          '**Pas de redondance humaine.** Aucun suppléant ne peut prendre le relais si l\'éditeur est indisponible. En contrepartie, l\'infrastructure est entièrement gérée par des prestataires (hébergement, base de données, messagerie) dont la disponibilité ne dépend pas de notre présence.',
          '**Pas d\'exercice de crise formalisé.** Aucune simulation d\'incident n\'a été conduite à ce jour.',
          '**Détection essentiellement réactive.** Nous n\'exploitons pas de système de détection d\'intrusion. La détection repose sur les alertes des prestataires, la lecture des journaux et les signalements.',
        ]],
      ],
    },
    {
      id: 'contact',
      h: '11. Contact',
      b: [
        `Pour signaler un incident en cours : [${MAIL}](mailto:${MAIL}), avec « INCIDENT » en objet.`,
        'Pour signaler une faille non encore exploitée, suivez notre [politique de divulgation des vulnérabilités](/vulnerability-disclosure).',
        'Les mesures de sécurité en place sont décrites dans notre [politique de sécurité de l\'information](/security).',
      ],
    },
  ],
  footer: 'Voir aussi notre [politique de confidentialité](/privacy) et nos [conditions d\'utilisation](/terms). En cas de divergence entre les versions, la version anglaise prévaut.',
};

const en = {
  title: 'Security Incident Response Policy',
  updated: UPDATED_EN,
  intro: [
    'Meet Aaron accesses its users\' business mailbox and calendar. A security incident on this service can therefore expose business correspondence, and this document describes exactly what happens in that case: how an incident is detected, who acts, within what timeframes, and who gets notified.',
    'The timeframes stated here are those of a sole trader. They are deliberately modest rather than ambitious: a stated timeframe is a timeframe we meet.',
  ],
  sections: [
    {
      id: 'perimetre',
      h: '1. Scope',
      b: [
        'This document covers the Meet Aaron application (https://meetaaron.app), its programming interfaces, its mobile applications — which are only shells displaying that same web application — and the hosting and database accounts that run it.',
        'The publisher and sole party responsible for incident response is **Alexandre Fevre**, an Australian sole trader (ABN 72 369 751 951), trading as **Meet Aaron**.',
      ],
    },
    {
      id: 'definition',
      h: '2. What we treat as an incident',
      b: [
        'Any event that compromises, or may compromise, the confidentiality, integrity or availability of user data is handled as a security incident:',
        ['ul', [
          'unauthorised access to the database, the hosting, or an administrator account;',
          'leakage or exposure of mailbox or calendar access tokens;',
          'a flaw allowing one user to see another user\'s data;',
          'messages sent from a user\'s mailbox without their consent;',
          'data loss, or extended unavailability of the service;',
          'compromise of a subprocessor handling user data.',
        ]],
        'A plain malfunction with no consequence for data — a page that renders badly, a button that does not respond — is not a security incident and follows the ordinary bug process.',
      ],
    },
    {
      id: 'gravite',
      h: '3. Severity levels',
      b: [
        '**P1 — Critical.** User data accessible to a third party, access tokens exposed, or unauthorised message sending under way. Handled immediately, ahead of any other task.',
        '**P2 — High.** An exploitable flaw identified but with no evidence of exploitation, or compromise of a service account without access to user data.',
        '**P3 — Moderate.** A real weakness whose exploitation requires improbable conditions, or unavailability of the service without data loss.',
        '**P4 — Low.** A configuration or best-practice gap with no identified exploitation path.',
      ],
    },
    {
      id: 'detection',
      h: '4. Detection',
      b: [
        'An incident can reach us through four channels:',
        ['ul', [
          'an automated alert from the host or the database (application errors, traffic spikes, repeated authentication failures);',
          'an anomaly noticed while reading application logs;',
          'a user report, by email or from within the application;',
          'an external report from a security researcher, under our [vulnerability disclosure policy](/vulnerability-disclosure).',
        ]],
        'We do not operate a round-the-clock monitoring centre. Automated alerts arrive by email and mobile notification, and are reviewed during Australian business hours (AWST).',
      ],
    },
    {
      id: 'roles',
      h: '5. Roles',
      b: [
        'Meet Aaron is published by one person. During an incident, that person holds the roles of coordinator, technical analyst and point of contact for users and authorities.',
        'This is a limitation and we declare it as such in the last section. Its upside is that there is no escalation chain to climb: the decision to take the service down, revoke every token or notify users can be taken within minutes.',
      ],
    },
    {
      id: 'procedure',
      h: '6. Response procedure',
      b: [
        '**Step 1 — Containment.** Before any diagnosis, stop the exposure. Depending on the incident: revoking the affected access tokens, disabling the scheduled tasks that send messages, suspending the compromised account, rolling back the faulty release, or taking the site offline if nothing else is enough. Taking the service down is an acceptable decision; leaving a leak open during the investigation is not.',
        '**Step 2 — Assessment.** Establish what was reached, by whom, for how long, and which users are affected. Access logs from the host and the database are retained for this purpose.',
        '**Step 3 — Eradication.** Fix the cause, not just the symptom: rotation of every secret that may have been exposed, code fix, closing of the access path used.',
        '**Step 4 — Recovery.** Bring the service back, verify that the access path is closed, and monitor logs closely for the following seven days.',
        '**Step 5 — Notification.** Inform affected individuals and, where applicable, authorities and subprocessors, per section 8.',
        '**Step 6 — Review.** Record the incident in writing and derive one concrete measure from it, per section 9.',
      ],
    },
    {
      id: 'delais',
      h: '7. Timeframes',
      b: [
        'The timeframes below run from the moment the incident becomes **known** to us, not from the moment it occurred.',
        ['ul', [
          '**P1**: first containment action within 4 hours; affected users informed within 72 hours.',
          '**P2**: triage within 1 business day; fix within 7 days.',
          '**P3**: triage within 5 business days; fix within 30 days.',
          '**P4**: handled as part of the ordinary development cycle.',
        ]],
        'The 72-hour regulatory notification deadline in section 8 is not a target: it is a legal obligation, and it takes precedence over everything else, including over having a complete diagnosis. A partial notification on time is better than a complete one late.',
      ],
    },
    {
      id: 'notification',
      h: '8. Notification',
      b: [
        '**Affected users.** In the event of a personal data breach likely to adversely affect them, we inform them by email at their account address, within 72 hours of becoming aware of it. The message states what happened, which data is affected, what we have done, and what they should do on their side.',
        '**Data protection authorities.** For users established in the European Union, we notify the competent authority within 72 hours where the GDPR requires it. For Australia, we notify the Office of the Australian Information Commissioner where the Notifiable Data Breaches scheme applies, and we do so voluntarily where there is any doubt as to its applicability to a business of our size.',
        '**Subprocessors.** If the incident involves Google, Microsoft, Supabase, Vercel, Stripe, Anthropic or OpenAI, we inform them through their dedicated reporting channels. For data obtained from Google APIs, we comply with the notification obligations of the OAuth verification programme.',
        '**Publicly.** A P1 incident affecting user data is described in writing and published after recovery, without exploitable detail and without any information identifying a user.',
      ],
    },
    {
      id: 'preuves',
      h: '9. Evidence and review',
      b: [
        'Every incident of severity P3 or above is recorded in a written record kept for at least two years: detection date, detection channel, severity assigned, timeline of actions, data affected, root cause, and the measure taken so that it does not happen again.',
        'A review is carried out within two weeks of recovery. It must produce at least one concrete change — a fix, an additional control, an alert, a procedure — rather than a mere observation. An incident with no corrective measure is treated as not closed.',
      ],
    },
    {
      id: 'limites',
      h: '10. Known limitations',
      b: [
        'We would rather declare these than imply resources we do not have:',
        ['ul', [
          '**No 24/7 on-call.** Meet Aaron is published by one person. An incident occurring during the Australian night may only be picked up the following morning. Automated alerts and mobile notifications shorten that delay but do not remove it.',
          '**No human redundancy.** No deputy can take over if the publisher is unavailable. In exchange, the infrastructure is entirely operated by providers (hosting, database, mail) whose availability does not depend on our presence.',
          '**No formal crisis exercise.** No incident simulation has been run to date.',
          '**Detection is largely reactive.** We do not operate an intrusion detection system. Detection relies on provider alerts, log review and reports.',
        ]],
      ],
    },
    {
      id: 'contact',
      h: '11. Contact',
      b: [
        `To report an incident in progress: [${MAIL}](mailto:${MAIL}), with "INCIDENT" in the subject line.`,
        'To report a flaw that has not yet been exploited, please follow our [vulnerability disclosure policy](/vulnerability-disclosure).',
        'The security measures in place are described in our [information security policy](/security).',
      ],
    },
  ],
  footer: 'See also our [privacy policy](/privacy) and our [terms of use](/terms). In case of discrepancy between versions, the English version prevails.',
};

const POLICIES = { fr, en };

const BACK_LABEL = {
  fr: '← Retour aux préférences',
  en: '← Back to preferences',
};

export default function IncidentResponsePolicyPage() {
  const [locale] = useLocale();
  return <LegalPage documents={POLICIES} backLabel={BACK_LABEL} locale={locale} />;
}
