// app/app/clients-gagnes/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

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

function exportToCsv(clients) {
  const headers = ['Nom', 'Société', 'Email', 'Téléphone', 'Client depuis'];
  const rows = clients.map((c) => [
    c.full_name,
    c.prospect_companies?.name || '',
    c.email,
    c.phone || '',
    c.won_at ? new Date(c.won_at).toLocaleDateString('fr-FR') : '',
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `clients-gagnes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function WonClientsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/won-clients?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setClients(res.wonClients || []);
        setLoading(false);
      });
  }, [userId]);

  async function handleEmailExport() {
    setEmailing(true);
    await fetch('/api/won-clients/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    setEmailing(false);
    setShowExportMenu(false);
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif;
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
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active="Clients gagnés" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Succès</p>
          <h1>Clients gagnés grâce à Aaron</h1>
        </div>
        {clients.length > 0 && (
          <div className="export-wrap">
            <button className="btn-export" onClick={() => setShowExportMenu(!showExportMenu)}>
              Extraire ▾
            </button>
            {showExportMenu && (
              <div className="export-menu">
                <button onClick={() => { exportToCsv(clients); setShowExportMenu(false); }}>
                  Télécharger en CSV
                </button>
                <button onClick={handleEmailExport} disabled={emailing}>
                  {emailing ? 'Envoi…' : 'Recevoir par email'}
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {emailSent && <p className="email-sent">Le fichier a été envoyé à ton adresse email !</p>}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : clients.length === 0 ? (
        <EmptyState
          title="Pas encore de client gagné"
          body="Dès qu'un prospect confirme une commande ou un devis après un rendez-vous, il apparaîtra ici."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Société</th>
                <th>Contact</th>
                <th>Client depuis</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.full_name}</td>
                  <td className="muted">{c.prospect_companies?.name || '—'}</td>
                  <td>
                    <div>{c.email}</div>
                    {c.phone && <div className="muted">{c.phone}</div>}
                  </td>
                  <td className="muted">
                    {c.won_at ? new Date(c.won_at).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent-green);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0;
        }
        .export-wrap {
          position: relative;
        }
        .btn-export {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 10px;
          padding: 0.6rem 1rem;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .export-menu {
          position: absolute;
          top: 110%;
          right: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
          min-width: 190px;
          z-index: 10;
        }
        .export-menu button {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: var(--text);
          padding: 0.7rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .export-menu button:hover {
          background: rgba(75, 57, 239, 0.1);
        }
        .export-menu button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .email-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: #3dd68c;
          padding: 0.7rem 1rem;
          border-radius: 10px;
          font-size: 0.85rem;
          margin-bottom: 1.2rem;
        }
        .table-wrap {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow: hidden;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.86rem;
        }
        thead th {
          text-align: left;
          padding: 0.9rem 1.1rem;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
        }
        tbody td {
          padding: 0.9rem 1.1rem;
          border-bottom: 1px solid var(--border);
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        .strong {
          font-weight: 600;
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
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
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard', icon: '📊' },
    { label: 'Prospects', slug: 'prospects', icon: '🎯' },
    { label: 'Campagnes', slug: 'campaigns', icon: '🚀' },
    { label: 'Agenda', slug: 'agenda', icon: '📅' },
    { label: 'Résultats', slug: 'resultats', icon: '📈' },
    { label: 'Clients gagnés', slug: 'clients-gagnes', icon: '🏆' },
    { label: 'Mes documents', slug: 'documents', icon: '📁' },
    { label: 'Chat avec Aaron', slug: 'chat', icon: '💬' },
    { label: 'Connexions', slug: 'connexions', icon: '🔗' },
    { label: 'Disponibilités', slug: 'disponibilites', icon: '🕒' },
    { label: 'Préférences', slug: 'preferences', icon: '⚙️' },
    { label: 'Mon équipe', slug: 'team', icon: '👥' },
    { label: 'Suggestions', slug: 'suggestions', icon: '💡' },
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
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={item.label === active ? 'active' : ''}><span className="nav-icon">{item.icon}</span>{item.label}</li>
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
