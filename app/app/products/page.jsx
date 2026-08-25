// app/app/products/page.jsx
// Catalogue produits/tarifs de la société — Aaron s'appuie dessus pour
// chiffrer directement les devis qu'il prépare (voir lib/aaron-sales.ts
// generateDevis), sans jamais inventer un prix qui n'y figure pas.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';

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
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
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
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--muted); font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--accent-red); font-family: 'Inter', sans-serif; text-align: center; padding: 2rem; }
        `}</style>
      </div>
    );
  }

  const visibleProducts = products.filter((p) => showInactive || p.is_active);

  return (
    <Shell active={t('nav.products', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('nav.products', locale)}</p>
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
        .add-box { display: flex; gap: 0.6rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.1rem; margin: 1.5rem 0 0.8rem; flex-wrap: wrap; }
        .add-box input { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.55rem 0.8rem; color: var(--text); font-size: 0.86rem; }
        .add-box input[type='text'] { flex: 1; min-width: 140px; }
        .add-box input[type='number'] { width: 130px; }
        .btn-primary { background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); padding: 0.55rem 1rem; font-weight: 600; font-size: 0.86rem; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .error { color: var(--accent-red); font-size: 0.82rem; margin-bottom: 1rem; }
        .toggle-inactive { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.82rem; margin-bottom: 1rem; cursor: pointer; }
        .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow-x: auto; -webkit-overflow-scrolling: touch; }
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
        .empty { text-align: center; padding: 3rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .empty-title { font-weight: 600; margin: 0 0 0.35rem; }
        .empty-body { color: var(--muted); font-size: 0.88rem; margin: 0; }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
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
        aria-label={t('shell.openMenu', locale)}
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
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
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
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            {t('shell.connected', locale)}
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            {t('common.logout', locale)}
          </button>
        </div>
      </nav>
      <main className="content">{children}</main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
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
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
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
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
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
