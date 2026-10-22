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

// Profil LinkedIn du contact (22/10/2026). Textes locaux : lib/i18n.js est
// trop lourd pour l'envoi web de GitHub.
const LI_FIELD = {
  fr: { label: 'Profil LinkedIn', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Lien LinkedIn invalide : il doit ressembler à https://www.linkedin.com/in/prenom-nom', open: 'Ouvrir' },
  en: { label: 'LinkedIn profile', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Invalid LinkedIn link: it should look like https://www.linkedin.com/in/first-last', open: 'Open' },
  de: { label: 'LinkedIn-Profil', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Ungültiger LinkedIn-Link: Er sollte so aussehen: https://www.linkedin.com/in/vorname-nachname', open: 'Öffnen' },
  it: { label: 'Profilo LinkedIn', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Link LinkedIn non valido: deve essere come https://www.linkedin.com/in/nome-cognome', open: 'Apri' },
  es: { label: 'Perfil de LinkedIn', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Enlace de LinkedIn no válido: debe ser como https://www.linkedin.com/in/nombre-apellido', open: 'Abrir' },
  pt: { label: 'Perfil LinkedIn', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Link do LinkedIn inválido: deve ser como https://www.linkedin.com/in/nome-apelido', open: 'Abrir' },
  nl: { label: 'LinkedIn-profiel', placeholder: 'https://www.linkedin.com/in/…', invalid: 'Ongeldige LinkedIn-link: hij moet lijken op https://www.linkedin.com/in/voornaam-achternaam', open: 'Openen' },
};
const lf = (key, locale) => (LI_FIELD[locale] || LI_FIELD.fr)[key] || LI_FIELD.fr[key];

export default function ContactInfoEditor({ prospect, locale, onSaved }) {
  const [overrides, setOverrides] = useState(null);
  const current = overrides || prospect || {};
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(current.full_name || '');
  const [email, setEmail] = useState(current.email || '');
  const [phone, setPhone] = useState(current.phone || '');
  const [jobTitle, setJobTitle] = useState(current.job_title || '');
  const [linkedinUrl, setLinkedinUrl] = useState(current.linkedin_url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEditing() {
    setFullName(current.full_name || '');
    setEmail(current.email || '');
    setPhone(current.phone || '');
    setJobTitle(current.job_title || '');
    setLinkedinUrl(current.linkedin_url || '');
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
        // Envoyé seulement s'il a changé (relecture 22/10) : un ancien lien
        // mal formé ne doit pas bloquer la modification du téléphone.
        ...(linkedinUrl.trim() !== (current.linkedin_url || '') ? { linkedin_url: linkedinUrl } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error === 'invalid_linkedin_profile_url' ? lf('invalid', locale) : body.error || t('common.error', locale));
      return;
    }
    setEditing(false);
    setOverrides({ ...current, full_name: fullName, email, phone, job_title: jobTitle, linkedin_url: linkedinUrl.trim() || null });
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
            <label className="span-2">
              {lf('label', locale)}
              <input type="url" inputMode="url" value={linkedinUrl} placeholder={lf('placeholder', locale)} onChange={(e) => setLinkedinUrl(e.target.value)} />
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
          {current.linkedin_url && (
            <div className="read-field span-2">
              <span className="read-label">{lf('label', locale)}</span>
              <a className="read-value read-link" href={current.linkedin_url} target="_blank" rel="noopener noreferrer">{current.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}</a>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .contact-info {
          margin-top: 0.4rem;
        }
        .span-2 {
          grid-column: 1 / -1;
        }
        .read-link {
          color: var(--accent);
          text-decoration: none;
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
