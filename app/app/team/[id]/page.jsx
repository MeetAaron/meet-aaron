// app/app/team/[id]/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

const STATUS_META = {
  vert: { label: 'En bonne voie', color: '#3DD68C' },
  jaune: { label: 'En cours', color: '#8B90A8' },
  orange: { label: 'Risque de perdre', color: '#F0914E' },
  rouge: { label: 'Perdu', color: '#E5484D' },
  bleu: { label: 'RDV obtenu', color: '#4B9EF0' },
};

export default function TeamMemberDetailPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const params = useParams();
  const memberId = params.id;

  const [memberInfo, setMemberInfo] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !memberId) return;
    Promise.all([
      fetch(`/api/users/${memberId}`).then((r) => r.json()),
      fetch(`/api/prospects?user_id=${memberId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${memberId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${memberId}`).then((r) => r.json()),
    ]).then(([uRes, pRes, aRes, cRes]) => {
      setMemberInfo(uRes.user || null);
      setProspects(pRes.prospects || []);
      setAppointments(aRes.appointments || []);
      setCampaigns(cRes.campaigns || []);
      setLoading(false);
    });
  }, [userId, memberId]);

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

  const upcomingAppointments = appointments.filter((a) => a.status === 'validé');

  return (
    <Shell active="Mon équipe" userId={userId}>
      <Link href={`/app/team?user_id=${userId}`} className="back-link">← Retour à l'équipe</Link>

      <header className="header">
        <p className="eyebrow">Détail commercial</p>
        <h1>{memberInfo?.full_name || 'Chargement…'}</h1>
        {memberInfo && <p className="sub">{memberInfo.email}</p>}
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <section className="stat-row">
            <div className="stat-card">
              <span className="stat-number">{prospects.length}</span>
              <span className="stat-label">Prospects actifs</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">{upcomingAppointments.length}</span>
              <span className="stat-label">RDV validés</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">{campaigns.length}</span>
              <span className="stat-label">Campagnes lancées</span>
            </div>
          </section>

          <section className="panel">
            <h2>Prospects en cours</h2>
            {prospects.length === 0 ? (
              <p className="muted">Aucun prospect actif.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Statut</th>
                      <th>Nom</th>
                      <th>Société</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.map((p) => {
                      const meta = STATUS_META[p.status] || STATUS_META.jaune;
                      return (
                        <tr key={p.id}>
                          <td>
                            <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                              {meta.label}
                            </span>
                          </td>
                          <td>{p.full_name}</td>
                          <td className="muted">{p.prospect_companies?.name || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Rendez-vous validés</h2>
            {upcomingAppointments.length === 0 ? (
              <p className="muted">Aucun rendez-vous validé.</p>
            ) : (
              <ul className="list">
                {upcomingAppointments.map((a) => (
                  <li key={a.id} className="list-item">
                    <strong>{a.prospects?.full_name}</strong>
                    <span className="muted"> — {new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <style jsx>{`
        .back-link {
          display: inline-block;
          color: var(--muted);
          font-size: 0.82rem;
          text-decoration: none;
          margin-bottom: 1.2rem;
        }
        .back-link:hover {
          color: var(--text);
        }
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
        .sub {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0.3rem 0 0;
        }
        .stat-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.9rem;
          margin-bottom: 1.5rem;
        }
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.1rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.8rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.82rem;
          color: var(--muted);
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
        .table-wrap {
          overflow: hidden;
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
        .status-pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.6rem;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .list-item {
          padding: 0.6rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.9rem;
        }
        .list-item:last-child {
          border-bottom: none;
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
    { label: 'Mon équipe', slug: 'team' },
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
