// app/onboarding/success/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useLocale } from '@/lib/i18n';

// 7 langues (06/11/2026, retour Alex : « tout n'est pas traduit »).
const SUCCESS_TEXT = {
  "fr": {
    "backToApp": "Ton espace est prêt. Retourne dans l'application Meet Aaron, ou connecte-toi sur ce site.",
    "signin": "Se connecter",
    "paid": "Paiement confirmé !",
    "preparing": "On prépare votre espace, un instant…",
    "slow": "Ça prend un peu plus de temps que prévu",
    "retry": "Rechargez cette page dans quelques secondes, ou contactez-nous si le problème persiste."
  },
  "en": {
    "backToApp": "Your space is ready. Go back to the Meet Aaron app, or sign in on this website.",
    "signin": "Sign in",
    "paid": "Payment confirmed!",
    "preparing": "We are preparing your space, one moment…",
    "slow": "This is taking a little longer than expected",
    "retry": "Reload this page in a few seconds, or contact us if the problem persists."
  },
  "de": {
    "backToApp": "Dein Bereich ist bereit. Kehre in die Meet-Aaron-App zurück oder melde dich auf dieser Website an.",
    "signin": "Anmelden",
    "paid": "Zahlung bestätigt!",
    "preparing": "Wir richten Ihren Bereich ein, einen Moment…",
    "slow": "Das dauert etwas länger als erwartet",
    "retry": "Laden Sie diese Seite in ein paar Sekunden neu, oder kontaktieren Sie uns, falls das Problem bleibt."
  },
  "it": {
    "backToApp": "Il tuo spazio è pronto. Torna nell'app Meet Aaron o accedi su questo sito.",
    "signin": "Accedi",
    "paid": "Pagamento confermato!",
    "preparing": "Stiamo preparando il tuo spazio, un attimo…",
    "slow": "Ci vuole un po' più del previsto",
    "retry": "Ricarica questa pagina tra qualche secondo, o contattaci se il problema persiste."
  },
  "es": {
    "backToApp": "Tu espacio está listo. Vuelve a la aplicación Meet Aaron o inicia sesión en este sitio.",
    "signin": "Iniciar sesión",
    "paid": "¡Pago confirmado!",
    "preparing": "Estamos preparando tu espacio, un momento…",
    "slow": "Está tardando un poco más de lo previsto",
    "retry": "Recarga esta página en unos segundos o contáctanos si el problema persiste."
  },
  "pt": {
    "backToApp": "O teu espaço está pronto. Volta à aplicação Meet Aaron ou inicia sessão neste site.",
    "signin": "Iniciar sessão",
    "paid": "Pagamento confirmado!",
    "preparing": "Estamos a preparar o teu espaço, um instante…",
    "slow": "Está a demorar um pouco mais do que o previsto",
    "retry": "Recarrega esta página dentro de alguns segundos, ou contacta-nos se o problema persistir."
  },
  "nl": {
    "backToApp": "Je omgeving staat klaar. Ga terug naar de Meet Aaron-app of log in op deze website.",
    "signin": "Inloggen",
    "paid": "Betaling bevestigd!",
    "preparing": "We maken je omgeving klaar, een ogenblik…",
    "slow": "Dit duurt iets langer dan verwacht",
    "retry": "Laad deze pagina over enkele seconden opnieuw, of neem contact met ons op als het probleem aanhoudt."
  }
};
const sx = (key, locale) => (SUCCESS_TEXT[locale] || SUCCESS_TEXT.fr)[key] ?? SUCCESS_TEXT.fr[key];

export default function OnboardingSuccessPage() {
  const router = useRouter();
  const [locale] = useLocale();
  const [status, setStatus] = useState('waiting');
  // Paiement fait depuis le lien de l'email d'activation (inscription dans
  // l'application, 17/11/2026) : on est dans le navigateur, sans session.
  // Le webhook Stripe crée l'espace ; il suffit de rouvrir l'app.

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function tryLink() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setStatus('noSession');
        return;
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });

      if (res.ok) {
        // Parcours de première connexion (22/10/2026) : plus d'arrivée dans le chat.
        router.push('/app/bienvenue');
        return;
      }

      attempts += 1;
      if (attempts >= 15) {
        setStatus('timeout');
        return;
      }

      setTimeout(tryLink, 1000);
    }

    tryLink();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="wrap">
      <div className="card">
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        {status === 'noSession' ? (
          <>
            <h1>{sx('paid', locale)}</h1>
            <p className="subtitle">{sx('backToApp', locale)}</p>
            <a className="signin-link" href="/login">{sx('signin', locale)}</a>
          </>
        ) : status === 'waiting' ? (
          <>
            <h1>{sx('paid', locale)}</h1>
            <p className="subtitle">{sx('preparing', locale)}</p>
            <div className="spinner" />
          </>
        ) : (
          <>
            <h1>{sx('slow', locale)}</h1>
            <p className="subtitle">{sx('retry', locale)}</p>
          </>
        )}
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .signin-link {
          display: inline-block;
          margin-top: 0.4rem;
          background: #4b39ef;
          color: #fff;
          text-decoration: none;
          border-radius: 10px;
          padding: 0.7rem 1.2rem;
          font-weight: 600;
        }
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          font-family: 'Inter', sans-serif;
          padding: 1rem;
        }
        .card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 16px;
          padding: 2.5rem;
          width: 400px;
          max-width: 100%;
          text-align: center;
        }
        .logo {
          width: 44px;
          height: 44px;
          border-radius: 11px;
          margin-bottom: 1rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-size: 1.2rem;
          margin: 0 0 0.6rem;
        }
        .subtitle {
          color: #8b90a8;
          font-size: 0.86rem;
          margin: 0 0 1.4rem;
          line-height: 1.5;
        }
        .spinner {
          width: 28px;
          height: 28px;
          border: 3px solid #232744;
          border-top-color: #4b39ef;
          border-radius: 50%;
          margin: 0 auto;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
