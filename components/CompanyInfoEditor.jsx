'use client';

// components/CompanyInfoEditor.jsx
//
// Bloc "Informations société" (adresse, SIRET, site web, secteur d'activité,
// taille d'entreprise, CA estimé) — demande Alex, 2026-08-25 : "dans mes
// fichiers clients, prospects, opportunité. il manque des infos je trouve
// non ? l'adresse, etc etc ?".
//
// Ces champs sont portés par prospect_companies (la société), pas par le
// contact individuel (voir migration_company_info_2026-08-25.sql) — modifier
// ce bloc depuis Prospects, Opportunités ou Clients met donc à jour la même
// fiche société partout, puisque les trois pages partagent le même prospect
// derrière (juste filtré à des étapes différentes du pipeline).
//
// Composant partagé entre app/app/prospects/page.jsx, app/app/sales/page.jsx
// et app/app/customer/page.jsx pour éviter de dupliquer 3x la même logique
// d'édition — même principe que components/ExportFormatMenu.jsx. Comme pour
// ExportFormatMenu, tout le style est auto-contenu ici (le styled-jsx d'une
// page parente ne s'applique jamais à un composant enfant importé).

import { useState } from 'react';
import { t } from '@/lib/i18n';

const FIELDS = [
  { key: 'address', labelKey: 'prospects.colAddress' },
  { key: 'siret', labelKey: 'prospects.colSiret' },
  { key: 'website', labelKey: 'prospects.colWebsite' },
  { key: 'industry', labelKey: 'prospects.colIndustry' },
  { key: 'company_size', labelKey: 'prospects.colCompanySize' },
  { key: 'estimated_revenue', labelKey: 'prospects.colEstimatedRevenue' },
];

export default function CompanyInfoEditor({ prospect, locale, onSaved }) {
  const companyFromProp = prospect?.prospect_companies || {};
  // `prospect` vient d'une liste déjà chargée côté page parente (loadProspects/
  // loadDeals/loadCustomers) — un onSaved() réussi déclenche ce rechargement,
  // mais tant qu'il n'est pas terminé cette prop reste l'ancien instantané.
  // On garde donc les valeurs qu'on vient d'enregistrer en local (overrides)
  // pour ne jamais réafficher un ancien champ après une sauvegarde réussie.
  const [overrides, setOverrides] = useState(null);
  const company = overrides || companyFromProp;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, company[f.key] || '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEditing() {
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, company[f.key] || ''])));
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_company_info', ...values }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || t('prospects.createErrorFallback', locale));
      return;
    }
    setEditing(false);
    setOverrides({ ...values });
    onSaved?.();
  }

  const hasAnyValue = FIELDS.some((f) => company[f.key]);

  return (
    <div className="company-info">
      <div className="header-row">
        <h3>{t('prospects.companyInfoTitle', locale)}</h3>
        {!editing && (
          <button type="button" className="link-btn" onClick={startEditing}>
            {t('common.edit', locale)}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="fields-grid">
            {FIELDS.map((f) => (
              <label key={f.key}>
                {t(f.labelKey, locale)}
                <input
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel', locale)}
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {t('common.save', locale)}
            </button>
          </div>
        </>
      ) : hasAnyValue ? (
        <div className="fields-grid read">
          {FIELDS.filter((f) => company[f.key]).map((f) => (
            <div key={f.key} className="read-field">
              <span className="read-label">{t(f.labelKey, locale)}</span>
              <span className="read-value">{company[f.key]}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{t('prospects.companyInfoEmpty', locale)}</p>
      )}

      <style jsx>{`
        .company-info {
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
        .muted {
          color: var(--muted);
          font-size: 0.82rem;
          margin: 0;
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
