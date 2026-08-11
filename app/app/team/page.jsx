// app/app/team/page.jsx
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

export default function TeamPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamError, setTeamError] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/team?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setTeamError(body.error);
        } else {
          setMembers(body.members || []);
          setInviteCode(body.invite_code || null);
        }
        setLoading(false);
      });
  }, [userId]);

  function copyInviteCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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

  return (
    <Shell active="Mon équipe" userId={userId}>
      <header className="header">
        <p className="eyebrow">Équipe</p>
        <h1>Mon équipe</h1>
      </header>

      {!loading && inviteCode && (
        <div className="invite-box">
          <div>
            <p className="invite-label">Code d'invitation de votre société</p>
            <p className="invite-hint">Communiquez ce code à un commercial : il pourra rejoindre votre société lors de son inscription, sans repasser par le paiement.</p>
          </div>
          <div className="invite-code-row">
            <code className="invite-code">{inviteCode}</code>
            <button type="button" className="btn-copy" onClick={copyInviteCode}>
              {copied ? 'Copié !' : 'Copier'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : teamError ? (
        <EmptyState title="Accès non autorisé" body={teamError} />
      ) : members.length === 0 ? (
        <EmptyState title="Aucun commercial" body="Aucun commercial n'est encore rattaché à votre société." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Prospects actifs</th>
                <th>RDV validés</th>
                <th>Clients gagnés</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/app/team/${m.id}?user_id=${userId}`} className="member-link">
                      {m.full_name}
                    </Link>
                  </td>
                  <td className="muted">{m.email}</td>
                  <td className="muted">{m.role === 'patron' ? 'Fondateur' : 'Commercial'}</td>
                  <td>{m.prospects_actifs}</td>
                  <td>{m.rdv_valides}</td>
                  <td>{m.clients_gagnes}</td>
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
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0;
        }
        .invite-box {
          background: rgba(75, 57, 239, 0.1);
          border: 1px solid var(--accent);
          border-radius: 14px;
          padding: 1.1rem 1.3rem;
          margin-bottom: 1.6rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .invite-label {
          margin: 0 0 0.25rem;
          font-weight: 600;
          font-size: 0.88rem;
        }
        .invite-hint {
          margin: 0;
          color: var(--muted);
          font-size: 0.8rem;
          max-width: 460px;
        }
        .invite-code-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .invite-code {
          font-family: var(--font-mono);
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.55rem 0.9rem;
          font-size: 0.95rem;
          letter-spacing: 0.04em;
          color: var(--accent-green);
        }
        .btn-copy {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
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
        .member-link {
          color: var(--text);
          font-weight: 600;
          text-decoration: none;
        }
        .member-link:hover {
          color: var(--accent);
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
