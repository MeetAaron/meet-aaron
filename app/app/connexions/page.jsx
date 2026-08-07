// app/app/connexions/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

function useCurrentUserId() {
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setUserId(params.get('user_id'));
  }, []);
  return userId;
}

const PROVIDER_META = {
  google: { name: 'Google', desc: 'Gmail (envoi/lecture) + Google Calendar' },
  microsoft: { name: 'Microsoft', desc: 'Outlook Calendar' },
};

export default function ConnexionsPage() {
  const userId = useCurrentUserId();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/oauth-connections?user_id=${userId}`).then((r) => r.json());
    setConnections(res.connections || []);
    setLoading(false);
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
    if (!confirm('Déconnecter ce compte ? Aaron ne pourra plus envoyer/lire les emails ou gérer le calendrier associé.')) return;
    await fetch(`/api/oauth-connections?connection_id=${connectionId}`, { method: 'DELETE' });
    load();
  }

  if (!userId) {
    return (
      <Shell active="Connexions" userId={userId}>
        <EmptyState title="Aucun identifiant commercial" body="Ouvrez cette page avec ?user_id=... dans l'URL." />
      </Shell>
    );
  }

  const googleConnection = connections.find((c) => c.provider === 'google');
  const microsoftConnection = connections.find((c) => c.provider === 'microsoft');

  return (
    <Shell active="Connexions" userId={userId}>
      <header className="header">
        <p className="eyebrow">Comptes liés</p>
        <h1>Connexions</h1>
        <p className="subtitle">Aaron a besoin de ces accès pour envoyer des emails et gérer votre calendrier en votre nom.</p>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div className="cards">
          <ConnectionCard
            title={PROVIDER_META.google.name}
            desc={PROVIDER_META.google.desc}
            connection={googleConnection}
            onConnect={() => (window.location.href = `/api/auth/google?user_id=${userId}`)}
            onDisconnect={() => handleDisconnect(googleConnection.id)}
          />
          <ConnectionCard
            title={PROVIDER_META.microsoft.name}
            desc={PROVIDER_META.microsoft.desc}
            connection={microsoftConnection}
            onConnect={() => (window.location.href = `/api/auth/microsoft?user_id=${userId}`)}
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

function ConnectionCard({ title, desc, connection, onConnect, onDisconnect }) {
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
          <button className="btn-danger" onClick={onDisconnect}>Déconnecter</button>
        </>
      ) : (
        <button className="btn-primary" onClick={onConnect}>Connecter {title}</button>
      )}
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
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard' },
    { label: 'Prospects', slug: 'prospects' },
    { label: 'Campagnes', slug: 'campaigns' },
    { label: 'Agenda', slug: 'agenda' },
    { label: 'Résultats', slug: 'resultats' },
    { label: 'Clients gagnés', slug: 'clients-gagnes' },
    { label: 'Mes documents', slug: 'documents' },
    { label: 'Chat avec Aaron', slug: 'chat' },
    { label: 'Connexions', slug: 'connexions' },
    { label: 'Préférences', slug: 'preferences' },
  ];
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link key={item.label} href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`} className="nav-link">
              <li className={item.label === active ? 'active' : ''}>{item.label}</li>
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
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .content {
          padding: 2.5rem 3rem;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .sidebar {
            display: none;
          }
          .content {
            padding: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}
