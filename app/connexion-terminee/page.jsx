'use client';
// app/connexion-terminee/page.jsx
//
// Page PUBLIQUE d'arrivée après un consentement Gmail / Outlook lancé depuis
// l'application iOS (coque Capacitor, dossier ios-app/). Google et Microsoft
// refusent leurs écrans de consentement dans une WebView : l'app les ouvre
// donc dans Safari (lib/native-app.js, openExternal). À la fin, Safari n'a
// pas la session de l'app — renvoyer vers /app/connexions afficherait l'écran
// de connexion. On atterrit ici, et on dit simplement de revenir dans l'app ;
// l'app, elle, recharge Connexions quand Safari se ferme
// (components/NativeAppBridge.jsx).
//
// Paramètres (posés par app/api/auth/{google,microsoft}/callback) :
//   oauth_success=<provider>  ou  oauth_error=<code>

import { useEffect, useState } from 'react';
import { t, useLocale } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

export default function ConnexionTermineePage() {
  const [locale] = useLocale();
  const [ok, setOk] = useState(true);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setOk(!params.get('oauth_error'));
    } catch {
      setOk(true);
    }
  }, []);

  return (
    <main className="done">
      <div className="card">
        <div className={`mark${ok ? '' : ' ko'}`}>
          <Ic name={ok ? 'check' : 'x'} />
        </div>
        <h1>{t(ok ? 'native.doneTitle' : 'native.errorTitle', locale)}</h1>
        <p>{t(ok ? 'native.doneBody' : 'native.errorBody', locale)}</p>
        {/* Lien universel : si l'app est installée et le domaine associé, iOS
            l'ouvre directement ; sinon le site s'ouvre, sans rien casser. */}
        <a className="back" href="https://meetaaron.app/app/connexions?tab=connection">
          {t('native.backToApp', locale)}
        </a>
      </div>
      <style jsx>{`
        .done {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: var(--bg, #0b0e1a);
          color: var(--text, #f3f4f8);
        }
        .card {
          max-width: 420px;
          width: 100%;
          text-align: center;
          background: var(--card, #141a2e);
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          border-radius: 16px;
          padding: 2rem 1.5rem;
        }
        .mark {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          margin: 0 auto 1rem;
          display: grid;
          place-items: center;
          background: rgba(46, 204, 113, 0.15);
          color: var(--accent-green, #2ecc71);
        }
        .mark.ko {
          background: rgba(229, 72, 77, 0.15);
          color: #e5484d;
        }
        h1 {
          font-size: 1.3rem;
          margin: 0 0 0.6rem;
        }
        p {
          color: var(--muted, #a3a9c2);
          font-size: 0.95rem;
          line-height: 1.5;
          margin: 0 0 1.4rem;
        }
        .back {
          display: inline-block;
          background: var(--accent, #5b6cff);
          color: #fff;
          text-decoration: none;
          border-radius: 10px;
          padding: 0.7rem 1.2rem;
          font-weight: 600;
        }
      `}</style>
    </main>
  );
}
