// app/app/documents/page.jsx
// CHANGEMENTS A FAIRE #89 : ajoute un bouton supprimer, une annotation "pris
// en compte par Aaron" (toggle, sans supprimer le fichier), un bouton "avis
// d'Aaron" par document, et un rattachement à une catégorie (Général /
// Prospects / Opportunités / Clients) qui détermine à quel(s) module(s)
// d'Aaron le document est exposé (voir migration_documents_2026-08-16.sql).
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

function formatSize(bytes, locale) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t('documents.sizeKb', locale)}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('documents.sizeMb', locale)}`;
}

// Catégories de rattachement (#89) — NULL/'general' = exposé à tous les
// modules d'Aaron, sinon réservé au module correspondant (voir
// lib/aaron.ts / lib/aaron-sales.ts / lib/aaron-customer.ts).
const CATEGORIES = ['general', 'prospects', 'opportunites', 'clients'];

function categoryLabelsFor(locale) {
  return {
    general: t('documents.categoryGeneral', locale),
    prospects: t('documents.categoryProspects', locale),
    opportunites: t('documents.categoryOpportunities', locale),
    clients: t('documents.categoryClients', locale),
  };
}

export default function DocumentsPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState('');
  const [uploadCategory, setUploadCategory] = useState('general');
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [categoryUpdatingId, setCategoryUpdatingId] = useState(null);
  const [generatingAdviceId, setGeneratingAdviceId] = useState(null);
  const [adviceModalDoc, setAdviceModalDoc] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/documents?user_id=${userId}`).then((r) => r.json());
    setDocuments(res.documents || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('user_id', userId);
    formData.append('description', description);
    formData.append('linked_category', uploadCategory);

    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    setUploading(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || t('documents.uploadError', locale));
      return;
    }

    setSelectedFile(null);
    setDescription('');
    setUploadCategory('general');
    load();
  }

  async function handleToggleAaronContext(doc) {
    setTogglingId(doc.id);
    setRowError(null);
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ included_in_aaron_context: !doc.included_in_aaron_context }),
    });
    setTogglingId(null);
    if (!res.ok) {
      setRowError(t('documents.deleteError', locale));
      return;
    }
    load();
  }

  async function handleCategoryChange(doc, newCategory) {
    setCategoryUpdatingId(doc.id);
    setRowError(null);
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_category: newCategory === 'general' ? null : newCategory }),
    });
    setCategoryUpdatingId(null);
    if (!res.ok) {
      setRowError(t('documents.deleteError', locale));
      return;
    }
    load();
  }

  async function handleGenerateAdvice(doc) {
    setGeneratingAdviceId(doc.id);
    const res = await fetch(`/api/documents/${doc.id}/advice`, { method: 'POST' });
    const body = await res.json();
    setGeneratingAdviceId(null);
    if (!res.ok) {
      setAdviceModalDoc({ ...doc, advice: body.error || t('documents.deleteError', locale) });
      return;
    }
    setAdviceModalDoc({ ...doc, advice: body.advice, advice_generated_at: body.advice_generated_at });
    load();
  }

  async function handleDelete(documentId) {
    setDeletingId(documentId);
    const res = await fetch(`/api/documents/${documentId}`, { method: 'DELETE' });
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (!res.ok) {
      setRowError(t('documents.deleteError', locale));
      return;
    }
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

  return (
    <Shell active={t('nav.documents', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('documents.eyebrow', locale)}</p>
        <h1>{t('documents.pageTitle', locale)}</h1>
        <p className="subtitle">
          {t('documents.subtitle', locale)}
        </p>
      </header>

      <form className="upload-box" onSubmit={handleUpload}>
        <input
          type="file"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        />
        <input
          type="text"
          placeholder={t('documents.descriptionPlaceholder', locale)}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select
          className="category-select"
          value={uploadCategory}
          onChange={(e) => setUploadCategory(e.target.value)}
          aria-label={t('documents.colCategory', locale)}
        >
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{categoryLabelsFor(locale)[cat]}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={!selectedFile || uploading}>
          {uploading ? t('documents.uploading', locale) : t('documents.uploadButton', locale)}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {rowError && <p className="error">{rowError}</p>}

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : documents.length === 0 ? (
        <EmptyState title={t('documents.emptyTitle', locale)} body={t('documents.emptyBody', locale)} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('documents.colFile', locale)}</th>
                <th>{t('documents.colDescription', locale)}</th>
                <th>{t('documents.colSummary', locale)}</th>
                <th>{t('documents.colCategory', locale)}</th>
                <th>{t('documents.colAaron', locale)}</th>
                <th>{t('documents.colSize', locale)}</th>
                <th>{t('documents.colAddedAt', locale)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="strong">{d.file_name}</td>
                  <td className="muted">{d.description || '—'}</td>
                  <td className="muted summary-cell">{d.summary || '—'}</td>
                  <td>
                    <select
                      className="category-select-inline"
                      value={d.linked_category || 'general'}
                      disabled={categoryUpdatingId === d.id}
                      onChange={(e) => handleCategoryChange(d, e.target.value)}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{categoryLabelsFor(locale)[cat]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`aaron-toggle${d.included_in_aaron_context ? ' on' : ' off'}`}
                      disabled={togglingId === d.id}
                      onClick={() => handleToggleAaronContext(d)}
                    >
                      {d.included_in_aaron_context ? `✅ ${t('documents.aaronContextOn', locale)}` : `🚫 ${t('documents.aaronContextOff', locale)}`}
                    </button>
                  </td>
                  <td className="muted">{formatSize(d.file_size_bytes, locale)}</td>
                  <td className="muted">{new Date(d.created_at).toLocaleDateString(locale, { dateStyle: 'medium' })}</td>
                  <td>
                    <div className="row-actions">
                      {d.download_url && (
                        <a href={d.download_url} target="_blank" rel="noreferrer" className="link">
                          {t('documents.download', locale)}
                        </a>
                      )}
                      <button
                        type="button"
                        className="link-btn"
                        disabled={generatingAdviceId === d.id}
                        onClick={() => (d.advice ? setAdviceModalDoc(d) : handleGenerateAdvice(d))}
                      >
                        {generatingAdviceId === d.id ? t('documents.adviceGenerating', locale) : t('documents.adviceButton', locale)}
                      </button>
                      <button type="button" className="link-btn danger" onClick={() => setConfirmDeleteId(d.id)}>
                        {t('documents.deleteButton', locale)}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adviceModalDoc && (
        <div className="overlay" onClick={() => setAdviceModalDoc(null)}>
          <div className="advice-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close-btn" onClick={() => setAdviceModalDoc(null)}>✕</button>
            <h2>{t('documents.adviceModalTitle', locale)} — {adviceModalDoc.file_name}</h2>
            <p className="advice-modal-text">{adviceModalDoc.advice}</p>
            <button
              type="button"
              className="btn-secondary regenerate-btn"
              disabled={generatingAdviceId === adviceModalDoc.id}
              onClick={() => handleGenerateAdvice(adviceModalDoc)}
            >
              {generatingAdviceId === adviceModalDoc.id ? t('documents.adviceGenerating', locale) : t('documents.adviceRegenerate', locale)}
            </button>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('documents.deleteConfirmTitle', locale)}</h2>
            <p>{t('documents.deleteConfirmBody', locale)}</p>
            <div className="confirm-actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmDeleteId(null)}>
                {t('common.cancel', locale)}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deletingId === confirmDeleteId}
                onClick={() => handleDelete(confirmDeleteId)}
              >
                {t('common.confirm', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .header {
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
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.88rem;
          max-width: 60ch;
          margin: 0;
        }
        .upload-box {
          display: flex;
          gap: 0.6rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.1rem;
          margin: 1.5rem 0 0.6rem;
          flex-wrap: wrap;
        }
        .upload-box input[type='text'] {
          flex: 1;
          min-width: 180px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.55rem 0.8rem;
          color: var(--text);
          font-size: 0.86rem;
        }
        .upload-box input[type='file'] {
          color: var(--muted);
          font-size: 0.82rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.55rem 1rem;
          font-weight: 600;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
          margin-bottom: 1rem;
        }
        .table-wrap {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin-top: 1.5rem;
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
        .strong {
          font-weight: 600;
        }
        .muted {
          color: var(--muted);
        }
        .summary-cell {
          max-width: 280px;
          font-size: 0.8rem;
          line-height: 1.4;
        }
        .link {
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
        }
        .category-select {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.55rem 0.6rem;
          color: var(--text);
          font-size: 0.82rem;
          font-family: inherit;
        }
        .category-select-inline {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.3rem 0.4rem;
          color: var(--text);
          font-size: 0.78rem;
          font-family: inherit;
          max-width: 130px;
        }
        .aaron-toggle {
          border-radius: 999px;
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          border: 1px solid var(--border);
          background: var(--bg);
        }
        .aaron-toggle.on {
          color: #3dd68c;
          border-color: rgba(61, 214, 140, 0.4);
        }
        .aaron-toggle.off {
          color: var(--muted);
        }
        .aaron-toggle:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .row-actions {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          flex-wrap: wrap;
        }
        .link-btn {
          background: none;
          border: none;
          color: var(--accent);
          font-weight: 500;
          font-size: 0.82rem;
          cursor: pointer;
          padding: 0;
        }
        .link-btn.danger {
          color: #e5484d;
        }
        .link-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .advice-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.4rem;
          width: 520px;
          max-width: 100%;
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
        }
        .advice-modal h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.8rem;
          padding-right: 1.5rem;
        }
        .advice-modal .close-btn {
          position: absolute;
          top: 1rem;
          right: 1.2rem;
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .advice-modal-text {
          font-size: 0.88rem;
          line-height: 1.55;
          color: var(--text);
          white-space: pre-line;
        }
        .regenerate-btn {
          margin-top: 0.6rem;
        }
        .confirm-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.4rem;
          width: 420px;
          max-width: 100%;
        }
        .confirm-modal h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.6rem;
        }
        .confirm-modal p {
          font-size: 0.86rem;
          color: var(--muted);
          line-height: 1.45;
          margin: 0 0 1rem;
        }
        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .btn-danger {
          background: #e5484d;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
          padding: 3rem 1rem;
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
