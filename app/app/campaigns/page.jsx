// app/app/campaigns/page.jsx
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

const STATUS_LABELS = {
  en_attente: { label: 'En attente', color: '#8B90A8' },
  en_cours: { label: 'En cours', color: '#4B9EF0' },
  terminee: { label: 'Terminée', color: '#3DD68C' },
  en_pause: { label: 'En pause', color: '#F0914E' },
};

const ZONE_TYPE_LABELS = {
  departement: 'Département',
  region: 'Région',
  ville: 'Ville',
};

export default function CampaignsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [companyId, setCompanyId] = useState(null);

  async function loadCampaigns() {
    setLoading(true);
    const res = await fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json());
    setCampaigns(res.campaigns || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadCampaigns();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
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

  return (
    <Shell active="Campagnes" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Prospection</p>
          <h1>Vos campagnes</h1>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Nouvelle campagne
        </button>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title="Aucune campagne" body="Lancez votre première campagne pour qu'Aaron commence à chercher des prospects." />
      ) : (
        <div className="cards">
          {campaigns.map((c) => {
            const status = STATUS_LABELS[c.status] || STATUS_LABELS.en_attente;
            const progress = c.target_count > 0 ? Math.min(100, Math.round((c.contacts_found / c.target_count) * 100)) : 0;
            return (
              <div className="card" key={c.id}>
                <div className="card-top">
                  <div>
                    <h3>{c.zone_label}</h3>
                    <p className="muted">{c.sector_keywords?.join(', ')}</p>
                  </div>
                  <span className="status-pill" style={{ color: status.color, borderColor: status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="card-bottom">
                  <span>{c.contacts_found} / {c.target_count} contacts trouvés</span>
                  <span className="muted">{c.companies_found} entreprises analysées</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <NewCampaignModal
          userId={userId}
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            loadCampaigns();
          }}
        />
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
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
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.7rem 1.1rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.2rem;
        }
        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }
        .card-top h3 {
          margin: 0 0 0.2rem;
          font-family: var(--font-display);
          font-size: 1.05rem;
        }
        .status-pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.6rem;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .progress-track {
          height: 6px;
          background: var(--border);
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 0.6rem;
        }
        .progress-fill {
          height: 100%;
          background: var(--accent);
          border-radius: 999px;
        }
        .card-bottom {
          display: flex;
          justify-content: space-between;
          font-size: 0.78rem;
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
  );
}

function NewCampaignModal({ userId, companyId, onClose, onCreated }) {
  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneType, setZoneType] = useState('departement');
  const [zoneCodes, setZoneCodes] = useState('');
  const [sectors, setSectors] = useState('');
  const [targetCount, setTargetCount] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        assigned_user_id: userId,
        zone_label: zoneLabel,
        zone_type: zoneType,
        zone_codes: zoneCodes.split(',').map((s) => s.trim()).filter(Boolean),
        sector_keywords: sectors.split(',').map((s) => s.trim()).filter(Boolean),
        target_count: Number(targetCount),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || 'Erreur lors de la création');
      return;
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Nouvelle campagne</h2>

        <label>
          Zone géographique
          <input
            value={zoneLabel}
            onChange={(e) => setZoneLabel(e.target.value)}
            placeholder="ex: Seine-et-Marne (77)"
            required
          />
        </label>

        <label>
          Type de zone
          <select value={zoneType} onChange={(e) => setZoneType(e.target.value)}>
            {Object.entries(ZONE_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          Code(s) de zone, séparés par des virgules
          <input
            value={zoneCodes}
            onChange={(e) => setZoneCodes(e.target.value)}
            placeholder="ex: 77 ou 75,77,78,91,92,93,94,95"
            required
          />
        </label>

        <label>
          Secteur(s) d'activité, séparés par des virgules
          <input
            value={sectors}
            onChange={(e) => setSectors(e.target.value)}
            placeholder="ex: plomberie, chauffagiste"
            required
          />
        </label>

        <label>
          Nombre de contacts visés
          <input
            type="number"
            min="1"
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Création…' : 'Lancer la campagne'}
          </button>
        </div>
      </form>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.8rem;
          width: 420px;
          max-width: 90vw;
        }
        h2 {
          font-family: var(--font-display);
          margin: 0 0 1.2rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 1rem;
        }
        input, select {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.88rem;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 1.2rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.6rem 1rem;
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
