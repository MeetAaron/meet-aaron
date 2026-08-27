'use client';

// components/ContactInfoEditor.jsx
//
// Demande Alex (27/08/2026) : "il faut une possibilité de modifier
// manuellement la fiche" dans Prospects, Opportunités et Clients — jusqu'ici
// seules les infos société (voir components/CompanyInfoEditor.jsx, même
// pattern) étaient modifiables après création d'un prospect. Rien ne
// permettait de corriger le nom, l'email, le téléphone ou le poste du
// contact lui-même une fois la fiche créée (ex: faute de frappe à la
// création, poste qui a changé, numéro mis à jour).
//
// Composant partagé entre app/app/prospects/page.jsx (dans une modale, cette
// page n'a pas de panneau de détail), app/app/sales/page.jsx et
// app/app/customer/page.jsx (directement dans le panneau <aside className=
// "detail">, à côté de CompanyInfoEditor) — même principe de duplication
// évitée que CompanyInfoEditor/ExportFormatMenu. Style auto-contenu comme
// ces deux composants (le styled-jsx d'une page parente ne s'applique jamais
// à un composant enfant importé).

import { useState } from 'react';
import { t } from '@/lib/i18n';

export default function ContactInfoEditor({ prospect, locale, onSaved }) {
  const [overrides, setOverrides] = useState(null);
  const current = overrides || prospect || {};
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(current.full_name || '');
  const [email, setEmail] = useState(current.email || '');
  const [phone, setPhone] = useState(current.phone || '');
  const [jobTitle, setJobTitle] = useState(current.job_title || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEditing() {
    setFullName(current.full_name || '');
    setEmail(current.email || '');
    setPhone(current.phone || '');
    setJobTitle(current.job_title || '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_contact_info',
        full_name: fullName,
        email,
        phone,
        job_title: jobTitle,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || t('common.error', locale));
      return;
    }
    setEditing(false);
    setOverrides({ ...current, full_name: fullName, email, phone, job_title: jobTitle });
    onSaved?.();
  }

  return (
    <div className="contact-info">
      <div className="header-row">
        <h3>{t('prospects.contactInfoTitle', locale)}</h3>
        {!editing && (
          <button type="button" className="link-btn" onClick={startEditing}>
            {t('common.edit', locale)}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="fields-grid">
            <label>
              {t('prospects.colName', locale)}
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label>
              {t('modal.email', locale)}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              {t('modal.phone', locale)}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              {t('prospects.colJobTitle', locale)}
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel', locale)}
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !fullName.trim() || !email.trim()}>
              {saving ? t('common.saving', locale) : t('common.save', locale)}
            </button>
          </div>
        </>
      ) : (
        <div className="fields-grid read">
          <div className="read-field">
            <span className="read-label">{t('prospects.colName', locale)}</span>
            <span className="read-value">{current.full_name || '—'}</span>
          </div>
          <div className="read-field">
            <span className="read-label">{t('modal.email', locale)}</span>
            <span className="read-value">{current.email || '—'}</span>
          </div>
          <div className="read-field">
            <span className="read-label">{t('modal.phone', locale)}</span>
            <span className="read-value">{current.phone || '—'}</span>
          </div>
          <div className="read-field">
            <span className="read-label">{t('prospects.colJobTitle', locale)}</span>
            <span className="read-value">{current.job_title || '—'}</span>
          </div>
        </div>
      )}

      <style jsx>{`
        .contact-info {
          margin-top: 0.4rem;
        }
        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }
        h3 {
          font-size: 0.95rem;
          margin: 0;
        }
        .link-btn {
          background: none;
          border: none;
          color: var(--accent);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
        }
        .fields-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.7rem;
        }
        .fields-grid.read {
          gap: 0.5rem 0.7rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-size: 0.78rem;
          color: var(--muted);
        }
        input {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.7rem;
          color: var(--text);
          font-size: 0.85rem;
        }
        .read-field {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .read-label {
          font-size: 0.72rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .read-value {
          font-size: 0.85rem;
          color: var(--text);
          word-break: break-word;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.8rem;
          margin: 0.5rem 0 0;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 0.8rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-weight: 600;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        @media (max-width: 480px) {
          .fields-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
