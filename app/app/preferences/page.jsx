// app/app/preferences/page.jsx
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

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email uniquement' },
  { value: 'push', label: 'Notification push uniquement' },
  { value: 'both', label: 'Email + notification push' },
];

const DELAY_OPTIONS = [15, 30, 60];

const COLLABORATION_LEVELS = [
  { value: 0, label: 'Niveau 0', desc: 'Aucun lien CRM — Aaron travaille avec sa propre base de données.' },
  { value: 1, label: 'Niveau 1', desc: 'Connexion CRM basique, synchronisation manuelle ponctuelle.' },
  { value: 2, label: 'Niveau 2', desc: 'Synchronisation automatique quotidienne avec votre CRM.' },
  { value: 3, label: 'Niveau 3', desc: 'Synchronisation automatique horaire, intégration complète.' },
];

const OFFERS = [
  { value: 'AP', label: 'Aaron Prospect', desc: 'Prospection, relances et prise de rendez-vous.', available: true },
  { value: 'AS', label: 'Aaron Sales', desc: 'Négociation, devis, gestion des objections.', available: false },
  { value: 'AC', label: 'Aaron Customer', desc: 'Fidélisation et relation client post-vente.', available: false },
];

export default function PreferencesPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [offerError, setOfferError] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setPrefs(res.preferences);
        setLoading(false);
      });
  }, [userId]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setOfferError(null);
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        notify_channel: prefs.notify_channel,
        notify_before_appointment_minutes: prefs.notify_before_appointment_minutes,
        collaboration_level: prefs.collaboration_level,
        offer: prefs.offer,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json();
      setOfferError(body.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
    <Shell active="Préférences" userId={userId}>
      <header className="header">
        <p className="eyebrow">Réglages</p>
        <h1>Préférences</h1>
      </header>

      {loading || !prefs ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div className="panel">
          <div className="field">
            <label>Votre abonnement</label>
            <div className="offer-options">
              {OFFERS.map((o) => (
                <button
                  key={o.value}
                  className={`offer-card ${prefs.offer === o.value ? 'active' : ''} ${!o.available ? 'disabled' : ''}`}
                  onClick={() => o.available && setPrefs({ ...prefs, offer: o.value })}
                  disabled={!o.available}
                >
                  <span className="offer-title">
                    {o.label}
                    {!o.available && <span className="soon-badge">En développement</span>}
                  </span>
                  <span className="offer-desc">{o.desc}</span>
                </button>
              ))}
            </div>
            {offerError && <p className="error">{offerError}</p>}
          </div>

          <div className="field">
            <label>Comment veux-tu être prévenu d'un rendez-vous ?</label>
            <div className="options">
              {CHANNEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={prefs.notify_channel === opt.value ? 'option active' : 'option'}
                  onClick={() => setPrefs({ ...prefs, notify_channel: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Combien de temps avant le RDV veux-tu être alerté ?</label>
            <div className="options">
              {DELAY_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  className={prefs.notify_before_appointment_minutes === minutes ? 'option active' : 'option'}
                  onClick={() => setPrefs({ ...prefs, notify_before_appointment_minutes: minutes })}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Niveau de collaboration avec votre CRM</label>
            <div className="collab-options">
              {COLLABORATION_LEVELS.map((lvl) => (
                <button
                  key={lvl.value}
                  className={prefs.collaboration_level === lvl.value ? 'collab-card active' : 'collab-card'}
                  onClick={() => setPrefs({ ...prefs, collaboration_level: lvl.value })}
                >
                  <span className="collab-title">{lvl.label}</span>
                  <span className="collab-desc">{lvl.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="actions">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {saved && <span className="saved-msg">Préférences enregistrées ✓</span>}
          </div>
        </div>
      )}

      <footer className="page-footer">
        <a href="/privacy" target="_blank" rel="noreferrer">Politique de confidentialité</a>
        <span className="footer-sep">·</span>
        <a href="/unsubscribe" className="unsubscribe-link">Se désabonner</a>
      </footer>

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
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.6rem;
          max-width: 640px;
        }
        .field {
          margin-bottom: 1.8rem;
        }
        .field label {
          display: block;
          font-size: 0.9rem;
          margin-bottom: 0.7rem;
        }
        .options {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .option {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.55rem 0.9rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .option.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .offer-options {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .offer-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.9rem 1rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .offer-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .offer-card.disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .offer-title {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .soon-badge {
          font-size: 0.66rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          background: rgba(240, 145, 78, 0.16);
          color: #f0914e;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
        }
        .offer-desc {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .collab-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
        }
        .collab-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.8rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .collab-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .collab-title {
          font-weight: 600;
          font-size: 0.86rem;
          color: var(--text);
        }
        .collab-desc {
          font-size: 0.76rem;
          color: var(--muted);
          line-height: 1.35;
        }
        .error {
          color: #e5484d;
          font-size: 0.8rem;
          margin-top: 0.5rem;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          margin-top: 0.5rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.65rem 1.2rem;
          font-weight: 600;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .saved-msg {
          color: var(--accent-green);
          font-size: 0.84rem;
        }
        .page-footer {
          margin-top: 2rem;
          padding-top: 1.2rem;
          border-top: 1px solid var(--border);
        }
        .page-footer a {
          color: var(--muted);
          font-size: 0.78rem;
          text-decoration: underline;
        }
        .footer-sep {
          color: var(--muted);
          font-size: 0.78rem;
          margin: 0 0.4rem;
        }
        .unsubscribe-link {
          color: #e5484d;
        }
        .muted {
          color: var(--muted);
        }
        @media (max-width: 600px) {
          .collab-options {
            grid-template-columns: 1fr;
          }
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
