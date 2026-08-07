// app/login/page.jsx
'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/app/dashboard`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Meet Aaron</h1>
        <p className="subtitle">Connectez-vous pour accéder à votre espace commercial.</p>

        <button className="btn-google" onClick={handleGoogleLogin} disabled={loading}>
          {loading ? 'Connexion…' : 'Se connecter avec Google'}
        </button>

        {error && <p className="error">{error}</p>}
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
        }
        .card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 16px;
          padding: 2.5rem;
          width: 360px;
          max-width: 90vw;
          text-align: center;
        }
        .logo {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          margin-bottom: 1rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-size: 1.4rem;
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: #8b90a8;
          font-size: 0.88rem;
          margin: 0 0 1.8rem;
        }
        .btn-google {
          width: 100%;
          background: #4b39ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.8rem 1rem;
          font-weight: 600;
          font-size: 0.92rem;
          cursor: pointer;
        }
        .btn-google:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
          margin-top: 1rem;
        }
      `}</style>
    </div>
  );
}
