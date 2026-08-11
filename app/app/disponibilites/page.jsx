// app/app/disponibilites/page.jsx
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

const DAYS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 0, label: 'Dimanche' },
];

const APPOINTMENT_TYPES = [
  { value: '', label: 'Tous types de RDV' },
  { value: 'visio', label: 'Visio' },
  { value: 'tel', label: 'Téléphone' },
  { value: 'physique', label: 'Physique' },
];

function dayLabel(value) {
  return DAYS.find((d) => d.value === value)?.label || '';
}

export default function DisponibilitesPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [rules, setRules] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newRule, setNewRule] = useState({ day_of_week: 1, start_time: '09:00', end_time: '18:00', appointment_type: '' });
  const [savingRule, setSavingRule] = useState(false);

  const [newBlock, setNewBlock] = useState({ start_at: '', end_at: '', reason: '' });
  const [savingBlock, setSavingBlock] = useState(false);

  function loadAvailability() {
    if (!userId) return;
    fetch(`/api/availability?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        setRules(body.rules || []);
        setBlocks(body.blocks || []);
        setLoading(false);
      });
  }

  useEffect(loadAvailability, [userId]);

  async function handleAddRule(e) {
    e.preventDefault();
    setSavingRule(true);
    setError(null);
    const res = await fetch('/api/availability/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...newRule }),
    });
    const body = await res.json();
    setSavingRule(false);
    if (!res.ok) {
      setError(body.error);
      return;
    }
    setRules((prev) => [...prev, body.rule].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)));
  }

  async function handleDeleteRule(id) {
    await fetch(`/api/availability/rules/${id}?user_id=${userId}`, { method: 'DELETE' });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleAddBlock(e) {
    e.preventDefault();
    if (!newBlock.start_at || !newBlock.end_at) return;
    setSavingBlock(true);
    setError(null);
    const res = await fetch('/api/availability/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        start_at: new Date(newBlock.start_at).toISOString(),
        end_at: new Date(newBlock.end_at).toISOString(),
        reason: newBlock.reason,
      }),
    });
    const body = await res.json();
    setSavingBlock(false);
    if (!res.ok) {
      setError(body.error);
      return;
    }
    setBlocks((prev) => [...prev, body.block].sort((a, b) => a.start_at.localeCompare(b.start_at)));
    setNewBlock({ start_at: '', end_at: '', reason: '' });
  }

  async function handleDeleteBlock(id) {
    await fetch(`/api/availability/blocks/${id}?user_id=${userId}`, { method: 'DELETE' });
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif; text-align: center; padding: 2rem; }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active="Disponibilités" userId={userId}>
      <header className="header">
        <p className="eyebrow">Agenda</p>
        <h1>Mes disponibilités</h1>
        <p className="subtitle">Aaron ne proposera de créneaux aux prospects que dans ces plages, et jamais pendant vos indisponibilités.</p>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <section className="panel">
            <h2>Créneaux récurrents</h2>
            {rules.length === 0 ? (
              <p className="muted small">Aucun créneau défini pour l'instant — Aaron considère que vous êtes disponible en permanence.</p>
            ) : (
              <ul className="rule-list">
                {rules.map((r) => (
                  <li key={r.id} className="rule-item">
                    <span className="rule-day">{dayLabel(r.day_of_week)}</span>
                    <span className="rule-time">{r.start_time.slice(0, 5)} – {r.end_time.slice(0, 5)}</span>
                    <span className="rule-type">{APPOINTMENT_TYPES.find((t) => t.value === (r.appointment_type || ''))?.label || 'Tous types de RDV'}</span>
                    <button type="button" className="btn-remove" onClick={() => handleDeleteRule(r.id)} aria-label="Supprimer">✕</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="rule-form" onSubmit={handleAddRule}>
              <select value={newRule.day_of_week} onChange={(e) => setNewRule({ ...newRule, day_of_week: Number(e.target.value) })}>
                {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <input type="time" value={newRule.start_time} onChange={(e) => setNewRule({ ...newRule, start_time: e.target.value })} required />
              <span className="sep">à</span>
              <input type="time" value={newRule.end_time} onChange={(e) => setNewRule({ ...newRule, end_time: e.target.value })} required />
              <select value={newRule.appointment_type} onChange={(e) => setNewRule({ ...newRule, appointment_type: e.target.value })}>
                {APPOINTMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <button type="submit" className="btn-primary" disabled={savingRule}>{savingRule ? 'Ajout…' : 'Ajouter'}</button>
            </form>
          </section>

          <section className="panel">
            <h2>Indisponibilités ponctuelles</h2>
            {blocks.length === 0 ? (
              <p className="muted small">Aucune indisponibilité à venir.</p>
            ) : (
              <ul className="block-list">
                {blocks.map((b) => (
                  <li key={b.id} className="block-item">
                    <span className="block-dates">
                      {new Date(b.start_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      {' → '}
                      {new Date(b.end_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {b.reason && <span className="block-reason">{b.reason}</span>}
                    <button type="button" className="btn-remove" onClick={() => handleDeleteBlock(b.id)} aria-label="Supprimer">✕</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="block-form" onSubmit={handleAddBlock}>
              <input type="datetime-local" value={newBlock.start_at} onChange={(e) => setNewBlock({ ...newBlock, start_at: e.target.value })} required />
              <span className="sep">à</span>
              <input type="datetime-local" value={newBlock.end_at} onChange={(e) => setNewBlock({ ...newBlock, end_at: e.target.value })} required />
              <input type="text" placeholder="Motif (optionnel, ex: vacances)" value={newBlock.reason} onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })} />
              <button type="submit" className="btn-primary" disabled={savingBlock}>{savingBlock ? 'Ajout…' : 'Bloquer ce créneau'}</button>
            </form>
          </section>

          {error && <p className="error">{error}</p>}
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
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.86rem;
          max-width: 560px;
          margin: 0;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.6rem;
          max-width: 720px;
          margin-bottom: 1.4rem;
        }
        .panel h2 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0 0 1rem;
        }
        .muted {
          color: var(--muted);
        }
        .small {
          font-size: 0.84rem;
        }
        .rule-list, .block-list {
          list-style: none;
          margin: 0 0 1.2rem;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .rule-item, .block-item {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.6rem 0.9rem;
          font-size: 0.85rem;
        }
        .rule-day {
          font-weight: 600;
          min-width: 80px;
        }
        .rule-time {
          font-family: var(--font-mono);
          color: var(--accent-green);
        }
        .rule-type {
          color: var(--muted);
          margin-left: auto;
        }
        .block-dates {
          font-family: var(--font-mono);
          font-size: 0.8rem;
        }
        .block-reason {
          color: var(--muted);
          margin-left: 0.4rem;
        }
        .btn-remove {
          margin-left: auto;
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0.2rem 0.4rem;
        }
        .btn-remove:hover {
          color: #e5484d;
        }
        .rule-form, .block-form {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
        }
        .rule-form select, .rule-form input, .block-form input {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.5rem 0.7rem;
          color: var(--text);
          font-size: 0.84rem;
        }
        .block-form input[type='text'] {
          flex: 1;
          min-width: 180px;
        }
        .sep {
          color: var(--muted);
          font-size: 0.8rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.55rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          color: #e5484d;
          font-size: 0.85rem;
        }
      `}</style>
    </Shell>
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
