// app/app/dashboard/page.jsx
'use client';

import { useEffect, useState } from 'react';

// TODO: remplacer par le vrai user_id une fois l'authentification construite.
// Pour l'instant, on lit un user_id passé en paramètre d'URL (?user_id=...) pour les tests.
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

export default function DashboardPage() {
  const userId = useCurrentUserId();
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      setLoading(true);
      const [pRes, cRes, aRes] = await Promise.all([
        fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
        fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
        fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      ]);
      setProspects(pRes.prospects || []);
      setCampaigns(cRes.campaigns || []);
      setAppointments(aRes.appointments || []);
      setLoading(false);
    }
    load();
  }, [userId]);

  const statusCounts = Object.keys(STATUS_META).reduce((acc, key) => {
    acc[key] = prospects.filter((p) => p.status === key).length;
    return acc;
  }, {});

  const activeCampaigns = campaigns.filter((c) => c.status === 'en_cours' || c.status === 'en_attente');
  const upcomingAppointments = appointments
    .filter((a) => a.status === 'validé' && new Date(a.proposed_at) > new Date())
    .slice(0, 5);
  const pendingAppointments = appointments.filter((a) => a.status === 'proposé');

  if (!userId) {
    return (
      <Shell>
        <EmptyState
          title="Aucun identifiant commercial"
          body="Ouvrez ce tableau de bord avec ?user_id=... dans l'URL, le temps que la connexion soit mise en place."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="header">
        <div>
          <p className="eyebrow">Tableau de bord</p>
          <h1>Ce qu'Aaron a fait pendant votre absence</h1>
        </div>
        <AaronPulse active={activeCampaigns.length > 0} />
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          {pendingAppointments.length > 0 && (
            <section className="alert">
              <strong>{pendingAppointments.length}</strong> rendez-vous propos{pendingAppointments.length > 1 ? 'és' : 'é'} par Aaron attendent votre validation.
            </section>
          )}

          <section className="stat-row">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <div className="stat-card" key={key}>
                <span className="dot" style={{ background: meta.color }} />
                <span className="stat-number">{statusCounts[key] || 0}</span>
                <span className="stat-label">{meta.label}</span>
              </div>
            ))}
          </section>

          <section className="grid-two">
            <div className="panel">
              <h2>Prochains rendez-vous</h2>
              {upcomingAppointments.length === 0 ? (
                <EmptyState title="Rien de prévu" body="Aaron n'a pas encore décroché de rendez-vous confirmé." compact />
              ) : (
                <ul className="list">
                  {upcomingAppointments.map((a) => (
                    <li key={a.id} className="list-item">
                      <div>
                        <strong>{a.prospects?.full_name}</strong>
                        <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      </div>
                      <span className="pill">{new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel">
              <h2>Campagnes en cours</h2>
              {activeCampaigns.length === 0 ? (
                <EmptyState title="Aucune campagne active" body="Lancez une campagne pour qu'Aaron commence à prospecter." compact />
              ) : (
                <ul className="list">
                  {activeCampaigns.map((c) => (
                    <li key={c.id} className="list-item">
                      <div>
                        <strong>{c.zone_label}</strong>
                        <span className="muted"> — {c.sector_keywords?.join(', ')}</span>
                      </div>
                      <span className="pill">{c.contacts_found}/{c.target_count} contacts</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
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
          max-width: 26ch;
          line-height: 1.2;
        }
        .alert {
          background: rgba(240, 169, 78, 0.12);
          border: 1px solid rgba(240, 169, 78, 0.4);
          color: #f0c68a;
          padding: 0.9rem 1.2rem;
          border-radius: 10px;
          margin-bottom: 1.5rem;
          font-size: 0.92rem;
        }
        .stat-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0.75rem;
          margin-bottom: 2rem;
        }
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.6rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .grid-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.4rem;
        }
        .panel h2 {
          font-size: 1rem;
          margin: 0 0 1rem;
          font-family: var(--font-display);
        }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .list-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.9rem;
        }
        .list-item:last-child {
          border-bottom: none;
        }
        .pill {
          font-family: var(--font-mono);
          font-size: 0.76rem;
          color: var(--muted);
          white-space: nowrap;
        }
        .muted {
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .stat-row {
            grid-template-columns: repeat(2, 1fr);
          }
          .grid-two {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function AaronPulse({ active }) {
  return (
    <div className="pulse-wrap" title={active ? 'Aaron prospecte activement' : 'Aaron est en veille'}>
      <span className={`pulse-dot ${active ? 'is-active' : ''}`} />
      <span className="pulse-label">{active ? 'Aaron travaille' : 'En veille'}</span>
      <style jsx>{`
        .pulse-wrap {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.5rem 0.9rem;
        }
        .pulse-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--muted);
          position: relative;
        }
        .pulse-dot.is-active {
          background: var(--accent-green);
        }
        .pulse-dot.is-active::after {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 1px solid var(--accent-green);
          animation: ping 2s ease-out infinite;
        }
        .pulse-label {
          font-size: 0.8rem;
          color: var(--muted);
        }
        @keyframes ping {
          0% { transform: scale(0.6); opacity: 0.8; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pulse-dot.is-active::after { animation: none; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ title, body, compact }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: ${compact ? '1.5rem 1rem' : '4rem 1rem'};
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

function Shell({ children }) {
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          <li className="active">Tableau de bord</li>
          <li>Prospects</li>
          <li>Campagnes</li>
          <li>Agenda</li>
          <li>Résultats</li>
          <li>Clients gagnés</li>
          <li>Mes documents</li>
          <li>Chat avec Aaron</li>
          <li>Connexions</li>
          <li>Préférences</li>
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
