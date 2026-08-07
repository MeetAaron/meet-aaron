// app/app/clients-gagnes/page.jsx
'use client';

import { useEffect, useState } from 'react';

function useCurrentUserId() {
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setUserId(params.get('user_id'));
  }, []);
  return userId;
}

export default function WonClientsPage() {
  const userId = useCurrentUserId();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/won-clients?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setClients(res.wonClients || []);
        setLoading(false);
      });
  }, [userId]);

  if (!userId) {
    return (
      <Shell active="Clients gagnés">
        <EmptyState title="Aucun identifiant commercial" body="Ouvrez cette page avec ?user_id=... dans l'URL." />
      </Shell>
    );
  }

  return (
    <Shell active="Clients gagnés">
      <header className="header">
        <p className="eyebrow">Succès</p>
        <h1>Clients gagnés grâce à Aaron</h1>
      </header>

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
          margin-bottom: 1.8rem;
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

function Shell({ children, active }) {
  const items = [
    'Tableau de bord',
    'Prospects',
    'Campagnes',
    'Agenda',
    'Résultats',
    'Clients gagnés',
    'Mes documents',
    'Chat avec Aaron',
    'Connexions',
    'Préférences',
  ];
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {items.map((item) => (
            <li key={item} className={item === active ? 'active' : ''}>
              {item}
            </li>
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
