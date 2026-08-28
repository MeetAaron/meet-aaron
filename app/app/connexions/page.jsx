// app/app/connexions/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import { getStoredTheme, applyTheme } from '@/lib/theme';
import PushNotificationManager from '@/components/PushNotificationManager';

// Téléchargement d'un fichier généré côté serveur (export "Profil de
// l'entreprise" en Word/PDF, demande Alex 27/08/2026) — même utilitaire que
// downloadBlob dans app/app/team/page.jsx (dupliqué ici plutôt que
// mutualisé, convention déjà en place dans ce projet pour ces petits
// helpers sans logique métier propre à un module).
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      const body = await res.json();

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }

      setUserId(body.user.id);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, authLoading, authError };
}

function providerMetaFor(locale) {
  return {
    google: { name: 'Google', desc: t('connexions.googleDesc', locale) },
    microsoft: { name: 'Microsoft', desc: t('connexions.microsoftDesc', locale) },
  };
}

// CHANGEMENTS A FAIRE (2026-08-16) : CRM à connexion directe (OAuth) — HubSpot
// existait déjà, ajout de Salesforce et Pipedrive (même flux OAuth générique,
// voir handleConnectCrm/handleDisconnectCrm/handleSyncCrm ci-dessous). Divalto
// n'est pas dans cette liste : son architecture n'a pas de connexion OAuth
// centralisée (chaque client a son propre tenant), il aura une carte dédiée à
// part (formulaire 4 champs), pas encore construite à ce jour.
// Jobber ajouté suite 15 (3e CRM du chantier "pas à pas") : OAuth2 classique
// à redirection utilisateur comme les 3 premiers, malgré une API GraphQL
// côté serveur (voir lib/crm-sync.ts) — la connexion elle-même suit le même
// flux, seule la synchronisation change.
const DIRECT_CRM_PROVIDERS = ['hubspot', 'salesforce', 'pipedrive', 'jobber'];

// Suite 15 (chantier CRM plus large, demandé par Alex — "on va integrer en
// api tous les crm dont on a parlé") : Axonaut est le 1er CRM ajouté après
// HubSpot/Salesforce/Pipedrive. Contrairement à ceux-ci, Axonaut n'a pas de
// flux OAuth centralisé — authentification par clé API statique, une par
// compte Axonaut (icône clé à molette -> API dans l'interface Axonaut). Carte
// dédiée à part (ApiKeyCrmConnectionCard, formulaire 1 champ) plutôt que la
// redirection OAuth de CrmConnectionCard — voir app/api/crm-connections/axonaut.
// Housecall Pro (4e CRM, suite 15) réutilise le même patron — également une
// clé API statique générée par un administrateur (My Apps -> API Key
// Management), pas d'OAuth accessible pour ce type d'intégration. Capsule
// CRM (6e CRM) réutilise aussi ce patron — jeton d'accès personnel statique
// (My Preferences -> API Authentication Tokens) plutôt que le flux OAuth
// qu'expose aussi Capsule (réservé aux apps multi-comptes, hors périmètre
// ici). plancraft et ToolTime (5e/7e recherchés) n'ont pas d'API publique
// documentée (beta fermée chez les deux) — non construits, voir statut.
// ServiceM8 (7e CRM) réutilise aussi ce patron — clé API "Private App"
// statique (Settings -> API Keys), en-tête X-Api-Key.
const API_KEY_CRM_PROVIDERS = ['axonaut', 'housecallpro', 'capsulecrm', 'servicem8'];

// Suite 15 (2e CRM du chantier, après Axonaut) : Sellsy utilise OAuth2
// "client credentials" — ni redirection utilisateur (DIRECT_CRM_PROVIDERS),
// ni clé API unique (API_KEY_CRM_PROVIDERS), mais deux valeurs (client_id +
// client_secret) échangées contre un jeton côté serveur — voir
// app/api/crm-connections/sellsy et lib/crm-sync.ts. Carte dédiée à part
// (TwoFieldCrmConnectionCard, formulaire 2 champs).
const TWO_FIELD_CRM_PROVIDERS = ['sellsy'];

// Demande Alex (2026-08-22) : niveau de collaboration (0-3) + fournisseur/
// notes CRM déplacés depuis Préférences vers ici — mêmes listes, copiées
// telles quelles depuis app/app/preferences/page.jsx (collaborationLevelsFor /
// crmProvidersFor) pour un rendu identique.
function collaborationLevelsFor(locale) {
  return [
    { value: 0, label: t('preferences.crm.level0Label', locale), desc: t('preferences.crm.level0Desc', locale) },
    { value: 1, label: t('preferences.crm.level1Label', locale), desc: t('preferences.crm.level1Desc', locale) },
    { value: 2, label: t('preferences.crm.level2Label', locale), desc: t('preferences.crm.level2Desc', locale) },
    { value: 3, label: t('preferences.crm.level3Label', locale), desc: t('preferences.crm.level3Desc', locale) },
  ];
}

function crmProvidersFor(locale) {
  return [
    { value: '', label: t('preferences.crm.selectPlaceholder', locale) },
    { value: 'divalto', label: 'Divalto' },
    { value: 'salesforce', label: 'Salesforce' },
    { value: 'hubspot', label: 'HubSpot' },
    { value: 'pipedrive', label: 'Pipedrive' },
    { value: 'axonaut', label: 'Axonaut' },
    { value: 'sellsy', label: 'Sellsy' },
    { value: 'jobber', label: 'Jobber' },
    { value: 'housecallpro', label: 'Housecall Pro' },
    { value: 'capsulecrm', label: 'Capsule CRM' },
    { value: 'servicem8', label: 'ServiceM8' },
    { value: 'autre', label: t('preferences.crm.otherProvider', locale) },
  ];
}

function crmMetaFor(locale) {
  return {
    hubspot: { name: 'HubSpot', desc: t('connexions.hubspotDesc', locale) },
    salesforce: { name: 'Salesforce', desc: t('connexions.salesforceDesc', locale) },
    pipedrive: { name: 'Pipedrive', desc: t('connexions.pipedriveDesc', locale) },
    axonaut: { name: 'Axonaut', desc: t('connexions.axonautDesc', locale) },
    sellsy: { name: 'Sellsy', desc: t('connexions.sellsyDesc', locale) },
    jobber: { name: 'Jobber', desc: t('connexions.jobberDesc', locale) },
    housecallpro: { name: 'Housecall Pro', desc: t('connexions.housecallproDesc', locale) },
    capsulecrm: { name: 'Capsule CRM', desc: t('connexions.capsulecrmDesc', locale) },
    servicem8: { name: 'ServiceM8', desc: t('connexions.servicem8Desc', locale) },
  };
}

// Portés depuis app/app/preferences/page.jsx (fusion "Mon compte" du
// 2026-08-25, demande Alex : "on va fusionner préférences et abonnements
// dans compte, ça me paraît bien plus logique") — mêmes fonctions, copiées
// telles quelles pour un rendu identique aux onglets Préférences/Abonnement.
function channelOptionsFor(locale) {
  return [
    { value: 'email', label: t('preferences.channel.email', locale) },
    { value: 'push', label: t('preferences.channel.push', locale) },
    { value: 'both', label: t('preferences.channel.both', locale) },
  ];
}

const DELAY_OPTIONS = [15, 30, 60];

function firstEmailOptionsFor(locale) {
  return [
    { value: false, label: t('preferences.firstEmail.auto', locale) },
    { value: true, label: t('preferences.firstEmail.manual', locale) },
  ];
}

// Objectif de prospection + email de premier contact par défaut (demande
// Alex, 2026-08-26) — voir migration_prospecting_goal_default_email_2026-08-26.sql
// et la section OBJECTIF DE LA PROSPECTION de lib/aaron_system_prompt.md.
function prospectingGoalOptionsFor(locale) {
  return [
    { value: 'rdv', label: t('preferences.prospectingGoal.rdv', locale) },
    { value: 'devis', label: t('preferences.prospectingGoal.devis', locale) },
    { value: 'essai_gratuit', label: t('preferences.prospectingGoal.essaiGratuit', locale) },
    { value: 'autre', label: t('preferences.prospectingGoal.autre', locale) },
  ];
}

function defaultFirstEmailOptionsFor(locale) {
  return [
    { value: false, label: t('preferences.defaultFirstEmail.auto', locale) },
    { value: true, label: t('preferences.defaultFirstEmail.manual', locale) },
  ];
}

function offersFor(locale) {
  return [
    { value: 'AP', label: t('preferences.offers.apLabel', locale), desc: t('preferences.offers.apDesc', locale), available: true },
    { value: 'AS', label: t('nav.opportunity', locale), desc: t('preferences.offers.asDesc', locale), available: true },
    { value: 'AC', label: t('nav.client', locale), desc: t('preferences.offers.acDesc', locale), available: true },
  ];
}

export default function ConnexionsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const PROVIDER_META = providerMetaFor(locale);
  const CRM_META = crmMetaFor(locale);
  const COLLABORATION_LEVELS = collaborationLevelsFor(locale);
  const CRM_PROVIDERS_SELECT = crmProvidersFor(locale);
  const [connections, setConnections] = useState([]);
  const [emailHealth, setEmailHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  // CHANGEMENTS A FAIRE #90 (2026-08-16) : nouvelle catégorie "CRMs et bases de
  // données" — la connexion HubSpot (connecter/déconnecter/synchroniser),
  // auparavant dans Préférences, vit maintenant ici avec les autres connexions
  // de comptes tiers. Le choix du fournisseur CRM et le niveau de collaboration
  // restent dans Préférences (voir item #30).
  //
  // docx item 27 (2026-08-20) : cette page n'affichait qu'UN SEUL CRM (celui
  // choisi via un menu déroulant dans Préférences) — désormais tous les CRM
  // pris en charge sont affichés en une seule grille pour que l'utilisateur
  // choisisse directement ici. crmSyncing/crmSyncResult/crmError sont donc
  // passés d'une valeur unique (un seul provider visible à la fois) à des
  // objets indexés par provider, pour que l'état d'une carte n'affecte pas les
  // autres cartes affichées en même temps.
  const [userRole, setUserRole] = useState(null);
  const [crmConnections, setCrmConnections] = useState([]);
  const [crmSyncing, setCrmSyncing] = useState({});
  const [crmSyncResult, setCrmSyncResult] = useState({});
  const [crmError, setCrmError] = useState({});
  const [crmOauthBannerError, setCrmOauthBannerError] = useState(null);
  // docx item 9 (2026-08-27) : après connexion Google/Microsoft réussie
  // (souvent juste après la visite guidée, voir app/app/tour/page.jsx), on
  // affiche une petite bannière + un CTA vers "ajouter mon premier prospect"
  // plutôt que de laisser l'utilisateur seul sur cette page sans indication
  // de la suite — "conseils pas à pas" demandés par Alex pour tout
  // l'enchaînement post-onboarding.
  const [oauthJustConnected, setOauthJustConnected] = useState(null);

  // Suite 15 — état propre au formulaire de connexion par clé API (Axonaut et
  // les autres CRM sans OAuth centralisé traités selon le même patron),
  // maintenant indexé par provider (docx item 27 : plusieurs cartes clé API
  // peuvent être affichées en même temps, chacune a son propre champ).
  const [apiKeyInputs, setApiKeyInputs] = useState({});
  const [apiKeyConnecting, setApiKeyConnecting] = useState({});

  // Suite 15 — Sellsy (client_id + client_secret, voir TWO_FIELD_CRM_PROVIDERS
  // plus haut), même généralisation par provider.
  const [twoFieldInputs, setTwoFieldInputs] = useState({});
  const [twoFieldConnecting, setTwoFieldConnecting] = useState({});

  // docx C1/A2/A3 (2026-08-20) : cette page devient "Mon compte", structurée
  // en 3 rubriques — mon profil / connexion / crm — au lieu d'un seul flux.
  const [activeTab, setActiveTab] = useState('profile');
  // Fusion "Mon compte" (2026-08-25) : les anciens liens "module verrouillé"
  // (voir Shell plus bas, dupliqué dans les 14 pages) et les retours Stripe
  // pointent vers ?tab=subscription (ex-page /app/preferences) — ouvre
  // directement le bon onglet plutôt que de forcer un clic supplémentaire.
  // Les valeurs reconnues correspondent 1:1 aux 7 clés d'activeTab.
  useEffect(() => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    const VALID_TABS = ['profile', 'company', 'connection', 'crm', 'preferences', 'subscription', 'delete'];
    if (tabParam && VALID_TABS.includes(tabParam)) setActiveTab(tabParam);
  }, []);
  const [profileName, setProfileName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);
  // Mode clair optionnel (tâche #129, piste 2) — préférence 100% locale au
  // navigateur (voir lib/theme.js), pas de champ base de données.
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);
  function changeTheme(next) {
    setTheme(next);
    applyTheme(next);
  }

  // docx item 27 / tâche #139 : "ajouter un autre CRM" pour les CRM hors de
  // la liste (Divalto excepté, qui a son propre chantier — voir tâche #112).
  // Remplacé par une vraie conversation guidée avec Aaron (voir
  // CrmCustomChatModal plus bas) au lieu d'un simple champ de texte libre.
  // Le récapitulatif produit par Aaron part vers la boîte à suggestions
  // existante (/api/feedback, déjà lue par le patron).
  const [crmChatOpen, setCrmChatOpen] = useState(false);
  const [addCrmSent, setAddCrmSent] = useState(false);

  // Demandes Alex (2026-08-22) : recherche + repli "voir plus"/"voir moins"
  // sur la grille CRM (9 cartes aujourd'hui, seulement 6 affichées par
  // défaut), et niveau de collaboration + fournisseur CRM/notes déplacés ici
  // depuis Préférences (juste au-dessus de la grille), pour rester à côté
  // des cartes de connexion elles-mêmes plutôt que sur une autre page.
  const [crmSearch, setCrmSearch] = useState('');
  const [crmShowAll, setCrmShowAll] = useState(false);
  const [collabPrefs, setCollabPrefs] = useState(null); // { collaboration_level, crm_provider, crm_connection_notes }
  const [collabSaving, setCollabSaving] = useState(false);
  const [collabSaved, setCollabSaved] = useState(false);
  const [collabUploadFile, setCollabUploadFile] = useState(null);
  const [collabUploading, setCollabUploading] = useState(false);
  const [collabUploadDone, setCollabUploadDone] = useState(false);

  // --- Portés depuis app/app/preferences/page.jsx (fusion "Mon compte",
  // 2026-08-25) : onglets Mon entreprise / Préférences / Abonnement. Préfixés
  // `prefs*`/`loadError` etc. déjà distincts des noms ci-dessus sauf `loading`
  // (renommé `prefsLoading` ici, `loading` plus haut reste réservé au
  // chargement des connexions comme avant).
  const CHANNEL_OPTIONS = channelOptionsFor(locale);
  const FIRST_EMAIL_OPTIONS = firstEmailOptionsFor(locale);
  const PROSPECTING_GOAL_OPTIONS = prospectingGoalOptionsFor(locale);
  const DEFAULT_FIRST_EMAIL_OPTIONS = defaultFirstEmailOptionsFor(locale);
  const OFFERS = offersFor(locale);
  const [prefs, setPrefs] = useState(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [offerError, setOfferError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [businessSummary, setBusinessSummary] = useState('');
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [summaryDirty, setSummaryDirty] = useState(false);
  // Demande Alex (27/08/2026) : le résumé d'activité (business_summary) peut
  // faire plusieurs paragraphes (généré par le questionnaire de découverte) —
  // dans un <textarea rows={6}> il paraissait "coupé" en plein milieu d'une
  // phrase alors que le texte complet est bien là (juste besoin de scroller
  // DANS le textarea, peu visible). On agrandit la zone visible ET on ajoute
  // un agrandissement en plein écran pour relire/éditer le texte en entier
  // confortablement.
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // Export Word/PDF + import d'une version modifiée (demande Alex,
  // 27/08/2026) : "Profil de l'entreprise" plutôt que "résumé" côté libellés
  // (même champ business_summary, juste renommé côté UI). exportingFormat
  // désactive le bouton en cours de téléchargement ('word' | 'pdf' | null).
  // pendingImport reflète business_summary_pending_* côté API — non-null
  // tant qu'un document importé n'a pas été traité (bannière de revue avec
  // "Ne pas analyser" / "Faire analyser par Aaron").
  const [exportingFormat, setExportingFormat] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [pendingImport, setPendingImport] = useState(null); // { fileName, uploadedAt } | null
  const [importUploading, setImportUploading] = useState(false);
  const [importError, setImportError] = useState(null);
  const [discardingImport, setDiscardingImport] = useState(false);
  const [analyzingImport, setAnalyzingImport] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [analyzeChangeNote, setAnalyzeChangeNote] = useState(null);
  const importFileInputRef = useRef(null);
  const [signature, setSignature] = useState('');
  const [signatureLoaded, setSignatureLoaded] = useState(false);
  const [detectingSignature, setDetectingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState(null);
  const [savingSignature, setSavingSignature] = useState(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  // Signature avec image ("carte de visite", demande Alex 2026-08-25) — voir
  // app/api/signature/image/route.ts et lib/messaging.ts (bascule HTML à
  // l'envoi quand cette image est présente).
  const [signatureImageUrl, setSignatureImageUrl] = useState(null);
  const [signatureImageFile, setSignatureImageFile] = useState(null);
  const [signatureImageUploading, setSignatureImageUploading] = useState(false);
  const [signatureImageError, setSignatureImageError] = useState(null);
  const [legalInfo, setLegalInfo] = useState({ siret: '', legal_address: '', legal_form: '', vat_number: '', vat_exempt_mention: '' });
  const [legalInfoLoaded, setLegalInfoLoaded] = useState(false);
  const [savingLegalInfo, setSavingLegalInfo] = useState(false);
  const [legalInfoSaved, setLegalInfoSaved] = useState(false);
  // docx (2026-08-27, retour Alex) : le "Lien public" vivait dans Préférences
  // alors qu'il s'agit d'une info d'entreprise — déplacé dans l'onglet "Mon
  // entreprise", avec sa propre sauvegarde dédiée (même patron que
  // handleSaveLegalInfo ci-dessus) plutôt que de dépendre du gros bouton
  // "Enregistrer" de Préférences qui soumettait aussi des réglages sans
  // rapport. Le jeton {lien} dans l'éditeur d'email par défaut (Préférences)
  // continue de lire prefs.public_link_url normalement, sans changement.
  const [savingPublicLink, setSavingPublicLink] = useState(false);
  const [publicLinkSaved, setPublicLinkSaved] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState(null);
  const [buyingCredits, setBuyingCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [openingBillingPortal, setOpeningBillingPortal] = useState(false);
  const [billingPortalError, setBillingPortalError] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState(null);
  const [customCreditsByModule, setCustomCreditsByModule] = useState({ ap: '', as: '', ac: '' });
  const [customCredits, setCustomCredits] = useState('');
  const [moduleBusy, setModuleBusy] = useState(null);
  const [moduleError, setModuleError] = useState(null);
  // Redesign onglet Abonnement (demande Alex 2026-08-25) : date de
  // renouvellement lue en direct depuis Stripe (usage.renewal_date, voir
  // app/api/api-usage), et un seul bloc "Crédits" avec 3 onglets
  // Prospect/Opportunités/Clients au lieu de 4 blocs empilés.
  const [creditsModuleTab, setCreditsModuleTab] = useState('ap');
  const [invoicesShowAll, setInvoicesShowAll] = useState(false);

  // Vraie page profil (demande Alex 2026-08-25) : email + mot de passe,
  // modifiables avec vérification. L'email courant vient de la session
  // Supabase Auth (source de vérité), pas de la table "users" — les deux
  // sont synchronisés automatiquement après confirmation (voir
  // app/api/auth/link/route.ts).
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailChangeSaving, setEmailChangeSaving] = useState(false);
  const [emailChangeSent, setEmailChangeSent] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeSaving, setPasswordChangeSaving] = useState(false);
  const [passwordChangeSaved, setPasswordChangeSaved] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState(null);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => {
      if (data?.session?.user?.email) setCurrentEmail(data.session.user.email);
    });
  }, []);

  // {prenom}/{societe} dans l'email par défaut (demande Alex, 2026-08-26,
  // suite à sa question "comment l'utilisateur peut-il savoir que ces tokens
  // existent ?") : le seul endroit où ils étaient mentionnés jusqu'ici était
  // le placeholder des champs — invisible dès que l'utilisateur tape du
  // texte. Ces boutons rendent les tokens visibles en permanence ET
  // évitent d'avoir à retenir/taper la syntaxe : un clic insère le token à
  // l'endroit exact du curseur dans le champ correspondant.
  const defaultEmailSubjectRef = useRef(null);
  const defaultEmailBodyRef = useRef(null);

  function insertDefaultEmailToken(fieldRef, fieldName, token) {
    const el = fieldRef.current;
    const current = prefs[fieldName] || '';
    if (!el) {
      setPrefs({ ...prefs, [fieldName]: current + token });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setPrefs({ ...prefs, [fieldName]: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // Webhook générique de conversion prospect -> client (demande Alex,
  // 2026-08-26) — voir preferences.externalConversionWebhookLabel plus bas.
  function copyWebhookUrl() {
    if (!prefs?.external_conversion_webhook_secret) return;
    const url = `${window.location.origin}/api/webhooks/external-conversion/${prefs.external_conversion_webhook_secret}`;
    navigator.clipboard.writeText(url).then(() => {
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    });
  }

  function loadPrefs() {
    if (!userId) return;
    setLoadError(null);
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok || !body.preferences) {
          setPrefsLoading(false);
          setLoadError(body?.error || t('preferences.loadError', locale));
          return;
        }
        setPrefs(body.preferences);
        setPrefsLoading(false);
      })
      .catch(() => {
        setPrefsLoading(false);
        setLoadError(t('preferences.loadError', locale));
      });
  }

  function loadBusinessSummary() {
    if (!userId) return;
    fetch(`/api/business-summary?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setBusinessSummary(res.summary || '');
        setPendingImport(res.pending || null);
        setSummaryLoaded(true);
        setSummaryDirty(false);
      })
      .catch(() => setSummaryLoaded(true));
  }

  useEffect(() => {
    if (!userId) return;
    loadPrefs();
    fetch(`/api/api-usage?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => setUsage(res))
      .catch(() => {});
    fetch('/api/billing/invoices')
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) return;
        setInvoices(body.invoices || []);
      })
      .catch(() => setInvoicesError(t('preferences.invoices.error', locale)));
    loadBusinessSummary();
    fetch(`/api/signature?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setSignature(res.signature || '');
        setSignatureImageUrl(res.signature_image_url || null);
        setSignatureLoaded(true);
      })
      .catch(() => setSignatureLoaded(true));
    fetch(`/api/company-legal-info?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.legal_info) setLegalInfo(res.legal_info);
        setLegalInfoLoaded(true);
      })
      .catch(() => setLegalInfoLoaded(true));
  }, [userId]);

  // Voir le commentaire sur summaryDirty plus haut (préférences d'origine) :
  // quand l'onglet redevient visible, on relit le résumé métier au cas où il
  // aurait été régénéré ailleurs — sans écraser une saisie manuelle en cours.
  useEffect(() => {
    if (!userId) return;
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !summaryDirty) {
        loadBusinessSummary();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [userId, summaryDirty]);

  async function handleSaveLegalInfo() {
    setSavingLegalInfo(true);
    setLegalInfoSaved(false);
    const res = await fetch('/api/company-legal-info', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...legalInfo }),
    });
    setSavingLegalInfo(false);
    if (res.ok) {
      setLegalInfoSaved(true);
      setTimeout(() => setLegalInfoSaved(false), 2500);
    }
  }

  async function handleSavePublicLink() {
    setSavingPublicLink(true);
    setPublicLinkSaved(false);
    setPublicLinkError(null);
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, public_link_url: prefs.public_link_url }),
    });
    setSavingPublicLink(false);
    if (!res.ok) {
      const body = await res.json();
      // Corrigé au passage (27/08) : cette erreur utilisait par erreur
      // setOfferError, un état affiché uniquement sur l'onglet Abonnement —
      // un échec ici restait donc invisible sur "Mon entreprise".
      setPublicLinkError(body.error);
      return;
    }
    setPublicLinkSaved(true);
    setTimeout(() => setPublicLinkSaved(false), 2500);
  }

  async function handleDetectSignature() {
    setDetectingSignature(true);
    setSignatureError(null);
    const res = await fetch('/api/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await res.json();
    setDetectingSignature(false);
    if (!res.ok || !body.signature) {
      setSignatureError(body.error || t('preferences.signatureNotDetected', locale));
      return;
    }
    setSignature(body.signature);
  }

  async function handleSaveSignature() {
    setSavingSignature(true);
    setSignatureSaved(false);
    const res = await fetch('/api/signature', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, signature }),
    });
    setSavingSignature(false);
    if (res.ok) {
      setSignatureSaved(true);
      setTimeout(() => setSignatureSaved(false), 2500);
    }
  }

  async function handleUploadSignatureImage() {
    if (!signatureImageFile) return;
    setSignatureImageUploading(true);
    setSignatureImageError(null);
    const formData = new FormData();
    formData.append('file', signatureImageFile);
    formData.append('user_id', userId);
    const res = await fetch('/api/signature/image', { method: 'POST', body: formData });
    const body = await res.json();
    setSignatureImageUploading(false);
    if (!res.ok) {
      setSignatureImageError(body.error || t('common.error', locale));
      return;
    }
    setSignatureImageUrl(body.url);
    setSignatureImageFile(null);
  }

  async function handleRemoveSignatureImage() {
    setSignatureImageUploading(true);
    setSignatureImageError(null);
    const res = await fetch(`/api/signature/image?user_id=${userId}`, { method: 'DELETE' });
    setSignatureImageUploading(false);
    if (res.ok) setSignatureImageUrl(null);
  }

  async function handleSaveSummary() {
    setSavingSummary(true);
    setSummarySaved(false);
    const res = await fetch('/api/business-summary', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, summary: businessSummary }),
    });
    setSavingSummary(false);
    if (res.ok) {
      setSummarySaved(true);
      setSummaryDirty(false);
      setTimeout(() => setSummarySaved(false), 2500);
    }
  }

  // Export Word/PDF "à tout moment" (demande Alex, 27/08/2026) — voir
  // app/api/business-summary/export/route.ts. Le format déterminera
  // l'extension (.rtf pour Word, .pdf) et le Content-Type renvoyés par
  // l'API ; ici on lit juste le blob et on déclenche le téléchargement.
  async function handleExportSummary(format) {
    setExportingFormat(format);
    setExportError(null);
    try {
      const res = await fetch(`/api/business-summary/export?user_id=${userId}&format=${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setExportError(err.error || t('preferences.businessProfileExportError', locale));
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `profil-entreprise.${format === 'word' ? 'rtf' : 'pdf'}`;
      downloadBlob(blob, filename);
    } catch {
      setExportError(t('preferences.businessProfileExportError', locale));
    } finally {
      setExportingFormat(null);
    }
  }

  // Import d'une version modifiée (demande Alex, 27/08/2026) : stocke le
  // texte extrait "en attente" côté serveur — RIEN ne change sur le profil
  // actif tant que l'utilisateur n'a pas choisi "Ne pas analyser" ou "Faire
  // analyser par Aaron" ci-dessous. Voir app/api/business-summary/import/.
  async function handleImportFileChange(e) {
    const file = e.target.files?.[0];
    if (importFileInputRef.current) importFileInputRef.current.value = '';
    if (!file) return;

    setImportUploading(true);
    setImportError(null);
    setAnalyzeChangeNote(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', userId);
      const res = await fetch('/api/business-summary/import', { method: 'POST', body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(body.error || t('preferences.businessProfileImportError', locale));
        return;
      }
      setPendingImport({ fileName: body.fileName, uploadedAt: new Date().toISOString() });
    } catch {
      setImportError(t('preferences.businessProfileImportError', locale));
    } finally {
      setImportUploading(false);
    }
  }

  // Bouton "Ne pas analyser" : efface le document en attente sans toucher au
  // profil actif.
  async function handleDiscardPendingImport() {
    setDiscardingImport(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/business-summary/import/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (res.ok) {
        setPendingImport(null);
        setAnalyzeChangeNote(null);
      }
    } finally {
      setDiscardingImport(false);
    }
  }

  // Bouton "Faire analyser par Aaron" : Aaron retravaille le profil à partir
  // du document importé et remarque ce qui a changé (changeNote) — voir
  // app/api/business-summary/import/analyze/route.ts.
  async function handleAnalyzePendingImport() {
    setAnalyzingImport(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/business-summary/import/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnalyzeError(body.error || t('preferences.businessProfileAnalyzeError', locale));
        return;
      }
      setBusinessSummary(body.summary || '');
      setAnalyzeChangeNote(body.changeNote || null);
      setPendingImport(null);
    } catch {
      setAnalyzeError(t('preferences.businessProfileAnalyzeError', locale));
    } finally {
      setAnalyzingImport(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setOfferError(null);
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        notify_channel: prefs.notify_channel,
        notify_before_appointment_minutes: prefs.notify_before_appointment_minutes,
        require_first_email_approval: prefs.require_first_email_approval,
        daily_prospecting_email_cap: prefs.daily_prospecting_email_cap,
        prospecting_goal: prefs.prospecting_goal,
        prospecting_goal_details: prefs.prospecting_goal_details,
        default_first_email_enabled: prefs.default_first_email_enabled,
        default_first_email_subject: prefs.default_first_email_subject,
        default_first_email_body: prefs.default_first_email_body,
        public_link_url: prefs.public_link_url,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json();
      setOfferError(body.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleToggleModule(moduleValue, isActive) {
    if (isActive) {
      const activeCount = ['AP', 'AS', 'AC'].filter((m) => prefs[`offer_${m.toLowerCase()}_active`]).length;
      const warningKey = activeCount <= 1
        ? 'preferences.subscription.confirmDeactivateLastTemplate'
        : 'preferences.subscription.confirmDeactivateTemplate';
      const moduleLabel = OFFERS.find((o) => o.value === moduleValue)?.label || moduleValue;
      if (!confirm(t(warningKey, locale).replace('{module}', moduleLabel))) return;
    }

    setModuleBusy(moduleValue);
    setModuleError(null);
    try {
      const res = await fetch('/api/subscription/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleValue, action: isActive ? 'deactivate' : 'activate' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setModuleError(body.error || t('common.error', locale));
        return;
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return;
      }
      loadPrefs();
    } catch (err) {
      setModuleError(t('common.error', locale));
    } finally {
      setModuleBusy(null);
    }
  }

  async function handleBuyCredits(credits, module) {
    const buyingKey = `${module || 'general'}:${credits}`;
    setBuyingCredits(buyingKey);
    setCreditsError(null);
    try {
      const res = await fetch('/api/checkout/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(module ? { credits, module } : { credits }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setCreditsError(body.error || t('common.error', locale));
        setBuyingCredits(null);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setCreditsError(t('common.error', locale));
      setBuyingCredits(null);
    }
  }

  function handleBuyCustomCredits() {
    const credits = Number(customCredits);
    if (!Number.isFinite(credits) || credits < 1 || credits > 5000 || !Number.isInteger(credits)) {
      setCreditsError(t('preferences.credits.invalidCustom', locale));
      return;
    }
    handleBuyCredits(credits);
  }

  function handleBuyCustomCreditsForModule(module) {
    const credits = Number(customCreditsByModule[module]);
    if (!Number.isFinite(credits) || credits < 1 || credits > 5000 || !Number.isInteger(credits)) {
      setCreditsError(t('preferences.credits.invalidCustom', locale));
      return;
    }
    handleBuyCredits(credits, module);
  }

  async function handleOpenBillingPortal() {
    setOpeningBillingPortal(true);
    setBillingPortalError(null);
    try {
      const res = await fetch('/api/billing-portal', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setBillingPortalError(body.error || t('common.error', locale));
        setOpeningBillingPortal(false);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setBillingPortalError(t('common.error', locale));
      setOpeningBillingPortal(false);
    }
  }

  // Changement d'email (demande Alex 2026-08-25) : Supabase Auth envoie un
  // lien de confirmation à la NOUVELLE adresse — rien ne change réellement
  // tant qu'il n'est pas cliqué (c'est la "vérification"). users.email se
  // resynchronise automatiquement à la prochaine visite d'une page une fois
  // confirmé (voir app/api/auth/link/route.ts).
  async function handleChangeEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed || trimmed === currentEmail) return;
    setEmailChangeSaving(true);
    setEmailChangeError(null);
    setEmailChangeSent(false);
    const { error } = await supabaseBrowser.auth.updateUser({ email: trimmed });
    setEmailChangeSaving(false);
    if (error) {
      setEmailChangeError(error.message || t('common.error', locale));
      return;
    }
    setEmailChangeSent(true);
    setNewEmail('');
  }

  // Changement de mot de passe (demande Alex 2026-08-25) : "vérification quand
  // même" -> on exige le mot de passe actuel et on le vérifie par une vraie
  // tentative de connexion avant d'autoriser le changement, plutôt que de
  // faire confiance à une session déjà ouverte (qui peut être restée ouverte
  // sur un appareil partagé).
  async function handleChangePassword() {
    setPasswordChangeError(null);
    setPasswordChangeSaved(false);
    if (!currentPassword || !newPassword) {
      setPasswordChangeError(t('connexions.passwordAllFieldsRequired', locale));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordChangeError(t('connexions.passwordTooShort', locale));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError(t('connexions.passwordMismatch', locale));
      return;
    }
    setPasswordChangeSaving(true);
    const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (signInError) {
      setPasswordChangeSaving(false);
      setPasswordChangeError(t('connexions.passwordCurrentIncorrect', locale));
      return;
    }
    const { error: updateError } = await supabaseBrowser.auth.updateUser({ password: newPassword });
    setPasswordChangeSaving(false);
    if (updateError) {
      setPasswordChangeError(updateError.message || t('common.error', locale));
      return;
    }
    setPasswordChangeSaved(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setTimeout(() => setPasswordChangeSaved(false), 3000);
  }

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/oauth-connections?user_id=${userId}`).then((r) => r.json());
    setConnections(res.connections || []);
    setLoading(false);

    // Diagnostic délivrabilité (SPF/DMARC) chargé séparément et sans bloquer
    // l'affichage des connexions : c'est une information secondaire, et une
    // requête DNS lente ne doit jamais retarder l'écran principal.
    fetch(`/api/email-health?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => setEmailHealth(body.results || []))
      .catch(() => {});
  }

  function loadCrmConnections() {
    fetch('/api/crm-connections')
      .then((r) => r.json())
      .then((res) => setCrmConnections(res.connections || []))
      .catch(() => {});
  }

  // Demande Alex (2026-08-22) : niveau de collaboration + fournisseur/notes
  // CRM, déplacés depuis Préférences vers ici (juste au-dessus de la grille
  // CRM). Même route PATCH /api/preferences que Préférences utilisait déjà
  // pour ces 3 champs (voir app/api/preferences/route.ts) — comportement de
  // sauvegarde identique, seul l'emplacement change.
  async function handleSaveCollab() {
    if (!collabPrefs) return;
    setCollabSaving(true);
    setCollabSaved(false);
    try {
      const res = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          collaboration_level: collabPrefs.collaboration_level,
          crm_provider: collabPrefs.crm_provider,
          crm_connection_notes: collabPrefs.crm_connection_notes,
        }),
      });
      if (res.ok) {
        setCollabSaved(true);
        setTimeout(() => setCollabSaved(false), 2500);
      }
    } finally {
      setCollabSaving(false);
    }
  }

  async function handleCollabUpload() {
    if (!collabUploadFile) return;
    setCollabUploading(true);
    const formData = new FormData();
    formData.append('file', collabUploadFile);
    formData.append('user_id', userId);
    formData.append('description', 'Historique clients gagnés/perdus (niveau 1 CRM)');
    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    setCollabUploading(false);
    if (res.ok) {
      setCollabUploadDone(true);
      setCollabUploadFile(null);
    }
  }

  useEffect(() => {
    if (!userId) return;
    load();
    loadCrmConnections();
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setUserRole(res.preferences?.role || null);
        setCollabPrefs({
          collaboration_level: res.preferences?.collaboration_level ?? 0,
          crm_provider: res.preferences?.crm_provider || null,
          crm_connection_notes: res.preferences?.crm_connection_notes || '',
        });
      })
      .catch(() => {});
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => setProfileName(res.user?.full_name || ''))
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const crmOauthError = params.get('crm_oauth_error');
    if (crmOauthError) setCrmOauthBannerError(t('preferences.crm.oauthErrorTemplate', locale).replace('{error}', crmOauthError));
    const oauthSuccessProvider = params.get('oauth_success');
    if (oauthSuccessProvider === 'google' || oauthSuccessProvider === 'microsoft') {
      setOauthJustConnected(oauthSuccessProvider);
    }
    if (params.get('oauth_success') || params.get('oauth_error') || crmOauthError || params.get('crm_oauth_success')) {
      window.history.replaceState({}, '', window.location.pathname + '?user_id=' + userId);
    }
  }, [userId]);

  async function handleDisconnect(connectionId) {
    if (!confirm(t('connexions.disconnectConfirm', locale))) return;
    await fetch(`/api/oauth-connections?connection_id=${connectionId}&user_id=${userId}`, { method: 'DELETE' });
    load();
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: profileName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setProfileError(body.error || t('common.error', locale));
        return;
      }
      setProfileSaved(true);
    } catch (err) {
      setProfileError(t('common.error', locale));
    } finally {
      setProfileSaving(false);
    }
  }

  // docx item 27 / tâche #139 — CRM hors de la liste des 9 intégrations
  // existantes : pas de flux de connexion automatisé possible (format
  // inconnu), donc pas de vraie intégration construite ici. Le récapitulatif
  // structuré produit par la conversation avec Aaron (CrmCustomChatModal) est
  // transmis au patron via la boîte à suggestions existante plutôt que de
  // deviner une intégration.
  async function handleSendCrmChatRequest(recap) {
    const lines = [
      "[Demande de CRM sur-mesure — via Aaron, Mon compte]",
      `CRM : ${recap.crm_name || '—'}`,
      `Données à synchroniser : ${Array.isArray(recap.data_to_sync) && recap.data_to_sync.length ? recap.data_to_sync.join(', ') : '—'}`,
      `Accès disponible : ${recap.auth_method || '—'}`,
    ];
    if (recap.notes) lines.push(`Notes : ${recap.notes}`);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, message: lines.join('\n') }),
      });
    } catch (err) {
      // silencieux : ce n'est qu'une transmission de demande, pas une action critique
    } finally {
      setCrmChatOpen(false);
      setAddCrmSent(true);
    }
  }

  // Même schéma que connectProvider ci-dessous (navigation complète, pas
  // fetch) — /api/auth/<provider> déclenche une redirection OAuth externe.
  // CHANGEMENTS A FAIRE (2026-08-16) : généralisé de handleConnectHubspot à
  // handleConnectCrm(provider) pour supporter aussi Salesforce et Pipedrive
  // (même flux OAuth, seule l'URL de démarrage change).
  async function handleConnectCrm(provider) {
    setCrmError((prev) => ({ ...prev, [provider]: null }));
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `/api/auth/${provider}?token=${encodeURIComponent(session.access_token)}`;
  }

  async function handleDisconnectCrm(provider) {
    if (!confirm(t('preferences.crm.disconnectConfirmTemplate', locale).replace('{provider}', CRM_META[provider]?.name || provider))) return;
    await fetch(`/api/crm-connections?provider=${provider}`, { method: 'DELETE' });
    loadCrmConnections();
  }

  // Suite 15 — CRM sans flux OAuth (voir API_KEY_CRM_PROVIDERS plus haut) :
  // contrairement à handleConnectCrm ci-dessus (redirection externe), ici on
  // POST directement la clé collée par le patron. AuthFetchInterceptor
  // (components/AuthFetchInterceptor.jsx, monté globalement dans app/layout.jsx)
  // ajoute automatiquement le token d'auth à ce fetch(), comme pour tous les
  // autres appels /api/* de cette page. docx item 27 : généralisé à un état
  // indexé par provider (plusieurs cartes clé API affichées en même temps).
  async function handleConnectApiKeyCrm(provider) {
    const apiKey = (apiKeyInputs[provider] || '').trim();
    if (!apiKey) return;
    setApiKeyConnecting((prev) => ({ ...prev, [provider]: true }));
    setCrmError((prev) => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch(`/api/crm-connections/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError((prev) => ({ ...prev, [provider]: body.error || t('common.error', locale) }));
        return;
      }
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      loadCrmConnections();
    } catch (err) {
      setCrmError((prev) => ({ ...prev, [provider]: t('common.error', locale) }));
    } finally {
      setApiKeyConnecting((prev) => ({ ...prev, [provider]: false }));
    }
  }

  // Suite 15 — même principe, mais deux valeurs (Sellsy). docx item 27 :
  // généralisé à un état indexé par provider.
  async function handleConnectTwoFieldCrm(provider) {
    const fields = twoFieldInputs[provider] || { fieldOne: '', fieldTwo: '' };
    if (!fields.fieldOne.trim() || !fields.fieldTwo.trim()) return;
    setTwoFieldConnecting((prev) => ({ ...prev, [provider]: true }));
    setCrmError((prev) => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch(`/api/crm-connections/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: fields.fieldOne.trim(),
          client_secret: fields.fieldTwo.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError((prev) => ({ ...prev, [provider]: body.error || t('common.error', locale) }));
        return;
      }
      setTwoFieldInputs((prev) => ({ ...prev, [provider]: { fieldOne: '', fieldTwo: '' } }));
      loadCrmConnections();
    } catch (err) {
      setCrmError((prev) => ({ ...prev, [provider]: t('common.error', locale) }));
    } finally {
      setTwoFieldConnecting((prev) => ({ ...prev, [provider]: false }));
    }
  }

  async function handleSyncCrm(provider) {
    setCrmSyncing((prev) => ({ ...prev, [provider]: true }));
    setCrmSyncResult((prev) => ({ ...prev, [provider]: null }));
    setCrmError((prev) => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch('/api/crm-connections/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError((prev) => ({ ...prev, [provider]: body.error || t('common.error', locale) }));
        return;
      }
      setCrmSyncResult((prev) => ({ ...prev, [provider]: body }));
    } catch (err) {
      setCrmError((prev) => ({ ...prev, [provider]: t('common.error', locale) }));
    } finally {
      setCrmSyncing((prev) => ({ ...prev, [provider]: false }));
    }
  }

  // /api/auth/google et /api/auth/microsoft sont atteintes par navigation complète
  // (window.location.href), pas par fetch() — l'intercepteur global qui ajoute le
  // token d'auth ne s'applique donc pas ici. On récupère le token de session et on
  // le passe explicitement en paramètre, pour que le serveur dérive l'identité du
  // token vérifié plutôt que de faire confiance à un user_id dans l'URL.
  async function connectProvider(provider) {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `/api/auth/${provider}?token=${encodeURIComponent(session.access_token)}`;
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            color: var(--muted);
            font-family: 'Inter', sans-serif;
          }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            color: var(--accent-red);
            font-family: 'Inter', sans-serif;
            text-align: center;
            padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  const googleConnection = connections.find((c) => c.provider === 'google');
  const microsoftConnection = connections.find((c) => c.provider === 'microsoft');
  const ALL_CRM_PROVIDERS = [...DIRECT_CRM_PROVIDERS, ...API_KEY_CRM_PROVIDERS, ...TWO_FIELD_CRM_PROVIDERS];

  // Demande Alex (2026-08-26) : le label Gmail "🤖 Géré par Aaron" (seul repère
  // visuel, dans SA boîte, pour savoir quels fils Aaron gère) n'apparaît jamais
  // sur les fils envoyés avec un jeton Google connecté AVANT l'ajout du scope
  // gmail.labels (voir app/api/auth/google/route.ts, commentaire du 25/08) —
  // Google ne redonne jamais ce droit rétroactivement à un jeton déjà émis, et
  // l'échec de pose du label est volontairement silencieux côté envoi (voir
  // applyAaronLabel dans lib/google.ts) pour ne jamais bloquer un email pour un
  // simple souci d'étiquette. Résultat : sans repère ici, ce cas est invisible
  // pour le commercial — l'email part normalement, juste sans label. On détecte
  // donc le scope manquant à partir de connection.scopes (stocké tel quel depuis
  // la réponse OAuth de Google, voir app/api/auth/google/callback) et on
  // affiche un avertissement explicite avec un bouton de reconnexion.
  // CORRECTION (27/08/2026) : le scope requis pour poser le label s'est
  // avéré être gmail.modify, pas gmail.labels comme cru le 25/08 — voir
  // app/api/auth/google/route.ts pour l'explication complète (labels.list
  // fonctionnait déjà avec gmail.labels, mais pas threads.modify, l'appel
  // qui pose réellement le label sur le fil).
  const googleMissingLabelScope =
    !!googleConnection &&
    !(googleConnection.scopes || []).includes('https://www.googleapis.com/auth/gmail.modify');

  return (
    <Shell active={t('nav.connections', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('connexions.eyebrow', locale)}</p>
        <h1>{t('nav.connections', locale)}</h1>
        <p className="subtitle">{t('connexions.subtitle', locale)}</p>
      </header>

      {/* Fusion "Mon compte" (demande Alex 2026-08-25) : 7 onglets — mon
          profil / mon entreprise / connexion / crm / préférences /
          abonnement / supprimer mon compte — au lieu des 3 anciens onglets
          ici + 3 autres qui vivaient dans Préférences (app/app/preferences). */}
      <div className="tabs">
        <button type="button" className={activeTab === 'profile' ? 'tab active' : 'tab'} onClick={() => setActiveTab('profile')}>
          {t('connexions.tabProfile', locale)}
        </button>
        <button type="button" className={activeTab === 'company' ? 'tab active' : 'tab'} onClick={() => setActiveTab('company')}>
          {t('connexions.tabCompany', locale)}
        </button>
        <button type="button" className={activeTab === 'connection' ? 'tab active' : 'tab'} onClick={() => setActiveTab('connection')}>
          {t('connexions.tabConnection', locale)}
        </button>
        <button type="button" className={activeTab === 'crm' ? 'tab active' : 'tab'} onClick={() => setActiveTab('crm')}>
          {t('connexions.tabCrm', locale)}
        </button>
        <button type="button" className={activeTab === 'preferences' ? 'tab active' : 'tab'} onClick={() => setActiveTab('preferences')}>
          {t('connexions.tabPreferences', locale)}
        </button>
        <button type="button" className={activeTab === 'subscription' ? 'tab active' : 'tab'} onClick={() => setActiveTab('subscription')}>
          {t('connexions.tabSubscription', locale)}
        </button>
        {/* Onglet ajouté le 25/08 (demande Alex) : "Supprimer mon compte",
            self-service avec avertissement -> confirmation par saisie exacte
            -> "êtes-vous certain ?" -> suppression réelle 24h plus tard (voir
            AccountDeletionPanel plus bas et app/api/account/deletion). */}
        <button type="button" className={activeTab === 'delete' ? 'tab active' : 'tab'} onClick={() => setActiveTab('delete')}>
          {t('connexions.tabDelete', locale)}
        </button>
      </div>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : activeTab === 'profile' ? (
        <div className="profile-panel">
          <label className="profile-label">{t('connexions.profileNameLabel', locale)}</label>
          <input
            type="text"
            className="profile-input"
            value={profileName}
            onChange={(e) => { setProfileName(e.target.value); setProfileSaved(false); }}
            placeholder={t('connexions.profileNamePlaceholder', locale)}
          />
          {profileError && <p className="crm-error">{profileError}</p>}
          {profileSaved && <p className="profile-saved">{t('connexions.profileSaved', locale)}</p>}
          <button type="button" className="btn-primary" onClick={handleSaveProfile} disabled={profileSaving || !profileName.trim()}>
            {profileSaving ? t('connexions.profileSaving', locale) : t('connexions.profileSaveButton', locale)}
          </button>

          {/* Vraie page profil (demande Alex 2026-08-25) : email + mot de
              passe, modifiables avec vérification — voir handleChangeEmail
              (Supabase Auth envoie le lien de confirmation) et
              handleChangePassword (ré-authentification par mot de passe
              actuel avant d'autoriser le changement). */}
          <div className="profile-section">
            <label className="profile-label">{t('connexions.emailSectionLabel', locale)}</label>
            <p className="profile-current-value">{currentEmail || '—'}</p>
            <input
              type="email"
              className="profile-input"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setEmailChangeSent(false); setEmailChangeError(null); }}
              placeholder={t('connexions.emailNewPlaceholder', locale)}
            />
            {emailChangeError && <p className="crm-error">{emailChangeError}</p>}
            {emailChangeSent && <p className="profile-saved">{t('connexions.emailChangeSentMsg', locale)}</p>}
            <button
              type="button"
              className="btn-primary"
              onClick={handleChangeEmail}
              disabled={emailChangeSaving || !newEmail.trim() || newEmail.trim() === currentEmail}
            >
              {emailChangeSaving ? t('connexions.emailChangeSaving', locale) : t('connexions.emailChangeButton', locale)}
            </button>
            <p className="profile-hint">{t('connexions.emailChangeHint', locale)}</p>
          </div>

          <div className="profile-section">
            <label className="profile-label">{t('connexions.passwordSectionLabel', locale)}</label>
            <input
              type="password"
              className="profile-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('connexions.passwordCurrentLabel', locale)}
              autoComplete="current-password"
            />
            <input
              type="password"
              className="profile-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('connexions.passwordNewLabel', locale)}
              autoComplete="new-password"
            />
            <input
              type="password"
              className="profile-input"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder={t('connexions.passwordConfirmLabel', locale)}
              autoComplete="new-password"
            />
            {passwordChangeError && <p className="crm-error">{passwordChangeError}</p>}
            {passwordChangeSaved && <p className="profile-saved">{t('connexions.passwordChangeSavedMsg', locale)}</p>}
            <button type="button" className="btn-primary" onClick={handleChangePassword} disabled={passwordChangeSaving}>
              {passwordChangeSaving ? t('connexions.passwordChangeSaving', locale) : t('connexions.passwordChangeButton', locale)}
            </button>
          </div>
        </div>
      ) : activeTab === 'company' ? (
        <div className="company-panel">
          {summaryLoaded && (
            <div className="company-section">
              <div className="header-row">
                <h3 className="company-section-title">{t('preferences.businessProfileLabel', locale)}</h3>
                <button type="button" className="expand-btn" onClick={() => setSummaryExpanded(true)} title={t('preferences.businessProfileExpandButton', locale)}>
                  ⤢ {t('preferences.businessProfileExpandButton', locale)}
                </button>
              </div>
              <textarea
                rows={12}
                value={businessSummary}
                onChange={(e) => {
                  setBusinessSummary(e.target.value);
                  setSummaryDirty(true);
                }}
                placeholder={t('preferences.businessProfilePlaceholder', locale)}
              />
              <div className="actions">
                <button className="btn-secondary" onClick={handleSaveSummary} disabled={savingSummary}>
                  {savingSummary ? t('preferences.savingEllipsis', locale) : t('preferences.saveSummaryButton', locale)}
                </button>
                {summarySaved && <span className="saved-msg">{t('preferences.summarySavedMsg', locale)}</span>}
                <Link href={`/app/chat?user_id=${userId}&restart_questionnaire=1`} className="btn-secondary link-btn">
                  {t('preferences.retakeQuestionnaireButton', locale)}
                </Link>
              </div>

              {/* Export Word/PDF "à tout moment" + import d'une version
                  modifiée (demande Alex, 27/08/2026) — voir
                  app/api/business-summary/export et .../import. */}
              <div className="profile-io-row">
                <button type="button" className="btn-secondary" onClick={() => handleExportSummary('word')} disabled={exportingFormat !== null}>
                  {exportingFormat === 'word' ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileExportWordButton', locale)}
                </button>
                <button type="button" className="btn-secondary" onClick={() => handleExportSummary('pdf')} disabled={exportingFormat !== null}>
                  {exportingFormat === 'pdf' ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileExportPdfButton', locale)}
                </button>
                <button type="button" className="btn-secondary" onClick={() => importFileInputRef.current?.click()} disabled={importUploading}>
                  {importUploading ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileImportButton', locale)}
                </button>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".docx,.rtf,.pdf,application/pdf,application/rtf,text/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: 'none' }}
                  onChange={handleImportFileChange}
                />
              </div>
              {exportError && <p className="crm-error">{exportError}</p>}
              {importError && <p className="crm-error">{importError}</p>}

              {pendingImport && (
                <div className="pending-import-banner">
                  <p className="pending-import-text">
                    {t('preferences.businessProfilePendingLabel', locale)} <strong>{pendingImport.fileName}</strong>
                    {pendingImport.uploadedAt ? ` (${new Date(pendingImport.uploadedAt).toLocaleDateString('fr-FR')})` : ''}
                  </p>
                  {analyzeError && <p className="crm-error">{analyzeError}</p>}
                  <div className="pending-import-actions">
                    <button type="button" className="btn-secondary" onClick={handleDiscardPendingImport} disabled={discardingImport || analyzingImport}>
                      {discardingImport ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileDiscardButton', locale)}
                    </button>
                    <button type="button" className="btn-primary" onClick={handleAnalyzePendingImport} disabled={discardingImport || analyzingImport}>
                      {analyzingImport ? t('preferences.businessProfileAnalyzingEllipsis', locale) : t('preferences.businessProfileAnalyzeButton', locale)}
                    </button>
                  </div>
                </div>
              )}

              {analyzeChangeNote && (
                <div className="analyze-change-note">
                  <p className="analyze-change-note-title">{t('preferences.businessProfileChangeNoteTitle', locale)}</p>
                  <p>{analyzeChangeNote}</p>
                </div>
              )}
            </div>
          )}

          {summaryExpanded && (
            <BusinessSummaryExpandModal
              locale={locale}
              value={businessSummary}
              onChange={(v) => {
                setBusinessSummary(v);
                setSummaryDirty(true);
              }}
              onClose={() => setSummaryExpanded(false)}
              onSave={handleSaveSummary}
              saving={savingSummary}
              saved={summarySaved}
              onExport={handleExportSummary}
              exportingFormat={exportingFormat}
            />
          )}

          {/* Lien public / site web (docx, retour Alex 27/08/2026) : vivait
              dans Préférences alors qu'il s'agit d'une info d'entreprise —
              déplacé ici, avec sa propre sauvegarde dédiée (handleSavePublicLink)
              plutôt que de dépendre du gros bouton "Enregistrer" de Préférences
              qui soumettait aussi des réglages sans rapport. Le jeton {lien}
              dans l'éditeur d'email par défaut (Préférences) continue de lire
              prefs.public_link_url normalement, sans changement. */}
          {/* BUG CORRIGÉ (27/08/2026, crash constaté par Alex — "Application
              error: a client-side exception has occurred" en ouvrant Mon
              entreprise) : ce bloc lisait prefs.public_link_url sans garde,
              alors que prefs démarre à null (voir useState(null) plus haut)
              et se charge de façon async — toute ouverture de l'onglet avant
              la fin du chargement plantait la page. Les autres sections de
              cet onglet ont leur propre garde (summaryLoaded, signatureLoaded,
              legalInfoLoaded) ; celle-ci utilise directement prefs. */}
          {prefs && (
            <div className="company-section">
              <h3 className="company-section-title">{t('preferences.publicLinkLabel', locale)}</h3>
              <input
                type="text"
                className="cap-input"
                value={prefs.public_link_url || ''}
                onChange={(e) => setPrefs({ ...prefs, public_link_url: e.target.value })}
                placeholder={t('preferences.publicLinkPlaceholder', locale)}
              />
              {publicLinkError && <p className="error">{publicLinkError}</p>}
              <p className="collab-extra-hint">
                {t('preferences.publicLinkHint', locale)}
              </p>
              <div className="actions">
                <button className="btn-secondary" onClick={handleSavePublicLink} disabled={savingPublicLink}>
                  {savingPublicLink ? t('preferences.savingEllipsis', locale) : t('common.save', locale)}
                </button>
                {publicLinkSaved && <span className="saved-msg">{t('preferences.prefsSavedMsg', locale)}</span>}
              </div>
            </div>
          )}

          {signatureLoaded && (
            <div className="company-section">
              <h3 className="company-section-title">{t('preferences.signatureLabel', locale)}</h3>
              <textarea
                rows={4}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={t('preferences.signaturePlaceholder', locale)}
              />
              {signatureError && <p className="error">{signatureError}</p>}
              <div className="actions">
                <button type="button" className="btn-secondary" onClick={handleDetectSignature} disabled={detectingSignature}>
                  {detectingSignature ? t('preferences.detectingEllipsis', locale) : t('preferences.detectSignatureButton', locale)}
                </button>
                <button className="btn-secondary" onClick={handleSaveSignature} disabled={savingSignature}>
                  {savingSignature ? t('preferences.savingEllipsis', locale) : t('preferences.saveSignatureButton', locale)}
                </button>
                {signatureSaved && <span className="saved-msg">{t('preferences.signatureSavedMsg', locale)}</span>}
              </div>
              <p className="collab-extra-hint">
                {t('preferences.signatureDetectHint', locale)}
              </p>

              {/* Signature avec image ("carte de visite", demande Alex
                  2026-08-25) : la signature texte ci-dessus reste facultative,
                  cette image est ajoutée dessous dans les emails envoyés —
                  voir handleUploadSignatureImage / lib/messaging.ts. */}
              <div className="signature-image-block">
                <label className="sub-label">{t('connexions.signatureImageLabel', locale)}</label>
                <p className="collab-extra-hint">{t('connexions.signatureImageHint', locale)}</p>
                {signatureImageUrl && (
                  <div className="signature-image-preview">
                    <img src={signatureImageUrl} alt="Signature" />
                    <button type="button" className="btn-secondary" onClick={handleRemoveSignatureImage} disabled={signatureImageUploading}>
                      {t('connexions.signatureImageRemoveButton', locale)}
                    </button>
                  </div>
                )}
                <div className="upload-row">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={(e) => setSignatureImageFile(e.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleUploadSignatureImage}
                    disabled={!signatureImageFile || signatureImageUploading}
                  >
                    {signatureImageUploading ? t('connexions.signatureImageUploadingEllipsis', locale) : t('connexions.signatureImageUploadButton', locale)}
                  </button>
                </div>
                {signatureImageError && <p className="error">{signatureImageError}</p>}
              </div>
            </div>
          )}

          {legalInfoLoaded && (
            <div className="company-section">
              <h3 className="company-section-title">{t('preferences.legalInfoLabel', locale)}</h3>
              <p className="collab-extra-hint">{t('preferences.legalInfoHint', locale)}</p>
              <div className="legal-grid">
                <div className="legal-field">
                  <label className="legal-field-label">{t('connexions.legalInfoSiretLabel', locale)}</label>
                  <input
                    type="text"
                    value={legalInfo.siret}
                    onChange={(e) => setLegalInfo({ ...legalInfo, siret: e.target.value })}
                    placeholder={t('preferences.legalInfoSiretPlaceholder', locale)}
                  />
                </div>
                <div className="legal-field">
                  <label className="legal-field-label">{t('connexions.legalInfoFormLabel', locale)}</label>
                  <input
                    type="text"
                    value={legalInfo.legal_form}
                    onChange={(e) => setLegalInfo({ ...legalInfo, legal_form: e.target.value })}
                    placeholder={t('preferences.legalInfoFormPlaceholder', locale)}
                  />
                </div>
                <div className="legal-field legal-field-full">
                  <label className="legal-field-label">{t('connexions.legalInfoAddressLabel', locale)}</label>
                  <input
                    type="text"
                    value={legalInfo.legal_address}
                    onChange={(e) => setLegalInfo({ ...legalInfo, legal_address: e.target.value })}
                    placeholder={t('preferences.legalInfoAddressPlaceholder', locale)}
                  />
                </div>
                <div className="legal-field">
                  <label className="legal-field-label">{t('connexions.legalInfoVatLabel', locale)}</label>
                  <input
                    type="text"
                    value={legalInfo.vat_number}
                    onChange={(e) => setLegalInfo({ ...legalInfo, vat_number: e.target.value })}
                    placeholder={t('preferences.legalInfoVatPlaceholder', locale)}
                  />
                </div>
                <div className="legal-field legal-field-full">
                  <label className="legal-field-label">{t('connexions.legalInfoVatExemptLabel', locale)}</label>
                  <input
                    type="text"
                    value={legalInfo.vat_exempt_mention}
                    onChange={(e) => setLegalInfo({ ...legalInfo, vat_exempt_mention: e.target.value })}
                    placeholder={t('preferences.legalInfoVatExemptPlaceholder', locale)}
                  />
                </div>
              </div>
              <div className="actions">
                <button className="btn-secondary" onClick={handleSaveLegalInfo} disabled={savingLegalInfo}>
                  {savingLegalInfo ? t('preferences.savingEllipsis', locale) : t('preferences.legalInfoSaveButton', locale)}
                </button>
                {legalInfoSaved && <span className="saved-msg">{t('preferences.legalInfoSavedMsg', locale)}</span>}
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'connection' ? (
        <div className="cards">
          {oauthJustConnected && (
            <div className="oauth-success-banner">
              <p>{t('connexions.oauthSuccessBanner', locale)}</p>
              <Link href={`/app/prospects?user_id=${userId}`} className="oauth-success-cta">
                {t('connexions.oauthSuccessCta', locale)} →
              </Link>
            </div>
          )}
          <ConnectionCard
            title={PROVIDER_META.google.name}
            desc={PROVIDER_META.google.desc}
            connection={googleConnection}
            health={emailHealth.find((h) => h.provider === 'google')}
            missingLabelScope={googleMissingLabelScope}
            onConnect={() => connectProvider('google')}
            onDisconnect={() => handleDisconnect(googleConnection.id)}
          />
          <ConnectionCard
            title={PROVIDER_META.microsoft.name}
            desc={PROVIDER_META.microsoft.desc}
            connection={microsoftConnection}
            health={emailHealth.find((h) => h.provider === 'microsoft')}
            onConnect={() => connectProvider('microsoft')}
            onDisconnect={() => handleDisconnect(microsoftConnection.id)}
          />
        </div>
      ) : activeTab === 'crm' ? (
        <>
          {/* Demande Alex (2026-08-22) : niveau de collaboration (0-3) +
              fournisseur/notes CRM, déplacés depuis Préférences vers ici —
              juste au-dessus de la liste des CRM, à côté des cartes de
              connexion elles-mêmes. */}
          {collabPrefs && (
            <div className="collab-panel">
              <h2 className="category-title collab-heading">{t('preferences.crm.collabLevelLabel', locale)}</h2>
              <div className="collab-options">
                {COLLABORATION_LEVELS.map((lvl) => (
                  <button
                    key={lvl.value}
                    type="button"
                    className={collabPrefs.collaboration_level === lvl.value ? 'collab-card active' : 'collab-card'}
                    onClick={() => setCollabPrefs({ ...collabPrefs, collaboration_level: lvl.value })}
                  >
                    <span className="collab-card-title">{lvl.label}</span>
                    <span className="collab-card-desc">{lvl.desc}</span>
                  </button>
                ))}
              </div>

              {collabPrefs.collaboration_level === 1 && (
                <div className="collab-extra">
                  <p className="crm-directory-hint">{t('preferences.crm.uploadHint', locale)}</p>
                  <div className="upload-row">
                    <input type="file" accept=".xls,.xlsx,.csv,.pdf,.txt" onChange={(e) => setCollabUploadFile(e.target.files?.[0] || null)} />
                    <button type="button" className="btn-secondary" onClick={handleCollabUpload} disabled={!collabUploadFile || collabUploading}>
                      {collabUploading ? t('preferences.crm.uploadingEllipsis', locale) : t('preferences.crm.uploadButton', locale)}
                    </button>
                  </div>
                  {collabUploadDone && <p className="profile-saved">{t('preferences.crm.uploadDoneMsg', locale)}</p>}
                </div>
              )}

              {(collabPrefs.collaboration_level === 2 || collabPrefs.collaboration_level === 3) && (
                <div className="collab-extra">
                  <label className="profile-label">{t('preferences.crm.whichCrmLabel', locale)}</label>
                  <select
                    className="profile-input"
                    value={collabPrefs.crm_provider || ''}
                    onChange={(e) => setCollabPrefs({ ...collabPrefs, crm_provider: e.target.value || null })}
                  >
                    {CRM_PROVIDERS_SELECT.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <label className="profile-label">{t('preferences.crm.notesLabel', locale)}</label>
                  <textarea
                    className="profile-input add-crm-textarea"
                    rows={3}
                    value={collabPrefs.crm_connection_notes || ''}
                    onChange={(e) => setCollabPrefs({ ...collabPrefs, crm_connection_notes: e.target.value })}
                    placeholder={t('preferences.crm.notesPlaceholder', locale)}
                  />
                </div>
              )}

              <button type="button" className="btn-primary collab-save" onClick={handleSaveCollab} disabled={collabSaving}>
                {collabSaving ? t('connexions.profileSaving', locale) : t('connexions.profileSaveButton', locale)}
              </button>
              {collabSaved && <p className="profile-saved">{t('connexions.profileSaved', locale)}</p>}
            </div>
          )}

          <h2 className="category-title">{t('connexions.crmCategoryTitle', locale)}</h2>
          <p className="crm-directory-hint">{t('connexions.crmDirectoryHint', locale)}</p>
          {crmOauthBannerError && <p className="crm-error">{crmOauthBannerError}</p>}

          {/* Demande Alex (2026-08-22) : barre de recherche pour filtrer les
              CRM directement, plutôt que de parcourir toute la grille. */}
          <input
            type="text"
            className="crm-search"
            value={crmSearch}
            onChange={(e) => setCrmSearch(e.target.value)}
            placeholder={t('connexions.crmSearchPlaceholder', locale)}
          />

          {(() => {
            const filtered = ALL_CRM_PROVIDERS.filter((provider) =>
              CRM_META[provider].name.toLowerCase().includes(crmSearch.trim().toLowerCase())
            );
            // Demande Alex : 6 cartes affichées par défaut + "voir plus" —
            // le plafond ne s'applique que tant qu'aucune recherche n'est en
            // cours (chercher un CRM doit toujours montrer TOUS les résultats
            // correspondants, pas seulement les 6 premiers).
            const visible = crmSearch.trim() || crmShowAll ? filtered : filtered.slice(0, 6);
            return (
              <>
                <div className="cards">
                  {visible.map((provider) => {
                    const connected = crmConnections.some((c) => c.provider === provider);
                    const common = {
                      key: provider,
                      provider,
                      title: CRM_META[provider].name,
                      desc: CRM_META[provider].desc,
                      connected,
                      canManage: userRole === 'patron',
                      onDisconnect: () => handleDisconnectCrm(provider),
                      onSync: () => handleSyncCrm(provider),
                      syncing: !!crmSyncing[provider],
                      syncResult: crmSyncResult[provider],
                      error: crmError[provider],
                    };
                    if (DIRECT_CRM_PROVIDERS.includes(provider)) {
                      // Demande Alex : "quand on clique sur les crm rien ne se
                      // passe" — pas de formulaire à remplir pour ces CRM-là
                      // (connexion OAuth en un clic), donc toute la carte
                      // déclenche la connexion, pas seulement le bouton.
                      return (
                        <CrmConnectionCard
                          {...common}
                          onConnect={() => handleConnectCrm(provider)}
                          onCardClick={!connected && userRole === 'patron' ? () => handleConnectCrm(provider) : null}
                        />
                      );
                    }
                    if (API_KEY_CRM_PROVIDERS.includes(provider)) {
                      return (
                        <ApiKeyCrmConnectionCard
                          {...common}
                          apiKeyInput={apiKeyInputs[provider] || ''}
                          onApiKeyInputChange={(v) => setApiKeyInputs((prev) => ({ ...prev, [provider]: v }))}
                          onConnect={() => handleConnectApiKeyCrm(provider)}
                          connecting={!!apiKeyConnecting[provider]}
                        />
                      );
                    }
                    const fields = twoFieldInputs[provider] || { fieldOne: '', fieldTwo: '' };
                    return (
                      <TwoFieldCrmConnectionCard
                        {...common}
                        fieldOneInput={fields.fieldOne}
                        onFieldOneInputChange={(v) => setTwoFieldInputs((prev) => ({ ...prev, [provider]: { ...fields, fieldOne: v } }))}
                        fieldTwoInput={fields.fieldTwo}
                        onFieldTwoInputChange={(v) => setTwoFieldInputs((prev) => ({ ...prev, [provider]: { ...fields, fieldTwo: v } }))}
                        onConnect={() => handleConnectTwoFieldCrm(provider)}
                        connecting={!!twoFieldConnecting[provider]}
                      />
                    );
                  })}
                </div>
                {!crmSearch.trim() && filtered.length > 6 && (
                  <button type="button" className="btn-secondary crm-showmore" onClick={() => setCrmShowAll(!crmShowAll)}>
                    {crmShowAll ? t('connexions.crmShowLess', locale) : t('connexions.crmShowMoreTemplate', locale).replace('{count}', filtered.length - 6)}
                  </button>
                )}
                {crmSearch.trim() && filtered.length === 0 && (
                  <p className="crm-directory-hint">{t('connexions.crmSearchEmpty', locale)}</p>
                )}
              </>
            );
          })()}

          {/* docx item 27 / tâche #139 : "ajouter un autre CRM" — amène
              maintenant directement au chat Aaron avec un message pré-rempli
              (demande Alex 2026-08-22) plutôt que d'ouvrir une conversation
              dédiée dans une fenêtre à part. */}
          <Link
            href={`/app/chat?user_id=${userId}&prefill=${encodeURIComponent(t('connexions.addOtherCrmPrefillMessage', locale))}`}
            className="add-crm-panel add-crm-panel-link"
          >
            <h3>{t('connexions.addOtherCrmTitle', locale)}</h3>
            <p className="add-crm-hint">{t('connexions.addOtherCrmHint', locale)}</p>
            <span className="btn-secondary add-crm-cta">{t('connexions.crmChatOpenButton', locale)}</span>
          </Link>
        </>
      ) : activeTab === 'preferences' ? (
        loadError ? (
          <div className="load-error">
            <p>{loadError}</p>
            <button type="button" className="btn-secondary" onClick={loadPrefs}>
              {t('common.retry', locale)}
            </button>
          </div>
        ) : prefsLoading || !prefs ? (
          <p className="muted">{t('common.loading', locale)}</p>
        ) : (
          <div className="preferences-panel">
            {/* Thème déplacé ici depuis Mon profil, au-dessus du canal de
                notification (demande Alex 2026-08-25). */}
            <div className="field">
              <label>{t('connexions.themeLabel', locale)}</label>
              <div className="theme-toggle">
                <button type="button" className={theme === 'dark' ? 'theme-btn active' : 'theme-btn'} onClick={() => changeTheme('dark')}>
                  {t('connexions.themeDark', locale)}
                </button>
                <button type="button" className={theme === 'light' ? 'theme-btn active' : 'theme-btn'} onClick={() => changeTheme('light')}>
                  {t('connexions.themeLight', locale)}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('preferences.notifyChannelLabel', locale)}</label>
              <div className="options">
                {CHANNEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={prefs.notify_channel === opt.value ? 'option active' : 'option'}
                    onClick={() => setPrefs({ ...prefs, notify_channel: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {(prefs.notify_channel === 'push' || prefs.notify_channel === 'both') && (
                <PushNotificationManager emailConnected={!!(googleConnection || microsoftConnection)} />
              )}
            </div>

            <div className="field">
              <label>{t('preferences.notifyDelayLabel', locale)}</label>
              <div className="options">
                {DELAY_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    className={prefs.notify_before_appointment_minutes === minutes ? 'option active' : 'option'}
                    onClick={() => setPrefs({ ...prefs, notify_before_appointment_minutes: minutes })}
                  >
                    {minutes} {t('preferences.minutesUnit', locale)}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>{t('preferences.firstEmailLabel', locale)}</label>
              <div className="options">
                {FIRST_EMAIL_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={prefs.require_first_email_approval === opt.value ? 'option active' : 'option'}
                    onClick={() => setPrefs({ ...prefs, require_first_email_approval: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="collab-extra-hint">
                {t('preferences.firstEmailHint', locale)}
              </p>
            </div>

            <div className="field">
              <label>{t('preferences.dailyCapLabel', locale)}</label>
              <input
                type="number"
                min={1}
                max={2000}
                className="cap-input"
                value={prefs.daily_prospecting_email_cap}
                onChange={(e) => setPrefs({ ...prefs, daily_prospecting_email_cap: e.target.value === '' ? '' : Number(e.target.value) })}
              />
              <p className="collab-extra-hint">
                {t('preferences.dailyCapHint', locale)}
              </p>
            </div>

            <div className="field">
              <label>{t('preferences.prospectingGoalLabel', locale)}</label>
              <div className="options">
                {PROSPECTING_GOAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={prefs.prospecting_goal === opt.value ? 'option active' : 'option'}
                    onClick={() => setPrefs({ ...prefs, prospecting_goal: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {prefs.prospecting_goal === 'autre' && (
                <input
                  type="text"
                  className="cap-input"
                  placeholder={t('preferences.prospectingGoalDetailsPlaceholder', locale)}
                  value={prefs.prospecting_goal_details}
                  onChange={(e) => setPrefs({ ...prefs, prospecting_goal_details: e.target.value })}
                />
              )}
              <p className="collab-extra-hint">
                {t('preferences.prospectingGoalHint', locale)}
              </p>
            </div>

            <div className="field">
              <label>{t('preferences.defaultFirstEmailLabel', locale)}</label>
              <div className="options">
                {DEFAULT_FIRST_EMAIL_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    className={prefs.default_first_email_enabled === opt.value ? 'option active' : 'option'}
                    onClick={() => setPrefs({ ...prefs, default_first_email_enabled: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {prefs.default_first_email_enabled && (
                <div className="default-email-fields">
                  <div className="token-toolbar">
                    <span className="token-toolbar-label">{t('preferences.defaultFirstEmailTokensLabelSubject', locale)}</span>
                    <button
                      type="button"
                      className="token-btn"
                      onClick={() => insertDefaultEmailToken(defaultEmailSubjectRef, 'default_first_email_subject', '{prenom}')}
                    >
                      {t('preferences.defaultFirstEmailInsertPrenom', locale)}
                    </button>
                    <button
                      type="button"
                      className="token-btn"
                      onClick={() => insertDefaultEmailToken(defaultEmailSubjectRef, 'default_first_email_subject', '{societe}')}
                    >
                      {t('preferences.defaultFirstEmailInsertSociete', locale)}
                    </button>
                  </div>
                  <input
                    ref={defaultEmailSubjectRef}
                    type="text"
                    className="cap-input"
                    placeholder={t('preferences.defaultFirstEmailSubjectPlaceholder', locale)}
                    value={prefs.default_first_email_subject}
                    onChange={(e) => setPrefs({ ...prefs, default_first_email_subject: e.target.value })}
                  />
                  <div className="token-toolbar">
                    <span className="token-toolbar-label">{t('preferences.defaultFirstEmailTokensLabelBody', locale)}</span>
                    <button
                      type="button"
                      className="token-btn"
                      onClick={() => insertDefaultEmailToken(defaultEmailBodyRef, 'default_first_email_body', '{prenom}')}
                    >
                      {t('preferences.defaultFirstEmailInsertPrenom', locale)}
                    </button>
                    <button
                      type="button"
                      className="token-btn"
                      onClick={() => insertDefaultEmailToken(defaultEmailBodyRef, 'default_first_email_body', '{societe}')}
                    >
                      {t('preferences.defaultFirstEmailInsertSociete', locale)}
                    </button>
                    {prefs.public_link_url && (
                      <button
                        type="button"
                        className="token-btn"
                        onClick={() => insertDefaultEmailToken(defaultEmailBodyRef, 'default_first_email_body', '{lien}')}
                      >
                        {t('preferences.defaultFirstEmailInsertLien', locale)}
                      </button>
                    )}
                  </div>
                  <textarea
                    ref={defaultEmailBodyRef}
                    rows={8}
                    placeholder={t('preferences.defaultFirstEmailBodyPlaceholder', locale)}
                    value={prefs.default_first_email_body}
                    onChange={(e) => setPrefs({ ...prefs, default_first_email_body: e.target.value })}
                  />
                </div>
              )}
              <p className="collab-extra-hint">
                {t('preferences.defaultFirstEmailHint', locale)}
              </p>
            </div>

            <div className="field">
              <label>{t('preferences.externalConversionWebhookLabel', locale)}</label>
              {prefs.external_conversion_webhook_secret ? (
                <div className="webhook-url-row">
                  <code className="webhook-url">
                    {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/external-conversion/${prefs.external_conversion_webhook_secret}`}
                  </code>
                  <button type="button" className="btn-copy" onClick={copyWebhookUrl}>
                    {webhookCopied ? t('team.copied', locale) : t('team.copy', locale)}
                  </button>
                </div>
              ) : (
                <p className="collab-extra-hint">
                  {t('preferences.externalConversionWebhookPending', locale)}
                </p>
              )}
              <p className="collab-extra-hint">
                {t('preferences.externalConversionWebhookHint', locale)}
              </p>
            </div>

            <div className="actions">
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? t('preferences.savingEllipsis', locale) : t('common.save', locale)}
              </button>
              {saved && <span className="saved-msg">{t('preferences.prefsSavedMsg', locale)}</span>}
            </div>
          </div>
        )
      ) : activeTab === 'subscription' ? (
        loadError ? (
          <div className="load-error">
            <p>{loadError}</p>
            <button type="button" className="btn-secondary" onClick={loadPrefs}>
              {t('common.retry', locale)}
            </button>
          </div>
        ) : prefsLoading || !prefs ? (
          <p className="muted">{t('common.loading', locale)}</p>
        ) : (
          <div className="subscription-panel">
            {usage?.renewal_date && (
              <p className="renewal-date">
                {t('connexions.renewalDateLabel', locale).replace(
                  '{date}',
                  new Date(usage.renewal_date).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
                )}
              </p>
            )}

            <div className="field">
              <label>{t('preferences.subscriptionLabel', locale)}</label>
              <div className="offer-options">
                {OFFERS.map((o) => {
                  const isActive = Boolean(prefs[`offer_${o.value.toLowerCase()}_active`]);
                  return (
                    <div key={o.value} className={`offer-card ${isActive ? 'active' : ''}`}>
                      <span className="offer-title">
                        {o.label}
                        <span className={`status-pill ${isActive ? 'on' : 'off'}`}>
                          {isActive ? t('preferences.subscription.activeLabel', locale) : t('preferences.subscription.inactiveLabel', locale)}
                        </span>
                      </span>
                      <span className="offer-desc">{o.desc}</span>
                      {prefs.role === 'patron' && (
                        <button
                          type="button"
                          className={isActive ? 'btn-danger' : 'btn-primary'}
                          disabled={moduleBusy === o.value}
                          onClick={() => handleToggleModule(o.value, isActive)}
                        >
                          {moduleBusy === o.value
                            ? '…'
                            : isActive
                              ? t('preferences.subscription.deactivateButton', locale)
                              : t('preferences.subscription.activateButton', locale)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {moduleError && <p className="error">{moduleError}</p>}
              {!moduleError && offerError && <p className="error">{offerError}</p>}
            </div>

            {/* Redesign (demande Alex 2026-08-25) : un seul bloc "Crédits" au
                lieu de 4 blocs empilés — solde réel affiché en crédits (calculé
                à partir du coût API réellement mesuré ce mois-ci, voir
                app/api/api-usage), avec explication du plafond mensuel inclus
                réparti sur le mois. Le "boost" (achat de crédits) se fait
                ensuite par module via 3 onglets, à la place des 3 cartes
                séparées qui s'empilaient auparavant. */}
            {usage && (
              <div className="field credits-field">
                <label>{t('connexions.creditsTitle', locale)}</label>
                <div className="usage-box">
                  <div className="usage-row">
                    <span>{t('connexions.creditsBalanceLabel', locale)}</span>
                    <strong>
                      {Math.max(0, Math.round((usage.monthly_cap_usd || 0) - (usage.month_cost_usd || 0) + (usage.credit_balance_eur || 0)))} {t('connexions.creditsUnit', locale)}
                    </strong>
                  </div>
                  <p className="usage-hint">
                    {t('connexions.creditsExplanation', locale).replace('{cap}', Math.round(usage.monthly_cap_usd || 0))}
                  </p>
                  {creditsError && <p className="error">{creditsError}</p>}

                  {prefs.role === 'patron' && (
                    <>
                      <p className="sub-label">{t('connexions.creditsBoostSectionLabel', locale)}</p>
                      <div className="tabs credits-module-tabs">
                        {OFFERS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            className={creditsModuleTab === o.value.toLowerCase() ? 'tab active' : 'tab'}
                            onClick={() => setCreditsModuleTab(o.value.toLowerCase())}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {(() => {
                        const moduleKey = creditsModuleTab;
                        const moduleBalance = Number(usage[`credit_balance_${moduleKey}_eur`] || 0);
                        return (
                          <div className="credits-module-panel">
                            <div className="usage-row">
                              <span>{t('preferences.credits.moduleLabelPrefix', locale)}</span>
                              <strong>{Math.round(moduleBalance)} {t('connexions.creditsUnit', locale)}</strong>
                            </div>
                            <div className="credits-buy-row">
                              {[20, 40, 60, 80, 100].map((credits) => (
                                <button
                                  key={credits}
                                  type="button"
                                  className="btn-secondary"
                                  disabled={buyingCredits !== null}
                                  onClick={() => handleBuyCredits(credits, moduleKey)}
                                >
                                  {buyingCredits === `${moduleKey}:${credits}` ? '…' : `+${credits} (${(credits * 1.5).toFixed(0)} €)`}
                                </button>
                              ))}
                            </div>
                            <div className="upload-row">
                              <input
                                type="number"
                                min={1}
                                max={5000}
                                className="cap-input"
                                placeholder={t('preferences.credits.customPlaceholder', locale)}
                                value={customCreditsByModule[moduleKey]}
                                onChange={(e) =>
                                  setCustomCreditsByModule((prev) => ({ ...prev, [moduleKey]: e.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={buyingCredits !== null || !customCreditsByModule[moduleKey]}
                                onClick={() => handleBuyCustomCreditsForModule(moduleKey)}
                              >
                                {t('preferences.credits.customButton', locale)}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Redesign (demande Alex 2026-08-25) : le bloc "Facturation"
                (portail Stripe complet) est supprimé — seules les factures
                Aaron restent, avec un plafond d'affichage à 5 + un bouton
                "voir plus"/"voir moins" plutôt qu'une liste qui s'allonge
                indéfiniment. */}
            {prefs?.role === 'patron' && (
              <div className="field credits-field">
                <label>{t('preferences.invoices.label', locale)}</label>
                <div className="usage-box">
                  <p className="usage-hint">{t('preferences.invoices.hint', locale)}</p>
                  {invoicesError && <p className="error">{invoicesError}</p>}
                  {!invoicesError && invoices === null && (
                    <p className="usage-hint">{t('preferences.invoices.loading', locale)}</p>
                  )}
                  {!invoicesError && invoices && invoices.length === 0 && (
                    <p className="usage-hint">{t('preferences.invoices.empty', locale)}</p>
                  )}
                  {!invoicesError && invoices && invoices.length > 0 && (
                    <>
                      <ul className="invoices-list">
                        {(invoicesShowAll ? invoices : invoices.slice(0, 5)).map((inv) => (
                          <li key={inv.id} className="invoice-row">
                            <span>
                              {new Date(inv.created * 1000).toLocaleDateString(locale)} —{' '}
                              {(inv.amount_paid / 100).toFixed(2)} {(inv.currency || 'eur').toUpperCase()}
                            </span>
                            {(inv.invoice_pdf || inv.hosted_invoice_url) && (
                              <a
                                href={inv.invoice_pdf || inv.hosted_invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="invoice-link"
                              >
                                {t('preferences.invoices.downloadLink', locale)}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                      {invoices.length > 5 && (
                        <button type="button" className="btn-secondary crm-showmore" onClick={() => setInvoicesShowAll(!invoicesShowAll)}>
                          {invoicesShowAll
                            ? t('preferences.invoices.showLess', locale)
                            : t('preferences.invoices.showMoreTemplate', locale).replace('{count}', invoices.length - 5)}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Suivi coût API interne (aaron@meetaaron.app uniquement, inchangé). */}
            {usage && prefs.email === 'aaron@meetaaron.app' && (
              <div className="field usage-field">
                <label>{t('preferences.usage.apiCostLabel', locale)}</label>
                <div className="usage-box">
                  <div className="usage-row">
                    <span>{t('preferences.usage.thisMonth', locale)}</span>
                    <strong>
                      {usage.month_cost_usd.toFixed(2)} $
                      {usage.monthly_cap_usd !== null && t('preferences.usage.capSuffixTemplate', locale).replace('{cap}', usage.monthly_cap_usd)}
                    </strong>
                  </div>
                  <div className="usage-row">
                    <span>{t('preferences.usage.today', locale)}</span>
                    <strong>{usage.today_cost_usd.toFixed(2)} $</strong>
                  </div>
                  <div className="usage-bars">
                    {usage.last_7_days.map((d) => (
                      <div key={d.date} className="usage-bar-wrap" title={`${d.date} : ${d.cost_usd.toFixed(2)} $`}>
                        <div
                          className="usage-bar"
                          style={{ height: `${Math.min(100, (d.cost_usd / (usage.daily_cap_usd || 1)) * 100)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="usage-hint">
                    {t('preferences.usage.hint', locale)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        <AccountDeletionPanel locale={locale} />
      )}

      <style jsx>{`
        .tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.6rem;
          border-bottom: 1px solid var(--border);
          /* Mobile (demande Alex, 27/08/2026) : 7 onglets ("Mon profil" à
             "Supprimer mon compte") ne tiennent jamais sur la largeur d'un
             téléphone. Avant, ça débordait de la page entière (voir
             overflow-x: hidden ajouté dans globals.css) et "Supprimer mon
             compte" devenait inatteignable. Maintenant la rangée défile
             elle-même horizontalement, contenue dans sa propre largeur —
             scrollbar masquée (barre d'onglets, pas un contenu à lire) mais
             le défilement tactile reste actif.*/
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar {
          display: none;
        }
        .tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--muted);
          font-size: 0.88rem;
          font-weight: 600;
          padding: 0.7rem 0.2rem;
          margin-right: 1.2rem;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
        }
        .tab.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        .profile-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          max-width: 420px;
        }
        .profile-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 0.35rem;
        }
        .profile-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.84rem;
          margin-bottom: 0.7rem;
          font-family: inherit;
        }
        .profile-saved {
          color: var(--accent-green);
          font-size: 0.82rem;
          margin: 0 0 0.7rem;
        }
        .theme-label {
          margin-top: 1.1rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .theme-toggle {
          display: inline-flex;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          overflow: hidden;
        }
        .theme-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 0.82rem;
          font-family: inherit;
          padding: 0.5rem 1rem;
          cursor: pointer;
        }
        .theme-btn.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 600;
        }
        .crm-directory-hint {
          color: var(--muted);
          font-size: 0.84rem;
          margin: -0.6rem 0 1rem;
        }
        .crm-error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.7rem;
        }
        .add-crm-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          margin-top: 1.6rem;
          max-width: 480px;
        }
        .add-crm-panel h3 {
          margin: 0 0 0.4rem;
          font-family: var(--font-display);
          font-size: 1rem;
        }
        .add-crm-hint {
          color: var(--muted);
          font-size: 0.82rem;
          margin: 0 0 0.8rem;
        }
        .add-crm-textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.84rem;
          margin-bottom: 0.7rem;
          font-family: inherit;
          resize: vertical;
        }
        .collab-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          margin-bottom: 1.6rem;
          max-width: 640px;
        }
        .collab-heading {
          margin: 0 0 0.8rem;
        }
        .collab-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
        }
        /* Audit mobile 27/08/2026 : contrairement à .legal-grid juste en
           dessous (qui a déjà ce même correctif), cette grille 2x2 restait
           figée en 2 colonnes sur mobile — texte de chaque carte écrasé sur
           ~140px de large dans .collab-panel (max-width: 640px). */
        @media (max-width: 600px) {
          .collab-options {
            grid-template-columns: 1fr;
          }
        }
        .collab-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.8rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .collab-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .collab-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .collab-card-title {
          font-weight: 600;
          font-size: 0.86rem;
          color: var(--text);
        }
        .collab-card-desc {
          font-size: 0.76rem;
          color: var(--muted);
          line-height: 1.35;
        }
        .collab-extra {
          margin-top: 0.9rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
        }
        .upload-row {
          display: flex;
          gap: 0.6rem;
          align-items: center;
          flex-wrap: wrap;
        }
        .collab-save {
          margin-top: 1rem;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1.1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .collab-save:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .crm-search {
          display: block;
          width: 100%;
          max-width: 360px;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.84rem;
          margin-bottom: 1rem;
          font-family: inherit;
          background: var(--surface);
          color: var(--text);
        }
        .crm-showmore {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1.1rem;
          font-size: 0.84rem;
          cursor: pointer;
          margin-top: 1rem;
        }
        .add-crm-panel-link {
          display: block;
          text-decoration: none;
          color: inherit;
          cursor: pointer;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .add-crm-panel-link:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .add-crm-cta {
          display: inline-block;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
        }
        /* Améliore la ligne d'upload "Niveau 1" du CRM (demande Alex
           2026-08-25 : "l'interface est moche pour le texte") — le bouton
           natif du champ fichier suit désormais le style des autres boutons
           secondaires de l'app, au lieu du bouton gris par défaut du
           navigateur, sans changer le comportement du champ. */
        .upload-row input[type='file'] {
          flex: 1;
          min-width: 200px;
          font-size: 0.8rem;
          color: var(--muted);
        }
        .upload-row input[type='file']::file-selector-button {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.8rem;
          font-weight: 600;
          font-family: inherit;
          margin-right: 0.8rem;
          cursor: pointer;
        }
        .upload-row input[type='file']::file-selector-button:hover {
          background: var(--bg);
        }
        .btn-primary,
        .btn-secondary,
        .btn-danger {
          border-radius: var(--radius-sm);
          padding: 0.6rem 1.1rem;
          font-size: 0.84rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-secondary {
          /* Retour Alex 27/08/2026 ("pas de contraste") : un fond transparent
             se confond avec le fond de la carte parente (souvent déjà
             var(--surface)) — un fond plus sombre que la carte fait
             ressortir le bouton comme un vrai bouton plutôt qu'un simple
             contour de texte. */
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
        }
        .btn-secondary:hover:not(:disabled) {
          background: var(--surface-hover);
          border-color: var(--accent);
        }
        .btn-secondary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
        }
        .link-btn {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }
        .saved-msg {
          color: var(--accent-green);
          font-size: 0.84rem;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.8rem;
          margin-top: 0.5rem;
          overflow-wrap: break-word;
        }
        .sub-label {
          display: block;
          font-size: 0.8rem;
          color: var(--muted);
          margin: 0.9rem 0 0.35rem;
        }
        .load-error {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.8rem;
          padding: 1.2rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--accent-red);
          font-size: 0.9rem;
        }
        /* Retour Alex 27/08/2026 ("pas de contraste") : ces champs vivent
           presque toujours dans une carte déjà en var(--surface)
           (.company-panel, .preferences-panel...) — un fond identique à leur
           conteneur les fait se fondre dedans. var(--bg), plus sombre, les
           fait ressortir comme un vrai champ "creusé" dans la carte. */
        select,
        textarea {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }
        select:focus,
        textarea:focus,
        input:focus {
          outline: none;
          border-color: var(--accent);
        }
        .cap-input {
          width: 100%;
          max-width: 140px;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }
        .default-email-fields {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          margin-top: 0.6rem;
        }
        .default-email-fields input,
        .default-email-fields textarea {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .field .cap-input[type='text'],
        .company-section .cap-input[type='text'] {
          max-width: 100%;
          margin-top: 0.6rem;
        }
        .token-toolbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .token-toolbar-label {
          font-size: 0.78rem;
          color: var(--muted);
          margin-right: 0.2rem;
        }
        .token-btn {
          background: var(--surface);
          border: 1px dashed var(--border);
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.55rem;
          font-size: 0.78rem;
          font-family: var(--font-mono);
          color: var(--accent);
          cursor: pointer;
        }
        .token-btn:hover {
          background: rgba(59, 130, 246, 0.08);
        }

        .webhook-url-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.6rem;
          margin-top: 0.6rem;
        }
        .webhook-url {
          flex: 1 1 auto;
          min-width: 0;
          font-family: var(--font-mono);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.82rem;
          color: var(--accent-green, #2ecc71);
          overflow-x: auto;
          white-space: nowrap;
        }
        .btn-copy {
          flex-shrink: 0;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }

        /* Onglet Mon profil : sections email/mot de passe (demande Alex
           2026-08-25). */
        .profile-section {
          margin-top: 1.4rem;
          padding-top: 1.1rem;
          border-top: 1px solid var(--border);
        }
        .profile-current-value {
          font-size: 0.82rem;
          color: var(--muted);
          margin: 0 0 0.6rem;
        }
        .profile-hint {
          font-size: 0.76rem;
          color: var(--muted);
          margin: 0.5rem 0 0;
          line-height: 1.4;
        }

        /* Onglet Mon entreprise (retravaillé le 27/08/2026, retour Alex :
           "pas très esthétique... pas de contraste") : chaque section
           (profil, lien public, signature, infos légales) est désormais
           clairement délimitée par un titre marqué (barre d'accent + police
           de titre) et un séparateur, au lieu d'un simple <label> qui se
           confondait avec le reste du texte. */
        .company-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          max-width: 640px;
        }
        .company-section {
          padding: 1.6rem 0;
          border-bottom: 1px solid var(--border-soft);
        }
        .company-section:first-child {
          padding-top: 0;
        }
        .company-section:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .company-section-title {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: var(--font-display);
          font-size: 1.02rem;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 0.9rem;
        }
        .company-section-title::before {
          content: '';
          flex-shrink: 0;
          width: 4px;
          height: 1.05rem;
          border-radius: 2px;
          background: var(--accent);
        }
        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
          margin-bottom: 0.9rem;
        }
        .header-row .company-section-title {
          margin-bottom: 0;
        }
        .expand-btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.78rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .expand-btn:hover {
          background: var(--surface-hover);
          border-color: var(--accent);
          color: var(--text);
        }
        .company-panel .actions {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          margin-top: 0.9rem;
          flex-wrap: wrap;
        }
        .profile-io-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-top: 0.7rem;
          padding-top: 0.9rem;
          border-top: 1px solid var(--border-soft);
          flex-wrap: wrap;
        }
        .pending-import-banner {
          margin-top: 1rem;
          padding: 0.9rem 1rem;
          background: rgba(75, 57, 239, 0.1);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
        }
        .pending-import-text {
          margin: 0 0 0.7rem;
          font-size: 0.86rem;
          color: var(--text);
        }
        .pending-import-actions {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .analyze-change-note {
          margin-top: 1rem;
          padding: 0.9rem 1rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 0.86rem;
          color: var(--text);
          line-height: 1.5;
        }
        .analyze-change-note-title {
          margin: 0 0 0.4rem;
          font-weight: 600;
          color: var(--accent);
        }
        .analyze-change-note p:last-child {
          margin: 0;
        }
        .signature-image-block {
          margin-top: 1.2rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .signature-image-preview {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin: 0.6rem 0 0.9rem;
          padding: 0.8rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          /* Audit mobile 27/08/2026 : sans flex-wrap, l'image (jusqu'à
             180px) + le bouton "Supprimer l'image" ne tenaient pas sur
             ~375px de large et le bouton se retrouvait coupé/inatteignable. */
          flex-wrap: wrap;
        }
        .signature-image-preview img {
          max-width: 180px;
          max-height: 80px;
          border-radius: var(--radius-sm);
        }
        .legal-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin: 0.6rem 0 1rem;
        }
        .legal-field-full {
          grid-column: 1 / -1;
        }
        .legal-field-label {
          display: block;
          font-size: 0.78rem;
          color: var(--muted);
          margin-bottom: 0.35rem;
        }
        .legal-field input {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.84rem;
          font-family: inherit;
        }
        @media (max-width: 600px) {
          .legal-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Onglets Préférences / Abonnement (portés depuis l'ancienne page
           Préférences, fusion "Mon compte" du 2026-08-25). */
        .preferences-panel,
        .subscription-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          max-width: 640px;
        }
        .renewal-date {
          font-size: 0.84rem;
          color: var(--muted);
          margin: -0.6rem 0 1.4rem;
        }
        .field {
          margin-bottom: 1.8rem;
        }
        .field:last-child {
          margin-bottom: 0;
        }
        .field label {
          display: block;
          font-size: 0.9rem;
          margin-bottom: 0.7rem;
        }
        .options {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .option {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.9rem;
          font-size: 0.84rem;
          cursor: pointer;
          font-family: inherit;
        }
        .option.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .offer-options {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .offer-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          align-items: flex-start;
        }
        .offer-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .offer-title {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .status-pill {
          font-size: 0.66rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
        }
        .status-pill.on {
          background: rgba(52, 199, 89, 0.16);
          color: var(--accent-green, #34c759);
        }
        .status-pill.off {
          background: rgba(139, 144, 168, 0.16);
          color: var(--muted);
        }
        .offer-desc {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .offer-card > button {
          margin-top: 0.4rem;
        }
        .credits-field {
          margin-top: 1rem;
        }
        .usage-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1rem;
        }
        .usage-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.86rem;
          margin-bottom: 0.5rem;
        }
        .usage-hint {
          font-size: 0.74rem;
          color: var(--muted);
          margin: 0;
          line-height: 1.4;
        }
        .credits-buy-row {
          display: flex;
          gap: 0.6rem;
          margin-top: 0.7rem;
          flex-wrap: wrap;
        }
        .credits-module-tabs {
          margin: 0 0 0.9rem;
        }
        .credits-module-panel {
          padding-top: 0.3rem;
        }
        .invoices-list {
          list-style: none;
          margin: 0.6rem 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .invoice-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.82rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid var(--border);
        }
        .invoice-row:last-child {
          border-bottom: none;
        }
        .invoice-link {
          color: var(--accent);
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
          margin-left: 0.8rem;
        }
        .usage-field {
          margin-top: 0.5rem;
        }
        .usage-bars {
          display: flex;
          align-items: flex-end;
          gap: 0.4rem;
          height: 48px;
          margin: 0.8rem 0 0.4rem;
        }
        .usage-bar-wrap {
          flex: 1;
          height: 100%;
          display: flex;
          align-items: flex-end;
          background: var(--surface);
          border-radius: 3px;
          overflow: hidden;
        }
        .usage-bar {
          width: 100%;
          background: var(--accent);
          min-height: 2px;
        }
      `}</style>

      <style jsx>{`
        .header {
          margin-bottom: 1.8rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0;
          max-width: 60ch;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
        }
        .oauth-success-banner {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 0.7rem;
          background: rgba(46, 204, 113, 0.1);
          border: 1px solid rgba(46, 204, 113, 0.3);
          border-radius: 10px;
          padding: 0.9rem 1.1rem;
        }
        .oauth-success-banner p {
          margin: 0;
          font-size: 0.88rem;
          color: var(--text);
        }
        .oauth-success-cta {
          flex-shrink: 0;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--accent);
          text-decoration: none;
          white-space: nowrap;
        }
        .oauth-success-cta:hover {
          text-decoration: underline;
        }
        .cards + .category-title {
          margin-top: 2rem;
        }
        .category-title {
          font-family: var(--font-display);
          font-size: 1.15rem;
          margin: 2rem 0 1rem;
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
  );
}

// "Supprimer mon compte" (demande Alex 2026-08-25) — 4e onglet de "Mon
// compte", à côté de CRM. Flux en plusieurs étapes bien distinctes, comme
// demandé : avertissement -> saisie exacte de la phrase de confirmation ->
// "êtes-vous certain(e) ?" -> suppression réelle programmée 24h plus tard
// (jamais immédiate). Voir app/api/account/deletion pour le backend et
// migration_account_deletion_2026-08-25.sql pour ce qui est réellement
// supprimé (société entière si seul·e sur l'espace, sinon juste l'accès
// personnel — voir le commentaire en tête de cette migration).
function AccountDeletionPanel({ locale }) {
  const [status, setStatus] = useState('loading'); // loading | idle | intro | confirm | final | scheduled
  const [scheduledFor, setScheduledFor] = useState(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/deletion')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.requested && body.scheduled_for) {
          setScheduledFor(body.scheduled_for);
          setStatus('scheduled');
        } else {
          setStatus('intro');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('intro');
      });
    return () => { cancelled = true; };
  }, []);

  const requiredPhrase = t('connexions.deleteConfirmPhrase', locale).trim().toLowerCase();
  const phraseMatches = confirmInput.trim().toLowerCase() === requiredPhrase;

  function formatDateTime(iso) {
    const d = new Date(iso);
    const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return { date, time };
  }

  async function handleConfirmDeletion() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/deletion', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || t('connexions.deleteError', locale));
        setSubmitting(false);
        return;
      }
      setScheduledFor(body.scheduled_for);
      setStatus('scheduled');
    } catch {
      setError(t('connexions.deleteError', locale));
    }
    setSubmitting(false);
  }

  async function handleCancelDeletion() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch('/api/account/deletion', { method: 'DELETE' });
      if (!res.ok) {
        setError(t('connexions.deleteError', locale));
        setCancelling(false);
        return;
      }
      setScheduledFor(null);
      setConfirmInput('');
      setStatus('intro');
    } catch {
      setError(t('connexions.deleteError', locale));
    }
    setCancelling(false);
  }

  if (status === 'loading') {
    return <p className="muted">{t('common.loading', locale)}</p>;
  }

  if (status === 'scheduled' && scheduledFor) {
    const { date, time } = formatDateTime(scheduledFor);
    return (
      <div className="delete-panel">
        <h2 className="category-title">{t('connexions.deleteScheduledTitle', locale)}</h2>
        <p className="delete-scheduled-msg">
          {t('connexions.deleteScheduledMessage', locale).replace('{date}', date).replace('{time}', time)}
        </p>
        {error && <p className="crm-error">{error}</p>}
        <button type="button" className="btn-secondary" onClick={handleCancelDeletion} disabled={cancelling}>
          {cancelling ? t('connexions.deleteCancelling', locale) : t('connexions.deleteCancelButton', locale)}
        </button>
        <style jsx>{`
          .delete-panel { max-width: 560px; }
          .delete-scheduled-msg { color: var(--muted); line-height: 1.5; margin: 0.5rem 0 1.2rem; }
        `}</style>
      </div>
    );
  }

  if (status === 'confirm') {
    return (
      <div className="delete-panel">
        <h2 className="category-title">{t('connexions.deleteTitle', locale)}</h2>
        <p className="delete-confirm-label">
          {t('connexions.deleteConfirmPhraseLabel', locale)} <strong>{t('connexions.deleteConfirmPhrase', locale)}</strong>
        </p>
        <input
          type="text"
          className="profile-input"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder={t('connexions.deleteConfirmPlaceholder', locale)}
        />
        {error && <p className="crm-error">{error}</p>}
        <div className="delete-actions">
          <button type="button" className="btn-danger" disabled={!phraseMatches} onClick={() => setStatus('final')}>
            {t('connexions.deleteContinueButton', locale)}
          </button>
          <button type="button" className="link-secondary-inline" onClick={() => { setStatus('intro'); setConfirmInput(''); }}>
            {t('connexions.deleteBackButton', locale)}
          </button>
        </div>
        <style jsx>{`
          .delete-panel { max-width: 560px; }
          .delete-confirm-label { color: var(--muted); line-height: 1.5; margin: 0.5rem 0 1rem; }
          .delete-actions { display: flex; align-items: center; gap: 1rem; margin-top: 1rem; }
          .btn-danger {
            background: #E5484D;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 0.7rem 1.4rem;
            font-weight: 600;
            cursor: pointer;
          }
          .btn-danger:disabled { opacity: 0.4; cursor: not-allowed; }
          .link-secondary-inline { background: none; border: none; color: var(--muted); text-decoration: underline; cursor: pointer; font-size: 0.85rem; }
        `}</style>
      </div>
    );
  }

  if (status === 'final') {
    return (
      <div className="delete-panel">
        <h2 className="category-title">{t('connexions.deleteFinalQuestion', locale)}</h2>
        {error && <p className="crm-error">{error}</p>}
        <div className="delete-actions">
          <button type="button" className="btn-danger" onClick={handleConfirmDeletion} disabled={submitting}>
            {submitting ? t('connexions.deleteSubmitting', locale) : t('connexions.deleteFinalYes', locale)}
          </button>
          <button type="button" className="btn-secondary" onClick={() => { setStatus('intro'); setConfirmInput(''); }} disabled={submitting}>
            {t('connexions.deleteFinalNo', locale)}
          </button>
        </div>
        <style jsx>{`
          .delete-panel { max-width: 560px; }
          .delete-actions { display: flex; align-items: center; gap: 1rem; margin-top: 1rem; }
          .btn-danger {
            background: #E5484D;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 0.7rem 1.4rem;
            font-weight: 600;
            cursor: pointer;
          }
          .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
        `}</style>
      </div>
    );
  }

  // status === 'intro'
  return (
    <div className="delete-panel">
      <h2 className="category-title">{t('connexions.deleteTitle', locale)}</h2>
      <p className="delete-intro">{t('connexions.deleteIntro', locale)}</p>
      <button type="button" className="btn-danger" onClick={() => setStatus('confirm')}>
        {t('connexions.deleteContinueButton', locale)}
      </button>
      <style jsx>{`
        .delete-panel { max-width: 560px; }
        .delete-intro { color: var(--muted); line-height: 1.55; margin: 0.5rem 0 1.2rem; }
        .btn-danger {
          background: #E5484D;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 0.7rem 1.4rem;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Tâche #139 — conversation guidée avec Aaron pour un CRM sur-mesure, sur le
// même modèle que ChatCampaignModal (app/app/campaigns/page.jsx) : le
// frontend garde l'historique complet et le renvoie à chaque tour, Aaron
// répond avec un texte + une ligne cachée <!--topic:XXX--> pendant les
// questions, puis un bloc ```custom_crm_json``` une fois le récapitulatif
// prêt (voir app/api/crm-connections/custom-chat/route.ts).
function extractCustomCrmJson(text) {
  const withoutTopic = text.replace(/<!--topic:\w+-->/, '').trim();
  const topicMatch = text.match(/<!--topic:(\w+)-->/);
  const topic = topicMatch ? topicMatch[1] : null;
  const match = withoutTopic.match(/```custom_crm_json\s*([\s\S]*?)```/);
  if (!match) return { displayText: withoutTopic, recap: null, topic };
  const displayText = withoutTopic.slice(0, match.index).trim();
  try {
    const recap = JSON.parse(match[1].trim());
    return { displayText, recap, topic: null };
  } catch {
    return { displayText, recap: null, topic };
  }
}

// Demande Alex (27/08/2026) : le résumé d'activité (business_summary,
// généré par le questionnaire de découverte) peut faire plusieurs
// paragraphes — trop long pour le <textarea rows={12}> affiché inline dans
// l'onglet "Mon entreprise". Cette modale plein écran permet de relire/
// éditer le texte en entier sans avoir à scroller dans une petite zone.
// Édite le même state (value/onChange) que le textarea inline — les deux
// vues restent donc toujours synchronisées, et "Enregistrer" ici déclenche
// exactement le même handler (onSave = handleSaveSummary du parent).
function BusinessSummaryExpandModal({ locale, value, onChange, onClose, onSave, saving, saved, onExport, exportingFormat }) {
  return (
    <div className="summary-expand-overlay" onClick={onClose}>
      <div className="summary-expand-modal" onClick={(e) => e.stopPropagation()}>
        <div className="summary-expand-header">
          <h2>{t('preferences.businessProfileExpandModalTitle', locale)}</h2>
          <button type="button" className="summary-expand-close" onClick={onClose}>✕</button>
        </div>
        <textarea
          className="summary-expand-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('preferences.businessProfilePlaceholder', locale)}
          autoFocus
        />
        <div className="summary-expand-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.close', locale)}</button>
          {onExport && (
            <>
              <button type="button" className="btn-secondary" onClick={() => onExport('word')} disabled={exportingFormat !== null}>
                {exportingFormat === 'word' ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileExportWordButton', locale)}
              </button>
              <button type="button" className="btn-secondary" onClick={() => onExport('pdf')} disabled={exportingFormat !== null}>
                {exportingFormat === 'pdf' ? t('preferences.savingEllipsis', locale) : t('preferences.businessProfileExportPdfButton', locale)}
              </button>
            </>
          )}
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? t('preferences.savingEllipsis', locale) : t('preferences.saveSummaryButton', locale)}
          </button>
          {saved && <span className="saved-msg">{t('preferences.summarySavedMsg', locale)}</span>}
        </div>
      </div>

      <style jsx>{`
        .summary-expand-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: 1.5rem;
        }
        .summary-expand-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          width: 720px;
          max-width: 100%;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
        }
        .summary-expand-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }
        .summary-expand-header h2 {
          font-family: var(--font-display);
          margin: 0;
          font-size: 1.1rem;
        }
        .summary-expand-close {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          width: 2rem;
          height: 2rem;
          cursor: pointer;
        }
        .summary-expand-textarea {
          flex: 1;
          min-height: 50vh;
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.9rem 1rem;
          color: var(--text);
          font-size: 0.9rem;
          line-height: 1.5;
          font-family: inherit;
          resize: vertical;
        }
        .summary-expand-textarea:focus {
          outline: none;
          border-color: var(--accent);
        }
        .summary-expand-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 1rem;
          /* flex-wrap : 2 boutons d'export ajoutés à cette rangée (27/08/2026)
             en plus de Fermer/Enregistrer — sur mobile (modale à max-width:
             100%), 4 boutons sans wrap déborderaient (même bug déjà corrigé
             ailleurs, voir app/globals.css). */
          flex-wrap: wrap;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-weight: 600;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-secondary {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .saved-msg {
          color: var(--accent-green);
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}

function CrmCustomChatModal({ userId, onClose, onSent }) {
  const [locale] = useLocale();
  const [messages, setMessages] = useState([
    { role: 'assistant', content: t('connexions.crmChatWelcome', locale) },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendMessage(text) {
    if (!text.trim() || sending) return;
    const history = messages;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setSending(true);
    setError(null);

    const res = await fetch('/api/crm-connections/custom-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, message: text, history }),
    });
    const body = await res.json();
    setSending(false);

    if (!res.ok) {
      setError(body.error || t('campaigns.chatErrorRetry', locale));
      return;
    }

    const { displayText, recap: newRecap } = extractCustomCrmJson(body.reply);
    setMessages((prev) => [...prev, { role: 'assistant', content: displayText }]);
    setRecap(newRecap);
  }

  function handleSend(e) {
    e.preventDefault();
    sendMessage(input);
  }

  async function handleSubmit() {
    if (!recap) return;
    setSubmitting(true);
    await onSent(recap);
    setSubmitting(false);
  }

  return (
    <div className="crm-chat-overlay" onClick={onClose}>
      <div className="crm-chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crm-chat-header">
          <h2>{t('connexions.crmChatModalTitle', locale)}</h2>
          <button type="button" className="crm-chat-close" onClick={onClose}>✕</button>
        </div>

        <div className="crm-chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`crm-chat-bubble ${m.role}`}>
              {m.content.split('\n').map((line, j) => <p key={j}>{line}</p>)}
            </div>
          ))}
          {sending && <div className="crm-chat-bubble assistant"><p className="crm-chat-typing">{t('campaigns.aaronThinking', locale)}</p></div>}
        </div>

        {recap && (
          <div className="crm-chat-recap">
            <p className="crm-chat-recap-title">{t('connexions.crmChatRecapTitle', locale)}</p>
            <p><strong>{t('connexions.crmChatRecapCrm', locale)}</strong> {recap.crm_name || '—'}</p>
            <p><strong>{t('connexions.crmChatRecapData', locale)}</strong> {Array.isArray(recap.data_to_sync) ? recap.data_to_sync.join(', ') : '—'}</p>
            <p><strong>{t('connexions.crmChatRecapAuth', locale)}</strong> {recap.auth_method || '—'}</p>
            {recap.notes && <p><strong>{t('connexions.crmChatRecapNotes', locale)}</strong> {recap.notes}</p>}
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('connexions.addOtherCrmSending', locale) : t('connexions.addOtherCrmButton', locale)}
            </button>
          </div>
        )}

        {error && <p className="crm-chat-error">{error}</p>}

        <form className="crm-chat-input-row" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('campaigns.chatInputPlaceholder', locale)}
            disabled={sending}
          />
          <button type="submit" className="btn-secondary" disabled={sending || !input.trim()}>{t('campaigns.send', locale)}</button>
        </form>
      </div>

      <style jsx>{`
        .crm-chat-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .crm-chat-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
          width: 560px;
          max-width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }
        .crm-chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.8rem;
        }
        .crm-chat-header h2 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0;
        }
        .crm-chat-close {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .crm-chat-messages {
          overflow-y: auto;
          flex: 1;
          min-height: 200px;
          max-height: 40vh;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          margin-bottom: 0.8rem;
        }
        .crm-chat-bubble {
          border-radius: var(--radius-md);
          padding: 0.6rem 0.85rem;
          font-size: 0.86rem;
          line-height: 1.45;
          max-width: 88%;
          overflow-wrap: break-word;
        }
        .crm-chat-bubble p {
          margin: 0;
        }
        .crm-chat-bubble p + p {
          margin-top: 0.4rem;
        }
        .crm-chat-bubble.assistant {
          background: var(--bg);
          border: 1px solid var(--border);
          align-self: flex-start;
        }
        .crm-chat-bubble.user {
          background: rgba(75, 57, 239, 0.18);
          align-self: flex-end;
        }
        .crm-chat-typing {
          color: var(--muted);
          font-style: italic;
        }
        .crm-chat-recap {
          background: var(--bg);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
          margin-bottom: 0.8rem;
          font-size: 0.84rem;
        }
        .crm-chat-recap-title {
          font-weight: 600;
          margin: 0 0 0.5rem;
          font-size: 0.76rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--accent);
        }
        .crm-chat-recap p {
          margin: 0.25rem 0;
          color: var(--text);
        }
        .crm-chat-error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.6rem;
        }
        .crm-chat-input-row {
          display: flex;
          gap: 0.5rem;
        }
        .crm-chat-input-row input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.88rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .crm-chat-input-row .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .crm-chat-input-row .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function CrmConnectionCard({ provider, title, desc, connected, canManage, onConnect, onDisconnect, onSync, syncing, syncResult, error, onCardClick }) {
  const [locale] = useLocale();
  return (
    <div
      className={onCardClick ? 'card card-clickable' : 'card'}
      onClick={onCardClick || undefined}
    >
      <div className="card-head">
        <h3>{title}</h3>
        <span className={`status-dot ${connected ? 'on' : 'off'}`} />
      </div>
      <p className="desc">{desc}</p>
      {error && <p className="crm-error">{error}</p>}
      {!canManage ? (
        <p className="crm-hint">{t('connexions.crmManagerOnlyHint', locale)}</p>
      ) : connected ? (
        <>
          <p className="account">{t('preferences.crm.connectedMsgTemplate', locale).replace('{provider}', title)}</p>
          <div className="card-actions">
            <button type="button" className="btn-secondary" onClick={onSync} disabled={syncing}>
              {syncing ? t('preferences.crm.syncingEllipsis', locale) : t('preferences.crm.syncNowButton', locale)}
            </button>
            <button type="button" className="btn-danger" onClick={onDisconnect}>{t('connexions.disconnectButton', locale)}</button>
          </div>
          {syncResult && (
            <p className="crm-hint">
              {t('preferences.crm.syncResultSyncedTemplate', locale).replace('{count}', syncResult.synced).replace('{provider}', title)}
              {syncResult.failed?.length > 0 && t('preferences.crm.syncResultFailed', locale).replace('{count}', syncResult.failed.length)}
              {syncResult.remaining_candidates && t('preferences.crm.syncResultRemaining', locale)}
            </p>
          )}
        </>
      ) : (
        <>
          <button type="button" className="btn-primary" onClick={onConnect}>{t('preferences.crm.connectButtonTemplate', locale).replace('{provider}', title)}</button>
          <p className="crm-hint">{t('preferences.crm.connectHintTemplate', locale).replace('{provider}', title)}</p>
        </>
      )}
      <style jsx>{`
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          cursor: pointer;
        }
        .card-clickable {
          cursor: pointer;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .card-head h3 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.1rem;
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
        }
        .status-dot.on {
          background: var(--accent-green);
        }
        .status-dot.off {
          background: var(--muted);
        }
        .desc {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0 0 1rem;
        }
        .account {
          font-size: 0.86rem;
          margin: 0 0 0.7rem;
        }
        .card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .crm-hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0.7rem 0 0;
        }
        .crm-error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.7rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Suite 15 — carte de connexion pour les CRM sans OAuth centralisé (clé API
// statique collée par le patron), à commencer par Axonaut. Reprend la même
// structure visuelle que CrmConnectionCard (statut/desc/actions) mais
// remplace le bouton "Connecter" (redirection externe) par un petit
// formulaire clé API + bouton de validation.
function ApiKeyCrmConnectionCard({
  provider,
  title,
  desc,
  connected,
  canManage,
  apiKeyInput,
  onApiKeyInputChange,
  onConnect,
  connecting,
  onDisconnect,
  onSync,
  syncing,
  syncResult,
  error,
}) {
  const [locale] = useLocale();
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className={`status-dot ${connected ? 'on' : 'off'}`} />
      </div>
      <p className="desc">{desc}</p>
      {error && <p className="crm-error">{error}</p>}
      {!canManage ? (
        <p className="crm-hint">{t('connexions.crmManagerOnlyHint', locale)}</p>
      ) : connected ? (
        <>
          <p className="account">{t('preferences.crm.connectedMsgTemplate', locale).replace('{provider}', title)}</p>
          <div className="card-actions">
            <button type="button" className="btn-secondary" onClick={onSync} disabled={syncing}>
              {syncing ? t('preferences.crm.syncingEllipsis', locale) : t('preferences.crm.syncNowButton', locale)}
            </button>
            <button type="button" className="btn-danger" onClick={onDisconnect}>{t('connexions.disconnectButton', locale)}</button>
          </div>
          {syncResult && (
            <p className="crm-hint">
              {t('preferences.crm.syncResultSyncedTemplate', locale).replace('{count}', syncResult.synced).replace('{provider}', title)}
              {syncResult.failed?.length > 0 && t('preferences.crm.syncResultFailed', locale).replace('{count}', syncResult.failed.length)}
              {syncResult.remaining_candidates && t('preferences.crm.syncResultRemaining', locale)}
            </p>
          )}
        </>
      ) : (
        <>
          <label className="api-key-label">{t(`connexions.${provider}ApiKeyLabel`, locale)}</label>
          <input
            type="password"
            className="api-key-input"
            value={apiKeyInput}
            onChange={(e) => onApiKeyInputChange(e.target.value)}
            placeholder={t(`connexions.${provider}ApiKeyPlaceholder`, locale)}
          />
          <button type="button" className="btn-primary" onClick={onConnect} disabled={connecting || !apiKeyInput.trim()}>
            {connecting
              ? t('preferences.crm.syncingEllipsis', locale)
              : t('preferences.crm.connectButtonTemplate', locale).replace('{provider}', title)}
          </button>
          <p className="crm-hint">{t(`connexions.${provider}ApiKeyHint`, locale)}</p>
        </>
      )}
      <style jsx>{`
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          cursor: pointer;
        }
        .card-clickable {
          cursor: pointer;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .card-head h3 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.1rem;
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
        }
        .status-dot.on {
          background: var(--accent-green);
        }
        .status-dot.off {
          background: var(--muted);
        }
        .desc {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0 0 1rem;
        }
        .account {
          font-size: 0.86rem;
          margin: 0 0 0.7rem;
        }
        .card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .api-key-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 0.35rem;
        }
        .api-key-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.84rem;
          margin-bottom: 0.7rem;
          font-family: inherit;
        }
        .crm-hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0.7rem 0 0;
        }
        .crm-error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.7rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Suite 15 (Sellsy) — même patron visuel que ApiKeyCrmConnectionCard, mais
// deux champs (client_id + client_secret, voir TWO_FIELD_CRM_PROVIDERS plus
// haut) au lieu d'une clé API unique. Clés i18n génériques
// (connexions.twoFieldCrm*) plutôt que par provider, contrairement à
// ApiKeyCrmConnectionCard : à ce jour Sellsy est le seul CRM de ce type, pas
// besoin de libellés distincts par provider tant qu'un deuxième n'apparaît
// pas dans ce groupe.
function TwoFieldCrmConnectionCard({
  provider,
  title,
  desc,
  connected,
  canManage,
  fieldOneInput,
  onFieldOneInputChange,
  fieldTwoInput,
  onFieldTwoInputChange,
  onConnect,
  connecting,
  onDisconnect,
  onSync,
  syncing,
  syncResult,
  error,
}) {
  const [locale] = useLocale();
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className={`status-dot ${connected ? 'on' : 'off'}`} />
      </div>
      <p className="desc">{desc}</p>
      {error && <p className="crm-error">{error}</p>}
      {!canManage ? (
        <p className="crm-hint">{t('connexions.crmManagerOnlyHint', locale)}</p>
      ) : connected ? (
        <>
          <p className="account">{t('preferences.crm.connectedMsgTemplate', locale).replace('{provider}', title)}</p>
          <div className="card-actions">
            <button type="button" className="btn-secondary" onClick={onSync} disabled={syncing}>
              {syncing ? t('preferences.crm.syncingEllipsis', locale) : t('preferences.crm.syncNowButton', locale)}
            </button>
            <button type="button" className="btn-danger" onClick={onDisconnect}>{t('connexions.disconnectButton', locale)}</button>
          </div>
          {syncResult && (
            <p className="crm-hint">
              {t('preferences.crm.syncResultSyncedTemplate', locale).replace('{count}', syncResult.synced).replace('{provider}', title)}
              {syncResult.failed?.length > 0 && t('preferences.crm.syncResultFailed', locale).replace('{count}', syncResult.failed.length)}
              {syncResult.remaining_candidates && t('preferences.crm.syncResultRemaining', locale)}
            </p>
          )}
        </>
      ) : (
        <>
          <label className="api-key-label">{t(`connexions.${provider}ClientIdLabel`, locale)}</label>
          <input
            type="text"
            className="api-key-input"
            value={fieldOneInput}
            onChange={(e) => onFieldOneInputChange(e.target.value)}
            placeholder={t(`connexions.${provider}ClientIdPlaceholder`, locale)}
          />
          <label className="api-key-label">{t(`connexions.${provider}ClientSecretLabel`, locale)}</label>
          <input
            type="password"
            className="api-key-input"
            value={fieldTwoInput}
            onChange={(e) => onFieldTwoInputChange(e.target.value)}
            placeholder={t(`connexions.${provider}ClientSecretPlaceholder`, locale)}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={onConnect}
            disabled={connecting || !fieldOneInput.trim() || !fieldTwoInput.trim()}
          >
            {connecting
              ? t('preferences.crm.syncingEllipsis', locale)
              : t('preferences.crm.connectButtonTemplate', locale).replace('{provider}', title)}
          </button>
          <p className="crm-hint">{t(`connexions.${provider}Hint`, locale)}</p>
        </>
      )}
      <style jsx>{`
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          cursor: pointer;
        }
        .card-clickable {
          cursor: pointer;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .card-head h3 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.1rem;
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
        }
        .status-dot.on {
          background: var(--accent-green);
        }
        .status-dot.off {
          background: var(--muted);
        }
        .desc {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0 0 1rem;
        }
        .account {
          font-size: 0.86rem;
          margin: 0 0 0.7rem;
        }
        .card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .api-key-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 0.35rem;
        }
        .api-key-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          font-size: 0.84rem;
          margin-bottom: 0.7rem;
          font-family: inherit;
        }
        .crm-hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0.7rem 0 0;
        }
        .crm-error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.7rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function ConnectionCard({ title, desc, connection, health, missingLabelScope, onConnect, onDisconnect }) {
  const [locale] = useLocale();
  const isConnected = !!connection;
  // Enregistrements DNS prêts à copier-coller (demande Alex, 27/08/2026,
  // suite à un domaine pro sans DMARC repéré manuellement) — remplace le
  // simple texte "va corriger ça dans ton DNS" par la valeur exacte à
  // coller, calculée côté API (voir app/api/email-health/route.ts et
  // lib/email-deliverability.ts).
  const [copiedField, setCopiedField] = useState(null);
  function copyRecord(value, field) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
    });
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className={`status-dot ${isConnected ? 'on' : 'off'}`} />
      </div>
      <p className="desc">{desc}</p>
      {isConnected ? (
        <>
          <p className="account">{connection.provider_account_email}</p>
          {missingLabelScope && (
            <div className="health">
              <p className="health-title">🤖 {t('connexions.labelScopeTitle', locale)}</p>
              <p className="health-hint">{t('connexions.labelScopeHint', locale)}</p>
              <button type="button" className="btn-secondary" onClick={onConnect}>
                {t('connexions.labelScopeReconnectButton', locale)}
              </button>
            </div>
          )}
          {health && !health.consumer_domain && health.health && (
            <div className="health">
              <p className="health-title">{t('connexions.domainHealthPrefix', locale)} {health.domain}</p>
              <div className="health-badges">
                <span className={`badge ${health.health.spf.found ? 'ok' : 'warn'}`}>
                  {health.health.spf.found ? '✓' : '⚠️'} SPF
                </span>
                <span className={`badge ${health.health.dmarc.found ? 'ok' : 'warn'}`}>
                  {health.health.dmarc.found ? '✓' : '⚠️'} DMARC
                </span>
                <span className="badge info" title={t('connexions.dkimTooltip', locale)}>
                  {t('connexions.dkimBadge', locale)}
                </span>
              </div>
              {(!health.health.spf.found || !health.health.dmarc.found) && (
                <>
                  <p className="health-hint">
                    {t('connexions.healthHintPrefix', locale)} {health.domain} {t('connexions.healthHintSuffix', locale)}
                  </p>
                  {health.suggested?.spf && (
                    <div className="record-row">
                      <span className="record-label">SPF — {t('connexions.recordHost', locale)}: @</span>
                      <div className="record-value-row">
                        <code className="record-value">{health.suggested.spf}</code>
                        <button type="button" className="btn-copy" onClick={() => copyRecord(health.suggested.spf, 'spf')}>
                          {copiedField === 'spf' ? t('team.copied', locale) : t('team.copy', locale)}
                        </button>
                      </div>
                    </div>
                  )}
                  {health.suggested?.dmarc && (
                    <div className="record-row">
                      <span className="record-label">DMARC — {t('connexions.recordHost', locale)}: _dmarc</span>
                      <div className="record-value-row">
                        <code className="record-value">{health.suggested.dmarc}</code>
                        <button type="button" className="btn-copy" onClick={() => copyRecord(health.suggested.dmarc, 'dmarc')}>
                          {copiedField === 'dmarc' ? t('team.copied', locale) : t('team.copy', locale)}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <button className="btn-danger" onClick={onDisconnect}>{t('connexions.disconnectButton', locale)}</button>
        </>
      ) : (
        <button className="btn-primary" onClick={onConnect}>{t('connexions.connectButtonPrefix', locale)} {title}</button>
      )}
      <style jsx>{`
        .health {
          background: rgba(75, 57, 239, 0.08);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.8rem;
          margin: 0 0 1rem;
        }
        .health-title {
          margin: 0 0 0.5rem;
          font-size: 0.76rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .health-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .badge {
          font-size: 0.78rem;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          white-space: nowrap;
          overflow-wrap: break-word;
        }
        .badge.ok {
          background: rgba(61, 214, 140, 0.15);
          color: var(--accent-green);
        }
        .badge.warn {
          background: rgba(229, 72, 77, 0.15);
          color: var(--accent-red);
        }
        .badge.info {
          background: rgba(139, 144, 168, 0.15);
          color: var(--muted);
          cursor: help;
        }
        .health-hint {
          margin: 0.5rem 0 0;
          font-size: 0.76rem;
          color: var(--muted);
          overflow-wrap: break-word;
        }
        .record-row {
          margin-top: 0.6rem;
        }
        .record-label {
          display: block;
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--muted);
          margin-bottom: 0.25rem;
        }
        .record-value-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .record-value {
          flex: 1;
          min-width: 0;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.6rem;
          font-size: 0.74rem;
          word-break: break-all;
        }
        .btn-copy {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.7rem;
          font-size: 0.74rem;
          cursor: pointer;
          white-space: nowrap;
        }
      `}</style>
      <style jsx>{`
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.3rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          cursor: pointer;
        }
        .card-clickable {
          cursor: pointer;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .card-head h3 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.1rem;
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
        }
        .status-dot.on {
          background: var(--accent-green);
        }
        .status-dot.off {
          background: var(--muted);
        }
        .desc {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0 0 1rem;
        }
        .account {
          font-size: 0.86rem;
          margin: 0 0 1rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .health {
          border-color: rgba(229, 72, 77, 0.35);
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: 4rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
        }
        .empty-title {
          font-weight: 600;
          margin: 0 0 0.35rem;
        }
        .empty-body {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
        setUserRole(prefs.role || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
    { label: t('nav.suggestions', locale), slug: 'suggestions', icon: '💡' },
  ];
  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label={t('shell.openMenu', locale)}
        onClick={() => setMobileOpen(true)}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' && item.slug !== 'suggestions') || userRole === 'patron').map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            {t('shell.connected', locale)}
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            {t('common.logout', locale)}
          </button>
        </div>
      </nav>
      <main className="content">{children}</main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          min-width: 0;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mobile-menu-btn {
          display: none;
        }
        .sidebar-overlay {
          display: none;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .mobile-menu-btn {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 60;
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
          }
          .mobile-menu-btn .bar {
            display: block;
            width: 18px;
            height: 2px;
            margin: 0 auto;
            background: var(--text);
            border-radius: 1px;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
            z-index: 65;
          }
          .content {
            padding: 1.5rem;
            padding-top: 4.5rem;
          }
        }
      `}</style>
    </div>
  );
}
