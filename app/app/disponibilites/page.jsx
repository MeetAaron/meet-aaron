// app/app/disponibilites/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

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
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  function pickDay(day) {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const d = String(day.getDate()).padStart(2, '0');
    setNewBlock({ ...newBlock, start_at: `${y}-${m}-${d}T09:00`, end_at: `${y}-${m}-${d}T18:00` });
  }

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
    <Shell active="Agenda" userId={userId}>
      <header className="header">
        <p className="eyebrow">Agenda</p>
        <h1>Mes disponibilités</h1>
        <p className="subtitle">Aaron ne proposera de créneaux aux prospects que dans ces plages, et jamais pendant vos indisponibilités.</p>
      </header>

      <nav className="subnav">
        <Link href={`/app/agenda?user_id=${userId}`} className="subnav-link">📅 Rendez-vous</Link>
        <span className="subnav-link active">🕒 Disponibilités</span>
      </nav>

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

            <p className="calendar-hint">Clique un jour dans le calendrier pour le pré-remplir plus rapidement :</p>
            <MiniCalendar month={calendarMonth} onChangeMonth={setCalendarMonth} onPickDay={pickDay} blocks={blocks} />

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
          margin-bottom: 1.2rem;
        }
        .subnav {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.8rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 0;
        }
        .subnav-link {
          display: inline-block;
          padding: 0.55rem 0.9rem;
          font-size: 0.86rem;
          font-weight: 600;
          color: var(--muted);
          text-decoration: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
        }
        .subnav-link.active {
          color: var(--text);
          border-bottom-color: var(--accent);
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
        .calendar-hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0 0 0.6rem;
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

const MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function MiniCalendar({ month, onChangeMonth, onPickDay, blocks }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  // getDay() = 0 (dimanche) .. 6 (samedi) -> on veut un offset lundi-first
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const blockedDates = new Set(
    (blocks || []).map((b) => new Date(b.start_at).toDateString())
  );

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="mini-calendar">
      <div className="cal-header">
        <button type="button" onClick={() => onChangeMonth(new Date(year, monthIndex - 1, 1))}>‹</button>
        <span>{MONTH_LABELS[monthIndex]} {year}</span>
        <button type="button" onClick={() => onChangeMonth(new Date(year, monthIndex + 1, 1))}>›</button>
      </div>
      <div className="cal-grid cal-weekdays">
        {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} className="cal-cell empty" />;
          const isPast = day < today;
          const isBlocked = blockedDates.has(day.toDateString());
          const isToday = day.toDateString() === today.toDateString();
          return (
            <button
              type="button"
              key={i}
              className={`cal-cell${isPast ? ' past' : ''}${isBlocked ? ' blocked' : ''}${isToday ? ' today' : ''}`}
              disabled={isPast}
              onClick={() => onPickDay(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .mini-calendar {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.9rem;
          max-width: 320px;
          margin-bottom: 1rem;
        }
        .cal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.84rem;
          font-weight: 600;
          margin-bottom: 0.6rem;
        }
        .cal-header button {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 6px;
          width: 24px;
          height: 24px;
          cursor: pointer;
        }
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.2rem;
        }
        .cal-weekdays {
          margin-bottom: 0.3rem;
          font-size: 0.7rem;
          color: var(--muted);
          text-align: center;
        }
        .cal-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
          font-size: 0.76rem;
          cursor: pointer;
        }
        .cal-cell.empty {
          background: transparent;
          border: none;
          cursor: default;
        }
        .cal-cell.past {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .cal-cell.blocked {
          border-color: #e5484d;
          color: #e5484d;
        }
        .cal-cell.today {
          border-color: var(--accent);
        }
        .cal-cell:not(.empty):not(.past):hover {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.14);
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // Un module (Aaron Opportunité / Aaron Client) est grisé dans la navigation tant
  // que l'offre souscrite par la société (companies.offer, voir Préférences)
  // ne correspond pas à ce module. Aaron Prospect (Campagnes/Prospects) reste
  // toujours accessible : c'est l'offre de base incluse à la souscription.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offer = body.preferences?.offer || 'AP';
        setLockedModules({ sales: offer !== 'AS', customer: offer !== 'AC' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯' },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀' },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.preferences', locale), slug: 'preferences', icon: '⚙️' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
    { label: t('nav.suggestions', locale), slug: 'suggestions', icon: '💡' },
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
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel">🔒</span>}</li>
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
        .lang-switcher {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.4rem 0.5rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.2rem;
          cursor: pointer;
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
        .nav-list li.locked {
          opacity: 0.45;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
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
