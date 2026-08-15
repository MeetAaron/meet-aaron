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

export default function ConnexionsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const PROVIDER_META = providerMetaFor(locale);
  const [connections, setConnections] = useState([]);
  const [emailHealth, setEmailHealth] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!userId) return;
    load();

    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_success') || params.get('oauth_error')) {
      window.history.replaceState({}, '', window.location.pathname + window.location.search.split('&')[0]);
    }
  }, [userId]);

  async function handleDisconnect(connectionId) {
    if (!confirm(t('connexions.disconnectConfirm', locale))) return;
    await fetch(`/api/oauth-connections?connection_id=${connectionId}&user_id=${userId}`, { method: 'DELETE' });
    load();
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
            background: #0b0e1a;
            color: #8b90a8;
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
            background: #0b0e1a;
            color: #e5484d;
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
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
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
          border-radius: 10px;
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
          color: #e5484d;
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
          border-radius: 14px;
          padding: 1.3rem;
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
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid #e5484d;
          color: #e5484d;
          border-radius: 8px;
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
          border-radius: 14px;
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
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // Un module (Aaron Opportunité / Aaron Client) est grisé dans la navigation tant
  // que l'offre souscrite par la société (companies.offer, voir Préférences)
  // ne correspond pas à ce module. Aaron Prospect (Campagnes/Prospects) reste
  // toujours accessible : c'est l'offre de base incluse à la souscription.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offer = body.preferences?.offer || 'AP';
        setLockedModules({ sales: offer !== 'AS', customer: offer !== 'AC' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.pipeline', locale), slug: 'pipeline', icon: '🧭' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯' },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀' },
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
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0b0e1a;
          --surface: #131629;
          --border: #232744;
          --accent: #4b39ef;
          --accent-green: #3dd68c;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 240px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 1.5rem 1.2rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: var(--font-display);
          font-weight: 600;
          margin-bottom: 2rem;
        }
        .brand-mark {
          width: 30px;
          height: 30px;
          border-radius: 8px;
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.4rem 0.5rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.2rem;
          cursor: pointer;
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          padding: 0.6rem 0.7rem;
          border-radius: 8px;
          font-size: 0.88rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .nav-icon {
          font-size: 0.95rem;
          width: 1.1em;
          text-align: center;
          flex-shrink: 0;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.locked {
          opacity: 0.45;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
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
            width: 38px;
            height: 38px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            padding: 0;
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
            width: 240px;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
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
