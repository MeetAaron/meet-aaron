// app/onboarding/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('');
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function checkExisting() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      setSession(session);
      setFullName(session.user.user_metadata?.full_name || '');

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });

      if (res.ok) {
        router.push('/app/dashboard');
        return;
      }

      setChecking(false);
    }

    checkExisting();
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!attested) {
      setError('Merci de confirmer la case ci-dessous avant de continuer.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_user_id: session.user.id,
        email: session.user.email,
        full_name: fullName,
        company_name: companyName,
        country,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok || !body.url) {
      setError(body.error || 'Une erreur est survenue');
      return;
    }

    window.location.href = body.url;
  }

  if (checking) {
    return (
      <div className="wrap">
        <p className="loading-text">Chargement…</p>
        <style jsx>{`
          .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; }
          .loading-text { color: #8b90a8; font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="wrap">
      <form className="card" onSubmit={handleSubmit}>
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Créez votre espace Meet Aaron</h1>
        <p className="subtitle">Quelques infos, puis direction le paiement pour activer votre compte.</p>

        <label>
          Votre nom complet
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>

        <label>
          Nom de votre société
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ex: Open X" required />
        </label>

        <label>
          Pays de votre société
          <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ex: France" required />
        </label>

        <div className="plan-box">
          <span className="plan-name">Aaron Prospect</span>
          <span className="plan-price">30€ / mois</span>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          <span>Je certifie être autorisé(e) par mon entreprise à créer ce compte et à partager les documents commerciaux nécessaires au fonctionnement d'Aaron.</span>
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Redirection…' : 'Continuer vers le paiement'}
        </button>
      </form>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          font-family: 'Inter', sans-serif;
          padding: 2rem 1rem;
        }
        .card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 16px;
          padding: 2.2rem;
          width: 420px;
          max-width: 100%;
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
          font-size: 1.35rem;
          margin: 0 0 0.4rem;
        }
        .subtitle {
          color: #8b90a8;
          font-size: 0.86rem;
          margin: 0 0 1.4rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: #8b90a8;
          margin-bottom: 1rem;
        }
        input[type='text'], input:not([type]) {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: #f4f1ea;
          font-size: 0.88rem;
        }
        .plan-box {
          background: rgba(75, 57, 239, 0.1);
          border: 1px solid #4b39ef;
          border-radius: 10px;
          padding: 0.8rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.2rem;
        }
        .plan-name {
          color: #f4f1ea;
          font-weight: 600;
          font-size: 0.9rem;
        }
        .plan-price {
          color: #4b39ef;
          font-weight: 700;
          font-size: 0.9rem;
        }
        .checkbox-row {
          flex-direction: row;
          align-items: flex-start;
          gap: 0.6rem;
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .checkbox-row input {
          margin-top: 0.2rem;
          flex-shrink: 0;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
          margin-bottom: 1rem;
        }
        .btn-primary {
          width: 100%;
          background: #4b39ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
