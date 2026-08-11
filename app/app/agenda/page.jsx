// app/app/agenda/page.jsx
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

const TYPE_LABELS = {
  telephonique: 'Téléphonique',
  physique: 'Physique',
  visio: 'Visio',
};

const STATUS_META = {
  'proposé': { label: 'À valider', color: '#F0914E' },
  'validé': { label: 'Validé', color: '#3DD68C' },
  'reporté': { label: 'Reporté', color: '#8B90A8' },
  'annulé': { label: 'Annulé', color: '#E5484D' },
  'terminé': { label: 'Terminé', color: '#4B9EF0' },
};

export default function AgendaPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json());
    setAppointments(res.appointments || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  async function handleAction(appointmentId, action) {
    setActingOn(appointmentId);
    await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActingOn(null);
    load();
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

  const pending = appointments.filter((a) => a.status === 'proposé');
  const rest = appointments.filter((a) => a.status !== 'proposé');

  return (
    <Shell active="Agenda" userId={userId}>
      <header className="header">
        <p className="eyebrow">Rendez-vous</p>
        <h1>Votre agenda</h1>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : appointments.length === 0 ? (
        <EmptyState title="Aucun rendez-vous" body="Aaron n'a pas encore proposé de créneau." />
      ) : (
        <>
          {pending.length > 0 && (
            <section className="block">
              <h2>À valider ({pending.length})</h2>
              <div className="list">
                {pending.map((a) => (
                  <div className="row" key={a.id}>
                    <div className="row-info">
                      <strong>{a.prospects?.full_name}</strong>
                      <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      <div className="meta">
                        {TYPE_LABELS[a.type]} · {new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        className="btn-valid"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'valider')}
                      >
                        Valider
                      </button>
                      <button
                        className="btn-neutral"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'reporter')}
                      >
                        Reporter
                      </button>
                      <button
                        className="btn-danger"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'annuler')}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="block">
            <h2>Tous les rendez-vous</h2>
            <div className="list">
              {rest.map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META['proposé'];
                return (
                  <div className="row" key={a.id}>
                    <div className="row-info">
                      <strong>{a.prospects?.full_name}</strong>
                      <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      <div className="meta">
                        {TYPE_LABELS[a.type]} · {new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                    <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
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
        .block {
          margin-bottom: 2rem;
        }
        .block h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.9rem;
        }
        .list {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow: hidden;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.2rem;
          border-bottom: 1px solid var(--border);
          gap: 1rem;
        }
        .row:last-child {
          border-bottom: none;
        }
        .row-info {
          font-size: 0.9rem;
        }
        .meta {
          font-size: 0.78rem;
          color: var(--muted);
          margin-top: 0.25rem;
        }
        .muted {
          color: var(--muted);
        }
        .row-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        .btn-valid, .btn-neutral, .btn-danger {
          border: none;
          border-radius: 8px;
          padding: 0.5rem 0.9rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
        }
        .btn-neutral {
          background: var(--border);
          color: var(--text);
        }
        .btn-danger {
          background: transparent;
          border: 1px solid #e5484d;
          color: #e5484d;
        }
        .status-pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.25rem 0.7rem;
          font-size: 0.76rem;
          white-space: nowrap;
          flex-shrink: 0;
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
    { label: 'Tableau de bord', slug: 'dashboard' },
    { label: 'Prospects', slug: 'prospects' },
    { label: 'Campagnes', slug: 'campaigns' },
    { label: 'Agenda', slug: 'agenda' },
    { label: 'Résultats', slug: 'resultats' },
    { label: 'Clients gagnés', slug: 'clients-gagnes' },
    { label: 'Mes documents', slug: 'documents' },
    { label: 'Chat avec Aaron', slug: 'chat' },
    { label: 'Connexions', slug: 'connexions' },
    { label: 'Disponibilités', slug: 'disponibilites' },
    { label: 'Préférences', slug: 'preferences' },
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
