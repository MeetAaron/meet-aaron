// app/app/products/page.jsx
// Catalogue produits/tarifs de la société — Aaron s'appuie dessus pour
// chiffrer directement les devis qu'il prépare (voir lib/aaron-sales.ts
// generateDevis), sans jamais inventer un prix qui n'y figure pas.
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

const EMPTY_FORM = { reference: '', name: '', description: '', category: '', unit: 'unité', unit_price_eur: '' };

export default function ProductsPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/products?user_id=${userId}`).then((r) => r.json());
    setProducts(res.products || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.name.trim() || form.unit_price_eur === '') return;
    setSaving(true);
    setError(null);

    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...form }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || t('products.errorAdd', locale));
      return;
    }

    setForm(EMPTY_FORM);
    load();
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditForm({
      reference: p.reference || '',
      name: p.name,
      description: p.description || '',
      category: p.category || '',
      unit: p.unit,
      unit_price_eur: String(p.unit_price_eur),
    });
    setError(null);
  }

  async function saveEdit(id) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || t('products.errorEdit', locale));
      return;
    }
    setEditingId(null);
    load();
  }

  async function toggleActive(p) {
    await fetch(`/api/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    load();
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

  const visibleProducts = products.filter((p) => showInactive || p.is_active);

  return (
    <Shell active="Produits" userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('nav.opportunity', locale)}</p>
        <h1>{t('products.title', locale)}</h1>
        <p className="subtitle">
          {t('products.subtitle', locale)}
        </p>
      </header>

      <form className="add-box" onSubmit={handleAdd}>
        <input type="text" placeholder={t('products.placeholderReference', locale)} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <input type="text" placeholder={t('products.placeholderName', locale)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="text" placeholder={t('products.placeholderDescription', locale)} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input type="text" placeholder={t('products.placeholderCategory', locale)} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input type="text" placeholder={t('products.placeholderUnit', locale)} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input type="number" step="0.01" min="0" placeholder={t('products.placeholderPrice', locale)} value={form.unit_price_eur} onChange={(e) => setForm({ ...form, unit_price_eur: e.target.value })} required />
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('products.adding', locale) : t('products.addButton', locale)}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <label className="toggle-inactive">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        {t('products.showInactive', locale)}
      </label>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : visibleProducts.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t('products.emptyTitle', locale)}</p>
          <p className="empty-body">{t('products.emptyBody', locale)}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('products.colReference', locale)}</th>
                <th>{t('products.colName', locale)}</th>
                <th>{t('products.colDescription', locale)}</th>
                <th>{t('products.colCategory', locale)}</th>
                <th>{t('products.colUnit', locale)}</th>
                <th>{t('products.colPrice', locale)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => (
                editingId === p.id ? (
                  <tr key={p.id} className="editing">
                    <td><input value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} /></td>
                    <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td><input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></td>
                    <td><input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} /></td>
                    <td><input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} /></td>
                    <td><input type="number" step="0.01" min="0" value={editForm.unit_price_eur} onChange={(e) => setEditForm({ ...editForm, unit_price_eur: e.target.value })} /></td>
                    <td className="actions">
                      <button className="link" onClick={() => saveEdit(p.id)} disabled={saving}>{t('common.save', locale)}</button>
                      <button className="link muted" onClick={() => setEditingId(null)}>{t('common.cancel', locale)}</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className={!p.is_active ? 'inactive' : ''}>
                    <td className="muted">{p.reference || '—'}</td>
                    <td className="strong">{p.name}</td>
                    <td className="muted">{p.description || '—'}</td>
                    <td className="muted">{p.category || '—'}</td>
                    <td className="muted">{p.unit}</td>
                    <td>{Number(p.unit_price_eur).toFixed(2)} €</td>
                    <td className="actions">
                      <button className="link" onClick={() => startEdit(p)}>{t('common.edit', locale)}</button>
                      <button className="link muted" onClick={() => toggleActive(p)}>{p.is_active ? t('products.deactivate', locale) : t('products.reactivate', locale)}</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .header { margin-bottom: 1.5rem; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.72rem; color: var(--accent); font-weight: 600; margin: 0 0 0.4rem; }
        h1 { font-family: var(--font-display); font-size: 1.9rem; margin: 0 0 0.5rem; }
        .subtitle { color: var(--muted); font-size: 0.88rem; max-width: 64ch; margin: 0; }
        .add-box { display: flex; gap: 0.6rem; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 1.1rem; margin: 1.5rem 0 0.8rem; flex-wrap: wrap; }
        .add-box input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem 0.8rem; color: var(--text); font-size: 0.86rem; }
        .add-box input[type='text'] { flex: 1; min-width: 140px; }
        .add-box input[type='number'] { width: 130px; }
        .btn-primary { background: var(--accent); color: white; border: none; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 600; font-size: 0.86rem; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .error { color: #e5484d; font-size: 0.82rem; margin-bottom: 1rem; }
        .toggle-inactive { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.82rem; margin-bottom: 1rem; cursor: pointer; }
        .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
        thead th { text-align: left; padding: 0.9rem 1.1rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--border); }
        tbody td { padding: 0.75rem 1.1rem; border-bottom: 1px solid var(--border); }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr.inactive { opacity: 0.45; }
        .strong { font-weight: 600; }
        .muted { color: var(--muted); }
        .actions { display: flex; gap: 0.8rem; white-space: nowrap; }
        .link { background: none; border: none; color: var(--accent); text-decoration: none; font-weight: 500; font-size: 0.82rem; cursor: pointer; padding: 0; }
        .link.muted { color: var(--muted); }
        .editing input { width: 100%; }
        .empty { text-align: center; padding: 3rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }
        .empty-title { font-weight: 600; margin: 0 0 0.35rem; }
        .empty-body { color: var(--muted); font-size: 0.88rem; margin: 0; }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

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
    { label: t('nav.pipeline', locale), slug: 'pipeline', icon: '🧭' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯' },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
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
