'use client';

// components/ConnectionBadge.jsx
//
// Pastille « Connecté / Hors ligne » + déconnexion, extraite de
// app/app/dashboard/page.jsx (demande Alex, 04/09/2026 : « le bouton connecté
// à la place de la cloche en haut à droite, et donc à côté du menu »).
//
// Pourquoi la cloche disparaît de la barre du haut sur téléphone : depuis le
// 03/09, le bandeau de notifications (components/Stories.jsx, mode "strip")
// est rendu en haut du contenu de CHAQUE page par le Shell. La cloche faisait
// donc doublon — et elle occupait la seule place vraiment visible de la barre
// du haut. L'état de connexion, lui, n'était visible nulle part sur
// téléphone : c'est une information utile en déplacement (4G capricieuse,
// tunnel, avion), et c'est aussi par là qu'on se déconnecte.
//
// Le composant est autonome (aucune prop obligatoire hors `locale`) pour
// pouvoir vivre aussi bien dans la barre du haut mobile que dans l'en-tête du
// tableau de bord, sans dupliquer la logique de déconnexion.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirmLogout } from '@/lib/confirm-dialog';
import { t } from '@/lib/i18n';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';

export default function ConnectionBadge({ locale, compact = false }) {
  const [online, setOnline] = useState(true);
  // Petit menu sous la pastille. 13/11/2026 (Alex : « quand on clique sur
  // Connecté, il ne se passe rien ») : le menu existait, mais il s'ouvrait
  // DANS la barre du haut (position fixe, z-index 55), sous le bandeau de
  // stories collé juste en dessous (z-index 65) — invisible. Il est
  // maintenant rendu à la racine de la page (portail), en position fixe.
  const [menu, setMenu] = useState(null); // { top, right } | null
  const [loggingOut, setLoggingOut] = useState(false);
  const btnRef = useRef(null);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  function toggleMenu() {
    if (menu) { setMenu(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenu({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }

  async function logout() {
    setMenu(null);
    // Puis « Es-tu sûr de vouloir te déconnecter ? » (lib/confirm-dialog.js).
    if (!(await confirmLogout(locale))) return;
    setLoggingOut(true);
    await supabaseBrowser.auth.signOut();
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const label = online ? t('connectionBadge.online', locale) : t('connectionBadge.offline', locale);

  return (
    <div className="conn-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`conn-btn${compact ? ' compact' : ''}`}
        onClick={toggleMenu}
        aria-label={label}
        aria-expanded={!!menu}
        disabled={loggingOut}
      >
        <span className={`conn-dot ${online ? 'is-online' : 'is-offline'}`} />
        <span className="conn-label">{label}</span>
      </button>
      {menu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            onClick={() => setMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'transparent' }}
          />
          <div
            role="menu"
            style={{
              position: 'fixed',
              top: menu.top,
              right: menu.right,
              zIndex: 1501,
              minWidth: 190,
              background: 'var(--surface, #141a2e)',
              border: '1px solid var(--border, rgba(255,255,255,0.1))',
              borderRadius: 12,
              padding: '0.35rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-red, #ef4459)',
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.65rem 0.75rem',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('connectionBadge.logoutButton', locale)}
            </button>
          </div>
        </>,
        document.body
      )}
      <style jsx>{`
        .conn-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .conn-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.5rem 0.9rem;
          cursor: pointer;
        }
        /* Variante barre du haut mobile : la place est comptée, on garde le
           libellé (il porte l'information) mais on resserre tout autour. */
        .conn-btn.compact {
          padding: 0.34rem 0.62rem;
          gap: 0.38rem;
        }
        .conn-btn.compact .conn-label {
          font-size: 0.72rem;
        }
        .conn-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--muted);
          flex-shrink: 0;
        }
        .conn-dot.is-online {
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.16);
        }
        .conn-dot.is-offline {
          background: var(--accent-red);
          box-shadow: 0 0 0 3px rgba(239, 68, 89, 0.16);
        }
        .conn-label {
          font-size: 0.8rem;
          color: var(--muted);
          white-space: nowrap;
        }
        .conn-popover {
          position: absolute;
          top: calc(100% + 0.4rem);
          right: 0;
          width: 220px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.7rem 0.8rem;
          font-size: 0.8rem;
          color: var(--text);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
          z-index: 120;
        }
        .conn-popover p {
          margin: 0 0 0.6rem;
        }
        .conn-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
        }
        .conn-cancel {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          cursor: pointer;
        }
        .conn-confirm {
          background: var(--accent-red);
          border: none;
          color: white;
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
