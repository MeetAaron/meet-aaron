'use client';

// components/ActionMenu.jsx
//
// UN bouton principal qui ouvre un menu d'actions (Alex, 04/09/2026, page
// Contacts : « ajouter un prospect manuellement, télécharger fichier contact,
// importer fichier contact — là c'est moche, ça éparpille. On veut du punch
// et une facilité d'utilisation »).
//
// Avant : trois boutons de trois styles différents, plus une phrase d'aide
// et un lien « modèle vierge », étalés sur deux lignes dans l'en-tête. On
// cherchait l'action au lieu de la faire. Maintenant : un seul bouton
// « + Ajouter », dégradé, et tout le reste dans un menu — le geste qu'on
// connaît de Gmail, Notion, Linear.
//
// Composant PUR (aucun import serveur). Les libellés sont fournis par la page
// (elle connaît la langue), le composant ne fait que la mécanique.
//
//   items : [{ key, label, hint?, icon?, onSelect, danger? }]
//   Un séparateur : { key: 'sep-1', separator: true }

import { useEffect, useRef, useState } from 'react';

export default function ActionMenu({ label, items, align = 'right', primary = true }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={wrapRef}>
      <button
        type="button"
        className={primary ? 'btn-primary' : 'btn-secondary'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <svg className={`caret${open ? ' up' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={`menu ${align}`} role="menu">
          {items.map((it) =>
            it.separator ? (
              <span key={it.key} className="sep" role="separator" />
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`item${it.danger ? ' danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect && it.onSelect();
                }}
              >
                {it.icon && <span className="ic" aria-hidden="true">{it.icon}</span>}
                <span className="txt">
                  <span className="lbl">{it.label}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                </span>
              </button>
            )
          )}
        </div>
      )}

      <style jsx>{`
        .action-menu {
          position: relative;
          display: inline-block;
        }
        /* Le bouton porte les classes globales .btn-primary / .btn-secondary
           (app/globals.css) : même apparence que partout ailleurs. */
        .caret {
          margin-left: 0.15rem;
          transition: transform 0.15s ease;
        }
        .caret.up {
          transform: rotate(180deg);
        }
        .menu {
          position: absolute;
          top: calc(100% + 6px);
          min-width: 260px;
          padding: 0.35rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
          z-index: 80;
          display: flex;
          flex-direction: column;
        }
        .menu.right { right: 0; }
        .menu.left { left: 0; }
        .item {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          width: 100%;
          padding: 0.6rem 0.7rem;
          background: transparent;
          border: 0;
          border-radius: 10px;
          color: var(--text);
          font-family: inherit;
          font-size: 0.86rem;
          text-align: left;
          cursor: pointer;
        }
        .item:hover:not(:disabled) {
          background: var(--tint-6);
        }
        .item:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .item.danger { color: var(--accent-red); }
        .ic {
          width: 30px;
          height: 30px;
          border-radius: 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(75, 57, 239, 0.14);
          color: var(--accent-light);
          flex-shrink: 0;
          font-size: 0.95rem;
        }
        .txt {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .lbl { font-weight: 600; }
        .hint {
          font-size: 0.72rem;
          color: var(--muted);
        }
        .sep {
          height: 1px;
          background: var(--border);
          margin: 0.3rem 0.4rem;
        }
        @media (max-width: 600px) {
          .menu {
            position: fixed;
            left: 0.8rem;
            right: 0.8rem;
            top: auto;
            bottom: calc(96px + env(safe-area-inset-bottom, 0px));
            min-width: 0;
          }
        }
      `}</style>
    </div>
  );
}
