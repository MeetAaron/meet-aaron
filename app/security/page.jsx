'use client';
// app/security/page.jsx
//
// Politique de sécurité de l'information — page publique, servie sans
// authentification sur https://meetaaron.app/security
//
// Pourquoi elle existe (15/10/2026) : le tableau de bord CASA de TAC Security
// réclame quatre documents à l'étape « Assessment Review ». La politique de
// confidentialité existait déjà (/privacy) ; les trois autres manquaient.
// Celle-ci est la première des trois, avec /incident-response et
// /vulnerability-disclosure.
//
// RÈGLE ABSOLUE pour ce fichier : chaque phrase doit décrire ce que
// l'application fait RÉELLEMENT. Une politique de sécurité qui promet plus
// que le code ne tient est pire que pas de politique du tout — c'est
// exactement ce qu'un évaluateur cherche, et c'est ce qui transforme un
// audit de routine en dossier à problème. Les affirmations ci-dessous sont
// toutes vérifiables dans le dépôt, fichier par fichier :
//   - chiffrement applicatif des jetons    lib/encryption.ts
//   - authentification des appels API      lib/auth-helpers.ts
//   - protection des tâches planifiées     app/api/cron/*/route.ts
//   - suppression de compte                lib/account-deletion.ts
//   - sous-traitants                       app/privacy/page.jsx
//
// Le point faible connu (absence de RLS, autorisation portée par le code
// applicatif) est ÉCRIT dans le document, à la section « Limites connues ».
// C'est délibéré : un évaluateur qui trouve lui-même une faiblesse tue le
// dossier ; une faiblesse déclarée et accompagnée d'un plan le renforce.
//
// Anglais et français seulement, et c'est assumé : contrairement à /privacy
// et /terms qui s'adressent aux utilisateurs dans leur langue, ce document
// s'adresse à des évaluateurs de sécurité et à des directions informatiques,
// pour qui l'anglais est la langue de travail. LegalPage retombe sur
// l'anglais pour toute autre langue.
import LegalPage from '@/components/LegalPage';
import { useLocale } from '@/lib/i18n';

const UPDATED = '15 octobre 2026';
const UPDATED_EN = 'Last updated: 15 October 2026';
const MAIL = 'aaron@meetaaron.app';

const fr = {
  title: 'Politique de sécurité de l\'information',
  updated: `Dernière mise à jour : ${UPDATED}`,
  intro: [
    'Meet Aaron accède à la boîte mail et à l\'agenda professionnels de ses utilisateurs pour rédiger, envoyer et suivre leurs messages de prospection. C\'est un niveau d\'accès considérable, et ce document décrit précisément comment il est protégé.',
    'Chaque affirmation de ce document correspond à une mesure réellement en place. Les limites connues sont décrites telles quelles, à la dernière section.',
  ],
  sections: [
    {
      id: 'perimetre',
      h: '1. Périmètre',
      b: [
        'Ce document couvre l\'application Meet Aaron (https://meetaaron.app), son interface web, ses applications mobiles — qui ne sont que des coques affichant cette même application web — et l\'infrastructure qui la fait tourner.',
        'L\'éditeur est **Alexandre Fevre**, entreprise individuelle australienne (ABN 72 369 751 951), exerçant sous le nom commercial **Meet Aaron**.',
      ],
    },
    {
      id: 'donnees',
      h: '2. Données traitées',
      b: [
        '**Données de compte** : identité de l\'utilisateur, adresse email, préférences, données de facturation.',
        '**Jetons d\'accès à la messagerie** : les jetons OAuth Google et Microsoft, ou les identifiants IMAP/SMTP, permettant d\'envoyer et de lire les messages au nom de l\'utilisateur.',
        '**Données de prospection** : contacts professionnels saisis ou trouvés par l\'application, et les échanges de messages avec eux.',
        'Meet Aaron ne traite aucune donnée bancaire : les paiements passent par Stripe et aucun numéro de carte ne transite par nos serveurs ni n\'est stocké.',
      ],
    },
    {
      id: 'chiffrement',
      h: '3. Chiffrement',
      b: [
        '**En transit** : toutes les communications se font en HTTPS/TLS, sans exception. L\'application n\'est servie qu\'en HTTPS, les appels aux interfaces de Google, Microsoft, Anthropic, OpenAI et Stripe sont en HTTPS, et les connexions à la base de données passent par TLS.',
        '**Au repos** : la base de données et le stockage de fichiers sont chiffrés par l\'hébergeur sur l\'ensemble de leur contenu.',
        '**Chiffrement applicatif supplémentaire des jetons** : les jetons d\'accès aux messageries sont chiffrés AVANT d\'être écrits en base, en AES-256-GCM, avec un vecteur d\'initialisation aléatoire propre à chaque jeton et une étiquette d\'authentification vérifiée au déchiffrement. La clé de chiffrement vit dans les variables d\'environnement de la plateforme d\'hébergement — jamais en base de données, jamais dans le code source.',
        'Conséquence concrète et voulue : une copie de la base de données, à elle seule, ne donne accès à aucune boîte mail.',
      ],
    },
    {
      id: 'acces',
      h: '4. Authentification et contrôle d\'accès',
      b: [
        'L\'authentification des utilisateurs repose sur Supabase Auth. Chaque appel à l\'interface de programmation porte un jeton signé, vérifié côté serveur à chaque requête.',
        'Un identifiant d\'utilisateur transmis en paramètre n\'est jamais accepté sur parole : il est systématiquement comparé à l\'identité portée par le jeton, et toute divergence est refusée.',
        'Les jetons à usage unique servant à connecter une boîte mail depuis un téléphone sont de courte durée et consommés de façon atomique en base, ce qui les rend non rejouables.',
        'Les tâches planifiées (vingt-trois au total) exigent toutes un secret partagé transmis en en-tête et refusent toute requête qui ne le porte pas.',
      ],
    },
    {
      id: 'secrets',
      h: '5. Gestion des secrets',
      b: [
        'Tous les secrets — clés de base de données, clé de chiffrement des jetons, clés des fournisseurs d\'intelligence artificielle, clés de paiement, secret des tâches planifiées, identifiants OAuth — sont stockés comme variables d\'environnement de la plateforme d\'hébergement.',
        'Aucun secret ne figure dans le dépôt de code, y compris dans son historique. Ce point a fait l\'objet d\'une vérification dédiée.',
      ],
    },
    {
      id: 'sous-traitants',
      h: '6. Sous-traitants',
      b: [
        'L\'application s\'appuie sur un nombre volontairement restreint de prestataires, tous nommés publiquement dans notre [politique de confidentialité](/privacy) : l\'hébergeur de l\'application, l\'hébergeur de la base de données et des fichiers, le prestataire de paiement, les fournisseurs de modèles d\'intelligence artificielle, et un fournisseur de salles de visioconférence.',
        'Les fournisseurs de modèles d\'intelligence artificielle n\'utilisent pas ces données pour entraîner leurs modèles et ne les conservent que temporairement, à des fins de sécurité.',
      ],
    },
    {
      id: 'conservation',
      h: '7. Conservation et suppression',
      b: [
        'Les données sont conservées tant que le compte est actif.',
        'Tout utilisateur peut supprimer son compte lui-même, sans nous contacter, depuis l\'application. La demande ouvre un délai de vingt-quatre heures pendant lequel elle reste annulable, puis la suppression est exécutée automatiquement. Elle est définitive et effective sous trente jours.',
        'Les jetons d\'accès à une messagerie sont supprimés dès que l\'utilisateur déconnecte le compte concerné. Il peut également révoquer l\'accès directement depuis les paramètres de sécurité de son compte Google ou Microsoft, sans passer par nous.',
        'Seules les données de facturation sont conservées au-delà, pour la durée imposée par la loi.',
      ],
    },
    {
      id: 'journalisation',
      h: '8. Journalisation',
      b: [
        'Les journaux d\'exécution de l\'application et ceux de la base de données sont conservés par les hébergeurs respectifs. Les erreurs serveur sont journalisées.',
        'Aucun secret, aucun jeton et aucun mot de passe n\'est écrit dans les journaux.',
      ],
    },
    {
      id: 'developpement',
      h: '9. Développement et déploiement',
      b: [
        'Le code source est hébergé sur un dépôt privé. Les déploiements sont automatiques depuis la branche principale.',
        'Les dépendances sont suivies et mises à jour ; les alertes de sécurité du dépôt sont traitées.',
      ],
    },
    {
      id: 'limites',
      h: '10. Limites connues',
      b: [
        'Nous préférons décrire nos faiblesses plutôt que de les laisser découvrir.',
        '**Autorisation portée par le code applicatif.** La majorité des routes de l\'interface de programmation accèdent à la base avec un rôle de service, qui contourne les politiques de sécurité au niveau des lignes. L\'autorisation repose donc entièrement sur les vérifications effectuées dans le code, sans second filet au niveau de la base. Un audit complet des routes acceptant un identifiant d\'utilisateur a été mené et toutes contrôlent l\'identité de l\'appelant. L\'activation de politiques au niveau des lignes, comme deuxième barrière, est notre prochain chantier de sécurité.',
        '**Équipe d\'une seule personne.** Meet Aaron est développé et exploité par une personne. Il n\'y a ni séparation des rôles ni revue de code par un pair. La contrepartie est une surface d\'accès minimale : un seul détenteur des secrets, aucun sous-traitant interne, aucun accès partagé.',
        '**Pas de test d\'intrusion externe** à ce jour, en dehors de l\'évaluation de sécurité conduite dans le cadre du programme CASA.',
      ],
    },
    {
      id: 'contact',
      h: '11. Contact',
      b: [
        `Pour toute question de sécurité : [${MAIL}](mailto:${MAIL}).`,
        'Pour signaler une faille, merci de suivre notre [politique de divulgation des vulnérabilités](/vulnerability-disclosure).',
        'En cas d\'incident, notre [procédure de réponse à incident](/incident-response) décrit ce que nous faisons et dans quels délais.',
      ],
    },
  ],
  footer: 'Voir aussi notre [politique de confidentialité](/privacy) et nos [conditions d\'utilisation](/terms). En cas de divergence entre les versions, la version anglaise fait foi.',
};

const en = {
  title: 'Information Security Policy',
  updated: UPDATED_EN,
  intro: [
    'Meet Aaron accesses its users\' professional mailbox and calendar in order to draft, send and track their prospecting messages. That is a considerable level of access, and this document describes precisely how it is protected.',
    'Every statement in this document corresponds to a control that is actually in place. Known limitations are described as they are, in the final section.',
  ],
  sections: [
    {
      id: 'scope',
      h: '1. Scope',
      b: [
        'This document covers the Meet Aaron application (https://meetaaron.app), its web interface, its mobile applications — which are thin shells displaying that same web application — and the infrastructure running it.',
        'The publisher is **Alexandre Fevre**, an Australian sole trader (ABN 72 369 751 951), trading as **Meet Aaron**.',
      ],
    },
    {
      id: 'data',
      h: '2. Data processed',
      b: [
        '**Account data**: user identity, email address, preferences, billing data.',
        '**Mailbox access tokens**: Google and Microsoft OAuth tokens, or IMAP/SMTP credentials, allowing messages to be sent and read on the user\'s behalf.',
        '**Prospecting data**: business contacts entered or found by the application, and the message exchanges with them.',
        'Meet Aaron processes no payment card data: payments are handled by Stripe, and no card number passes through or is stored on our servers.',
      ],
    },
    {
      id: 'encryption',
      h: '3. Encryption',
      b: [
        '**In transit**: all communications use HTTPS/TLS, without exception. The application is served over HTTPS only; calls to the Google, Microsoft, Anthropic, OpenAI and Stripe APIs are over HTTPS; database connections use TLS.',
        '**At rest**: the database and file storage are encrypted at rest by the hosting provider across their entire contents.',
        '**Additional application-level token encryption**: mailbox access tokens are encrypted BEFORE being written to the database, using AES-256-GCM, with a random initialisation vector per token and an authentication tag verified on decryption. The encryption key lives in the hosting platform\'s environment variables — never in the database, never in the source code.',
        'The intended and concrete consequence: a copy of the database, on its own, grants access to no mailbox.',
      ],
    },
    {
      id: 'access',
      h: '4. Authentication and access control',
      b: [
        'User authentication relies on Supabase Auth. Every API call carries a signed token, verified server-side on each request.',
        'A user identifier passed as a parameter is never taken at face value: it is systematically compared against the identity carried by the token, and any mismatch is rejected.',
        'Single-use tokens used to connect a mailbox from a phone are short-lived and consumed atomically in the database, which makes them non-replayable.',
        'Scheduled tasks (twenty-three in total) all require a shared secret passed as a header and reject any request that does not carry it.',
      ],
    },
    {
      id: 'secrets',
      h: '5. Secrets management',
      b: [
        'All secrets — database keys, the token encryption key, AI provider keys, payment keys, the scheduled-task secret, OAuth credentials — are stored as environment variables on the hosting platform.',
        'No secret appears in the code repository, including its history. This was the subject of a dedicated review.',
      ],
    },
    {
      id: 'subprocessors',
      h: '6. Subprocessors',
      b: [
        'The application relies on a deliberately small number of providers, all named publicly in our [privacy policy](/privacy): the application host, the database and file storage host, the payment provider, the AI model providers, and a video-room provider.',
        'The AI model providers do not use this data to train their models and retain it only temporarily, for safety purposes.',
      ],
    },
    {
      id: 'retention',
      h: '7. Retention and deletion',
      b: [
        'Data is retained for as long as the account is active.',
        'Any user can delete their account themselves, without contacting us, from within the application. The request opens a twenty-four hour window during which it remains cancellable, after which deletion is executed automatically. It is permanent and effective within thirty days.',
        'Mailbox access tokens are deleted as soon as the user disconnects the mailbox concerned. Users may also revoke access directly from their Google or Microsoft account security settings, without going through us.',
        'Only billing data is retained beyond that, for the period required by law.',
      ],
    },
    {
      id: 'logging',
      h: '8. Logging',
      b: [
        'Application runtime logs and database logs are retained by the respective hosting providers. Server-side errors are logged.',
        'No secret, token or password is ever written to logs.',
      ],
    },
    {
      id: 'sdlc',
      h: '9. Development and deployment',
      b: [
        'Source code is hosted in a private repository. Deployments are automatic from the main branch.',
        'Dependencies are tracked and updated; repository security alerts are acted upon.',
      ],
    },
    {
      id: 'limitations',
      h: '10. Known limitations',
      b: [
        'We would rather describe our weaknesses than have them discovered.',
        '**Authorisation enforced in application code.** Most API routes access the database with a service role, which bypasses row-level security policies. Authorisation therefore rests entirely on checks performed in code, with no second net at the database layer. A full audit of every route accepting a user identifier was carried out, and all of them verify the caller\'s identity. Enabling row-level security as a second barrier is our next security project.',
        '**Single-person team.** Meet Aaron is built and operated by one person. There is no separation of duties and no peer code review. The counterpart is a minimal access surface: a single holder of secrets, no internal subcontractors, no shared access.',
        '**No external penetration test** to date, beyond the security assessment conducted under the CASA programme.',
      ],
    },
    {
      id: 'contact',
      h: '11. Contact',
      b: [
        `For any security question: [${MAIL}](mailto:${MAIL}).`,
        'To report a vulnerability, please follow our [vulnerability disclosure policy](/vulnerability-disclosure).',
        'In the event of an incident, our [incident response policy](/incident-response) describes what we do and within what timeframes.',
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

export default function SecurityPolicyPage() {
  const [locale] = useLocale();
  return <LegalPage documents={POLICIES} backLabel={BACK_LABEL} locale={locale} />;
}
