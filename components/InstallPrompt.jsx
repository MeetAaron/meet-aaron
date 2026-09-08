'use client';
// components/InstallPrompt.jsx
//
// INSTALLATION SUR L'ÉCRAN D'ACCUEIL, sans magasin d'applications.
//
// Demande Alex (08/09/2026) : « pour le moment on n'aura ni iOS ni Android,
// donc il faut une solution rapide pour PWA — demander à l'utilisateur d'aller
// sur Safari et faire ci puis ça, c'est un vrai frottement ».
//
// Ce qu'on peut faire, et ce qu'on ne peut pas :
//   - Android (Chrome, Samsung Internet, Edge) et ordinateur : le navigateur
//     émet `beforeinstallprompt`. On l'intercepte et on affiche NOTRE bouton
//     « Installer » — un seul geste, l'app apparaît sur l'écran d'accueil.
//   - iPhone / iPad : Apple n'expose AUCUNE API. Le seul chemin est le menu
//     Partager de Safari → « Sur l'écran d'accueil ». On ne peut pas le
//     faire à la place de l'utilisateur ; on peut seulement réduire le
//     frottement à son minimum : un bandeau au bon moment, deux étapes, les
//     icônes exactes qu'il verra, et le fait qu'il reçoive ensuite les
//     notifications push (iOS 16.4+) comme motif de le faire.
//
// Règles d'affichage : jamais en mode standalone (déjà installé), jamais
// avant la 2e visite (l'utilisateur doit d'abord avoir vu l'app), et une
// fois refusé, on se tait 14 jours. Tout est en localStorage, dans un
// try/catch — un stockage indisponible ne doit jamais casser la page.

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { Share, SquarePlus } from 'lucide-react';

const DISMISS_KEY = 'meetaaron_install_dismissed_at';
const VISITS_KEY = 'meetaaron_visits';
const DISMISS_DAYS = 14;

function isStandalone() {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS se présente comme un Mac : on regarde aussi le tactile.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

function isSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(ua);
}

function readVisits() {
  try {
    const n = parseInt(window.localStorage.getItem(VISITS_KEY) || '0', 10) + 1;
    window.localStorage.setItem(VISITS_KEY, String(n));
    return n;
  } catch {
    return 2;
  }
}

function recentlyDismissed() {
  try {
    const at = parseInt(window.localStorage.getItem(DISMISS_KEY) || '0', 10);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export default function InstallPrompt({ locale }) {
  const [mode, setMode] = useState(null); // 'native' | 'ios' | null
  const [deferred, setDeferred] = useState(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    if (readVisits() < 2) return;

    if (isIos()) {
      // Sur iPhone, seul Safari sait installer : dans Chrome iOS ou un
      // navigateur intégré (LinkedIn, Gmail…), on n'affiche rien plutôt
      // que d'envoyer vers un menu qui n'existe pas.
      if (isSafari()) setMode('ios');
      return;
    }

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setMode('native');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // silencieux
    }
    setMode(null);
  }

  async function install() {
    if (!deferred) return;
    setInstalling(true);
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') setMode(null);
      else dismiss();
    } catch {
      dismiss();
    } finally {
      setInstalling(false);
      setDeferred(null);
    }
  }

  if (!mode) return null;

  return (
    <div className="install-banner" role="region" aria-label={t('install.title', locale)}>
      <div className="install-icon" aria-hidden="true">
        <img src="/icon.png" alt="" />
      </div>
      <div className="install-body">
        <p className="install-title">{t('install.title', locale)}</p>
        {mode === 'native' ? (
          <p className="install-text">{t('install.nativeText', locale)}</p>
        ) : (
          <ol className="install-steps">
            <li>
              <span className="install-step-icon"><Share size={14} strokeWidth={2.2} aria-hidden="true" /></span>
              {t('install.iosStep1', locale)}
            </li>
            <li>
              <span className="install-step-icon"><SquarePlus size={14} strokeWidth={2.2} aria-hidden="true" /></span>
              {t('install.iosStep2', locale)}
            </li>
          </ol>
        )}
      </div>
      <div className="install-actions">
        {mode === 'native' && (
          <button type="button" className="install-cta" onClick={install} disabled={installing}>
            {installing ? '…' : t('install.cta', locale)}
          </button>
        )}
        <button type="button" className="install-dismiss" onClick={dismiss} aria-label={t('install.later', locale)}>
          {t('install.later', locale)}
        </button>
      </div>

      <style jsx>{`
        .install-banner {
          display: flex;
          align-items: center;
          gap: 0.9rem;
          padding: 0.85rem 1rem;
          margin: 0 0 1rem;
          border-radius: 14px;
          background: var(--surface);
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
        }
        .install-icon img {
          width: 44px;
          height: 44px;
          border-radius: 11px;
          display: block;
        }
        .install-body {
          flex: 1;
          min-width: 0;
        }
        .install-title {
          margin: 0 0 0.15rem;
          font-weight: 600;
          color: var(--text);
          font-size: 0.95rem;
        }
        .install-text {
          margin: 0;
          color: var(--muted);
          font-size: 0.85rem;
          line-height: 1.4;
        }
        .install-steps {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          color: var(--muted);
          font-size: 0.85rem;
        }
        .install-steps li {
          display: flex;
          align-items: center;
          gap: 0.45rem;
        }
        .install-step-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: var(--tint-8);
          color: var(--text);
          flex-shrink: 0;
        }
        .install-actions {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          align-items: stretch;
        }
        .install-cta {
          border: 0;
          border-radius: 10px;
          padding: 0.55rem 0.9rem;
          background: var(--accent, #4b39ef);
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .install-cta:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .install-dismiss {
          border: 0;
          background: transparent;
          color: var(--muted);
          font-size: 0.8rem;
          cursor: pointer;
          padding: 0.2rem;
        }
        @media (max-width: 600px) {
          .install-banner {
            flex-wrap: wrap;
          }
          .install-actions {
            flex-direction: row;
            width: 100%;
            justify-content: flex-end;
          }
        }
      `}</style>
    </div>
  );
}
