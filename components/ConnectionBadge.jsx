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

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';

export default function ConnectionBadge({ locale, compact = false }) {
  const [online, setOnline] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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

  async function confirmLogout() {
    setLoggingOut(true);
    await supabaseBrowser.auth.signOut();
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const label = online ? t('connectionBadge.online', locale) : t('connectionBadge.offline', locale);

  return (
    <div className="conn-wrap">
      <button
        type="button"
        className={`conn-btn${compact ? ' compact' : ''}`}
        onClick={() => setShowConfirm((v) => !v)}
        aria-label={label}
      >
        <span className={`conn-dot ${online ? 'is-online' : 'is-offline'}`} />
        <span className="conn-label">{label}</span>
      </button>
      {showConfirm && (
        <div className="conn-popover" role="dialog">
          <p>{t('connectionBadge.confirmLogout', locale)}</p>
          <div className="conn-actions">
            <button type="button" className="conn-cancel" onClick={() => setShowConfirm(false)}>{t('common.cancel', locale)}</button>
            <button type="button" className="conn-confirm" disabled={loggingOut} onClick={confirmLogout}>
              {loggingOut ? '…' : t('connectionBadge.logoutButton', locale)}
            </button>
          </div>
        </div>
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
