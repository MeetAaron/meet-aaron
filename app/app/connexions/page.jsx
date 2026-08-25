// app/app/connexions/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import { getStoredTheme, applyTheme } from '@/lib/theme';

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

  return (
    <Shell active={t('nav.connections', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('connexions.eyebrow', locale)}</p>
        <h1>{t('nav.connections', locale)}</h1>
        <p className="subtitle">{t('connexions.subtitle', locale)}</p>
      </header>

      {/* docx C1/A2/A3 (2026-08-20) : "Mon compte" en 3 rubriques — mon
          profil / connexion / crm — au lieu d'un seul flux de connexions. */}
      <div className="tabs">
        <button type="button" className={activeTab === 'profile' ? 'tab active' : 'tab'} onClick={() => setActiveTab('profile')}>
          {t('connexions.tabProfile', locale)}
        </button>
        <button type="button" className={activeTab === 'connection' ? 'tab active' : 'tab'} onClick={() => setActiveTab('connection')}>
          {t('connexions.tabConnection', locale)}
        </button>
        <button type="button" className={activeTab === 'crm' ? 'tab active' : 'tab'} onClick={() => setActiveTab('crm')}>
          {t('connexions.tabCrm', locale)}
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

          <label className="profile-label theme-label">{t('connexions.themeLabel', locale)}</label>
          <div className="theme-toggle">
            <button
              type="button"
              className={theme === 'dark' ? 'theme-btn active' : 'theme-btn'}
              onClick={() => changeTheme('dark')}
            >
              {t('connexions.themeDark', locale)}
            </button>
            <button
              type="button"
              className={theme === 'light' ? 'theme-btn active' : 'theme-btn'}
              onClick={() => changeTheme('light')}
            >
              {t('connexions.themeLight', locale)}
            </button>
          </div>
        </div>
      ) : activeTab === 'connection' ? (
        <div className="cards">
          <ConnectionCard
            title={PROVIDER_META.google.name}
            desc={PROVIDER_META.google.desc}
            connection={googleConnection}
            health={emailHealth.find((h) => h.provider === 'google')}
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
      ) : (
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
      )}

      <style jsx>{`
        .tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.6rem;
          border-bottom: 1px solid var(--border);
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

function ConnectionCard({ title, desc, connection, health, onConnect, onDisconnect }) {
  const [locale] = useLocale();
  const isConnected = !!connection;
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
                <p className="health-hint">
                  {t('connexions.healthHintPrefix', locale)} {health.domain} {t('connexions.healthHintSuffix', locale)}
                </p>
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
    { label: t('nav.preferences', locale), slug: 'preferences', icon: '⚙️' },
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
          {NAV_ITEMS.map((item) => (
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
