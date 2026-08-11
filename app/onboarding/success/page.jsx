// app/onboarding/success/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function OnboardingSuccessPage() {
  const router = useRouter();
  const [status, setStatus] = useState('waiting');

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function tryLink() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session || cancelled) return;

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });

      if (res.ok) {
        router.push('/app/chat?welcome=1');
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
        {status === 'waiting' ? (
          <>
            <h1>Paiement confirmé !</h1>
            <p className="subtitle">On prépare votre espace, un instant…</p>
            <div className="spinner" />
          </>
        ) : (
          <>
            <h1>Ça prend un peu plus de temps que prévu</h1>
            <p className="subtitle">Rechargez cette page dans quelques secondes, ou contactez-nous si le problème persiste.</p>
          </>
        )}
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
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
