// app/app/prospects/page.jsx
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

const STATUS_META = {
  vert: { label: 'En bonne voie', color: '#3DD68C' },
  jaune: { label: 'En cours', color: '#8B90A8' },
  orange: { label: 'Risque de perdre', color: '#F0914E' },
  rouge: { label: 'Perdu', color: '#E5484D' },
  bleu: { label: 'RDV obtenu', color: '#4B9EF0' },
};

const PERSONALITY_LABELS = {
  dominant: 'Dominant',
  influent: 'Influent',
  stable: 'Stable',
  consciencieux: 'Consciencieux',
};

export default function ProspectsPage() {
  const userId = useCurrentUserId();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('tous');

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/prospects?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setProspects(res.prospects || []);
        setLoading(false);
      });
  }, [userId]);

  const filtered = statusFilter === 'tous' ? prospects : prospects.filter((p) => p.status === statusFilter);

  if (!userId) {
    return (
      <Shell active="Prospects">
        <EmptyState title="Aucun identifiant commercial" body="Ouvrez cette page avec ?user_id=... dans l'URL." />
      </Shell>
    );
  }

  return (
    <Shell active="Prospects">
      <header className="header">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Vos prospects</h1>
        </div>
      </header>

      <div className="filters">
        <button className={statusFilter === 'tous' ? 'chip active' : 'chip'} onClick={() => setStatusFilter('tous')}>
          Tous ({prospects.length})
        </button>
        {Object.entries(STATUS_META).map(([key, meta]) => {
          const count = prospects.filter((p) => p.status === key).length;
          return (
            <button
              key={key}
              className={statusFilter === key ? 'chip active' : 'chip'}
              onClick={() => setStatusFilter(key)}
            >
              <span className="chip-dot" style={{ background: meta.color }} />
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun prospect ici"
          body={prospects.length === 0 ? "Lancez une campagne pour qu'Aaron commence à prospecter." : "Aucun prospect ne correspond à ce filtre."}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Statut</th>
                <th>Nom</th>
                <th>Société</th>
                <th>Personnalité ressentie</th>
                <th>Conseils d'Aaron</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const meta = STATUS_META[p.status] || STATUS_META.jaune;
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                        <span className="dot" style={{ background: meta.color }} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="strong">{p.full_name}</td>
                    <td className="muted">{p.prospect_companies?.name || '—'}</td>
                    <td>
                      {p.personality_type ? (
                        <span className="tag">{PERSONALITY_LABELS[p.personality_type] || p.personality_type}</span>
                      ) : (
                        <span className="muted">Pas encore détectée</span>
                      )}
                      {p.personality_notes && <p className="notes">{p.personality_notes}</p>}
                    </td>
                    <td className="advice">{p.aaron_advice || <span className="muted">—</span>}</td>
                    <td className="contact">
                      <div>{p.email}</div>
                      {p.phone && <div className="muted">{p.phone}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.5rem;
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
          margin: 0;
        }
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        }
        .chip {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.45rem 0.9rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .chip.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .chip-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
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
          vertical-align: top;
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
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.25rem 0.7rem;
          font-size: 0.76rem;
          white-space: nowrap;
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .tag {
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          padding: 0.2rem 0.6rem;
          border-radius: 6px;
          font-size: 0.78rem;
        }
        .notes {
          margin: 0.35rem 0 0;
          color: var(--muted);
          font-size: 0.78rem;
          max-width: 22ch;
        }
        .advice {
          max-width: 26ch;
          color: var(--text);
        }
        .contact {
          font-size: 0.82rem;
          white-space: nowrap;
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
