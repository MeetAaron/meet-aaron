// app/app/resultats/page.jsx
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

export default function ResultatsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [prospects, setProspects] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
    ]).then(([pRes, aRes, cRes]) => {
      setProspects(pRes.prospects || []);
      setAppointments(aRes.appointments || []);
      setCampaigns(cRes.campaigns || []);
      setLoading(false);
    });
  }, [userId]);

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

  const totalProspects = prospects.length;
  const rdvObtenus = appointments.filter((a) => a.status === 'validé' || a.status === 'terminé').length;
  const rdvEnAttente = appointments.filter((a) => a.status === 'proposé').length;
  const tauxRdv = totalProspects > 0 ? Math.round((rdvObtenus / totalProspects) * 100) : 0;
  const contactsSources = campaigns.reduce((sum, c) => sum + (c.contacts_found || 0), 0);
  const entreprisesAnalysees = campaigns.reduce((sum, c) => sum + (c.companies_found || 0), 0);
  const tauxContact = entreprisesAnalysees > 0 ? Math.round((contactsSources / entreprisesAnalysees) * 100) : 0;

  return (
    <Shell active="Résultats" userId={userId}>
      <header className="header">
        <p className="eyebrow">Performance</p>
        <h1>Vos résultats</h1>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <section className="stat-grid">
            <StatCard label="Prospects contactés" value={totalProspects} />
            <StatCard label="RDV obtenus" value={rdvObtenus} accent />
            <StatCard label="RDV en attente de validation" value={rdvEnAttente} />
            <StatCard label="Taux de transformation" value={`${tauxRdv}%`} hint="prospects → RDV" />
          </section>

          <section className="panel">
            <h2>Sourcing</h2>
            <div className="sourcing-row">
              <div>
                <span className="big-number">{entreprisesAnalysees}</span>
                <span className="muted"> entreprises analysées par Aaron</span>
              </div>
              <div>
                <span className="big-number">{contactsSources}</span>
                <span className="muted"> contacts qualifiés trouvés</span>
              </div>
              <div>
                <span className="big-number">{tauxContact}%</span>
                <span className="muted"> taux de contact trouvé</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Détail par campagne</h2>
            {campaigns.length === 0 ? (
              <p className="muted">Aucune campagne lancée pour le moment.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Secteur</th>
                    <th>Entreprises analysées</th>
                    <th>Contacts trouvés</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>{c.zone_label}</td>
                      <td className="muted">{c.sector_keywords?.join(', ')}</td>
                      <td>{c.companies_found}</td>
                      <td>{c.contacts_found} / {c.target_count}</td>
                      <td className="muted">{c.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
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
          margin: 0;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.9rem;
          margin-bottom: 1.5rem;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.4rem;
          margin-bottom: 1.5rem;
        }
        .panel h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 1rem;
        }
        .sourcing-row {
          display: flex;
          gap: 2.5rem;
          flex-wrap: wrap;
        }
        .big-number {
          font-family: var(--font-mono);
          font-size: 1.6rem;
          font-weight: 600;
          margin-right: 0.4rem;
        }
        .muted {
          color: var(--muted);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.86rem;
        }
        thead th {
          text-align: left;
          padding: 0.6rem 0.4rem;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
        }
        tbody td {
          padding: 0.7rem 0.4rem;
          border-bottom: 1px solid var(--border);
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        @media (max-width: 900px) {
          .stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </Shell>
  );
}

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="stat-card" style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
      <style jsx>{`
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.1rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .stat-value {
          font-family: var(--font-mono);
          font-size: 1.8rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.82rem;
          color: var(--muted);
        }
        .stat-hint {
          font-size: 0.72rem;
          color: var(--muted);
          opacity: 0.7;
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
