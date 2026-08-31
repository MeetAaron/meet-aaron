// components/ExportFormatMenu.jsx
//
// Petit bouton avec menu déroulant (CSV recommandé / Excel) utilisé partout
// où l'utilisateur choisit un format de fichier — export de la base de
// données gérée par Aaron et téléchargement d'un modèle vierge, dans
// Prospects/Opportunités/Clients (demande Alex 2026-08-25 : "aaron demande
// si il s'agit d'un csv (recommandé) ou xls (excel)"). Partagé comme
// CsvImportModal/NavIcon pour éviter de dupliquer 3 fois (une par page) une
// même petite mécanique d'ouverture/fermeture de menu.

'use client';

import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '@/lib/i18n';

export default function ExportFormatMenu({ label, onChoose, disabled, variant }) {
  const [locale] = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function choose(format) {
    setOpen(false);
    onChoose(format);
  }

  return (
    <div className="export-format-menu" ref={wrapRef}>
      <button type="button" className={variant === 'link' ? 'trigger-link' : 'trigger-btn'} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="menu">
          <button type="button" onClick={() => choose('csv')}>
            {t('exportFormat.csv', locale)}
          </button>
          <button type="button" onClick={() => choose('xlsx')}>
            {t('exportFormat.xlsx', locale)}
          </button>
        </div>
      )}
      <style jsx>{`
        .export-format-menu {
          position: relative;
          display: inline-block;
        }
        /* Bug remonté par Alex (25/08/2026, capture à l'appui) : le bouton
           déclencheur porte la classe "btn-secondary" mais celle-ci n'est
           définie que dans le <style jsx> scopé de CHAQUE page qui utilise ce
           composant (Prospects, Opportunités, Clients) — styled-jsx isole ses
           règles au composant où elles sont écrites, elles ne s'appliquent
           jamais à un composant enfant importé comme celui-ci. Le bouton se
           retrouvait donc sans aucune mise en forme (ni fond, ni bordure), ce
           qui le faisait ressembler à du texte brut à côté des vrais boutons
           ("Importer un fichier", "+ Ajouter..."). On redéfinit ici la même
           apparence que .btn-secondary, en local, pour ne plus dépendre du
           CSS scopé de la page parente. */
        .trigger-btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.5rem 1rem;
          font-size: 0.82rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .trigger-btn:hover:not(:disabled) {
          color: var(--text);
          border-color: var(--text);
        }
        .trigger-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        /* variant="link" (fusion pipeline, 31/08/2026) : « modèle vierge »
           en simple lien souligné sous le bouton d'import. */
        .trigger-link {
          background: none;
          border: none;
          padding: 0;
          color: var(--accent-light);
          font-size: inherit;
          font-family: inherit;
          text-decoration: underline;
          cursor: pointer;
        }
        .menu {
          position: absolute;
          top: calc(100% + 0.3rem);
          left: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
          padding: 0.35rem;
          z-index: 50;
          min-width: 170px;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .menu button {
          background: none;
          border: none;
          color: var(--text);
          text-align: left;
          padding: 0.5rem 0.6rem;
          border-radius: var(--radius-sm);
          font-size: 0.82rem;
          cursor: pointer;
        }
        .menu button:hover {
          background: var(--bg);
        }
      `}</style>
    </div>
  );
}
