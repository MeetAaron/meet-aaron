// app/app/preferences/page.jsx
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

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email uniquement' },
  { value: 'push', label: 'Notification push uniquement' },
  { value: 'both', label: 'Email + notification push' },
];

const DELAY_OPTIONS = [15, 30, 60];

export default function PreferencesPage() {
  const userId = useCurrentUserId();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        notify_channel: prefs.notify_channel,
        notify_before_appointment_minutes: prefs.notify_before_appointment_minutes,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!userId) {
    return (
      <Shell active="Préférences">
        <EmptyState title="Aucun identifiant commercial" body="Ouvrez cette page avec ?user_id=... dans l'URL." />
      </Shell>
    );
  }

  return (
    <Shell active="Préférences">
      <header className="header">
        <p className="eyebrow">Réglages</p>
        <h1>Préférences</h1>
      </header>

      {loading || !prefs ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div className="panel">
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

          <div className="actions">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {saved && <span className="saved-msg">Préférences enregistrées ✓</span>}
          </div>
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
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.6rem;
          max-width: 560px;
        }
        .field {
          margin-bottom: 1.6rem;
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
