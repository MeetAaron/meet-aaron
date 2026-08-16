// app/app/connexions/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

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
        setAuthError(body.error || 'Accès refusé');
        setAuthLoading(false);
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
  const [connections, setConnections] = useState([]);
  const [emailHealth, setEmailHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  // CHANGEMENTS A FAIRE #90 (2026-08-16) : nouvelle catégorie "CRMs et bases de
  // données" — la connexion HubSpot (connecter/déconnecter/synchroniser),
  // auparavant dans Préférences, vit maintenant ici avec les autres connexions
  // de comptes tiers. Le choix du fournisseur CRM et le niveau de collaboration
  // restent dans Préférences (voir item #30).
  const [crmProvider, setCrmProvider] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [crmConnections, setCrmConnections] = useState([]);
  const [crmSyncing, setCrmSyncing] = useState(false);
  const [crmSyncResult, setCrmSyncResult] = useState(null);
  const [crmError, setCrmError] = useState(null);

  // Suite 15 — état propre au formulaire de connexion par clé API (Axonaut et,
  // à terme, les autres CRM sans OAuth centralisé traités selon le même
  // patron). crmError/crmSyncResult/crmSyncing ci-dessus restent partagés une
  // fois la connexion établie (déconnexion/synchro identiques à HubSpot & co).
  const [axonautApiKeyInput, setAxonautApiKeyInput] = useState('');
  const [axonautConnecting, setAxonautConnecting] = useState(false);

  // Suite 15 — Sellsy (client_id + client_secret, voir TWO_FIELD_CRM_PROVIDERS
  // plus haut).
  const [sellsyClientIdInput, setSellsyClientIdInput] = useState('');
  const [sellsyClientSecretInput, setSellsyClientSecretInput] = useState('');
  const [sellsyConnecting, setSellsyConnecting] = useState(false);

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

  useEffect(() => {
    if (!userId) return;
    load();
    loadCrmConnections();
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setCrmProvider(res.preferences?.crm_provider || null);
        setUserRole(res.preferences?.role || null);
      })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const crmOauthError = params.get('crm_oauth_error');
    if (crmOauthError) setCrmError(t('preferences.crm.oauthErrorTemplate', locale).replace('{error}', crmOauthError));
    if (params.get('oauth_success') || params.get('oauth_error') || crmOauthError || params.get('crm_oauth_success')) {
      window.history.replaceState({}, '', window.location.pathname + '?user_id=' + userId);
    }
  }, [userId]);

  async function handleDisconnect(connectionId) {
    if (!confirm(t('connexions.disconnectConfirm', locale))) return;
    await fetch(`/api/oauth-connections?connection_id=${connectionId}&user_id=${userId}`, { method: 'DELETE' });
    load();
  }

  // Même schéma que connectProvider ci-dessous (navigation complète, pas
  // fetch) — /api/auth/<provider> déclenche une redirection OAuth externe.
  // CHANGEMENTS A FAIRE (2026-08-16) : généralisé de handleConnectHubspot à
  // handleConnectCrm(provider) pour supporter aussi Salesforce et Pipedrive
  // (même flux OAuth, seule l'URL de démarrage change).
  async function handleConnectCrm(provider) {
    setCrmError(null);
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

  // Suite 15 — Axonaut n'a pas de flux OAuth (voir API_KEY_CRM_PROVIDERS plus
  // haut) : contrairement à handleConnectCrm ci-dessus (redirection externe),
  // ici on POST directement la clé collée par le patron. AuthFetchInterceptor
  // (components/AuthFetchInterceptor.jsx, monté globalement dans app/layout.jsx)
  // ajoute automatiquement le token d'auth à ce fetch(), comme pour tous les
  // autres appels /api/* de cette page.
  async function handleConnectAxonaut(provider) {
    if (!axonautApiKeyInput.trim()) return;
    setAxonautConnecting(true);
    setCrmError(null);
    try {
      const res = await fetch(`/api/crm-connections/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: axonautApiKeyInput.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError(body.error || t('common.error', locale));
        return;
      }
      setAxonautApiKeyInput('');
      loadCrmConnections();
    } catch (err) {
      setCrmError(t('common.error', locale));
    } finally {
      setAxonautConnecting(false);
    }
  }

  // Suite 15 — même principe que handleConnectAxonaut, mais deux valeurs.
  async function handleConnectSellsy(provider) {
    if (!sellsyClientIdInput.trim() || !sellsyClientSecretInput.trim()) return;
    setSellsyConnecting(true);
    setCrmError(null);
    try {
      const res = await fetch(`/api/crm-connections/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: sellsyClientIdInput.trim(),
          client_secret: sellsyClientSecretInput.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError(body.error || t('common.error', locale));
        return;
      }
      setSellsyClientIdInput('');
      setSellsyClientSecretInput('');
      loadCrmConnections();
    } catch (err) {
      setCrmError(t('common.error', locale));
    } finally {
      setSellsyConnecting(false);
    }
  }

  async function handleSyncCrm(provider) {
    setCrmSyncing(true);
    setCrmSyncResult(null);
    setCrmError(null);
    try {
      const res = await fetch('/api/crm-connections/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCrmError(body.error || t('common.error', locale));
        return;
      }
      setCrmSyncResult(body);
    } catch (err) {
      setCrmError(t('common.error', locale));
    } finally {
      setCrmSyncing(false);
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

  return (
    <Shell active={t('nav.connections', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('connexions.eyebrow', locale)}</p>
        <h1>{t('nav.connections', locale)}</h1>
        <p className="subtitle">{t('connexions.subtitle', locale)}</p>
      </header>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
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

          <h2 className="category-title">{t('connexions.crmCategoryTitle', locale)}</h2>
          <div className="cards">
            {DIRECT_CRM_PROVIDERS.includes(crmProvider) ? (
              <CrmConnectionCard
                provider={crmProvider}
                title={CRM_META[crmProvider].name}
                desc={CRM_META[crmProvider].desc}
                connected={crmConnections.some((c) => c.provider === crmProvider)}
                canManage={userRole === 'patron'}
                onConnect={() => handleConnectCrm(crmProvider)}
                onDisconnect={() => handleDisconnectCrm(crmProvider)}
                onSync={() => handleSyncCrm(crmProvider)}
                syncing={crmSyncing}
                syncResult={crmSyncResult}
                error={crmError}
              />
            ) : API_KEY_CRM_PROVIDERS.includes(crmProvider) ? (
              <ApiKeyCrmConnectionCard
                provider={crmProvider}
                title={CRM_META[crmProvider].name}
                desc={CRM_META[crmProvider].desc}
                connected={crmConnections.some((c) => c.provider === crmProvider)}
                canManage={userRole === 'patron'}
                apiKeyInput={axonautApiKeyInput}
                onApiKeyInputChange={setAxonautApiKeyInput}
                onConnect={() => handleConnectAxonaut(crmProvider)}
                connecting={axonautConnecting}
                onDisconnect={() => handleDisconnectCrm(crmProvider)}
                onSync={() => handleSyncCrm(crmProvider)}
                syncing={crmSyncing}
                syncResult={crmSyncResult}
                error={crmError}
              />
            ) : TWO_FIELD_CRM_PROVIDERS.includes(crmProvider) ? (
              <TwoFieldCrmConnectionCard
                provider={crmProvider}
                title={CRM_META[crmProvider].name}
                desc={CRM_META[crmProvider].desc}
                connected={crmConnections.some((c) => c.provider === crmProvider)}
                canManage={userRole === 'patron'}
                fieldOneInput={sellsyClientIdInput}
                onFieldOneInputChange={setSellsyClientIdInput}
                fieldTwoInput={sellsyClientSecretInput}
                onFieldTwoInputChange={setSellsyClientSecretInput}
                onConnect={() => handleConnectSellsy(crmProvider)}
                connecting={sellsyConnecting}
                onDisconnect={() => handleDisconnectCrm(crmProvider)}
                onSync={() => handleSyncCrm(crmProvider)}
                syncing={crmSyncing}
                syncResult={crmSyncResult}
                error={crmError}
              />
            ) : (
              <EmptyState
                title={t('connexions.noCrmSelectedTitle', locale)}
                body={t('connexions.noCrmSelectedBody', locale)}
              />
            )}
          </div>
        </>
      )}

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

function CrmConnectionCard({ provider, title, desc, connected, canManage, onConnect, onDisconnect, onSync, syncing, syncResult, error }) {
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

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
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
        aria-label="Ouvrir le menu"
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
          onChange={(e) => setLocale(e.target.value)}
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
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel">🔒</span>}</li>
            </Link>
          ))}
        </ul>
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
