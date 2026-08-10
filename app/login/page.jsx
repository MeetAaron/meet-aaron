// app/login/page.jsx
'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === 'signin') {
      const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      window.location.href = '/onboarding';
    } else {
      const { error } = await supabaseBrowser.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/onboarding` },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      setMessage('Compte créé ! Vérifiez votre boîte mail pour confirmer votre adresse avant de vous connecter.');
    }
  }

  async function handleOAuth(provider) {
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/onboarding` },
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
        <p className="subtitle">
          {mode === 'signin' ? 'Connectez-vous à votre espace commercial.' : 'Créez votre compte.'}
        </p>

        <form onSubmit={handleEmailSubmit} className="form">
          <input
            type="email"
            placeholder="Adresse email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Chargement…' : mode === 'signin' ? 'Se connecter' : 'Créer un compte'}
          </button>
        </form>

        <button className="link-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); }}>
          {mode === 'signin' ? "Pas encore de compte ? Créer un compte" : 'Déjà un compte ? Se connecter'}
        </button>

        <div className="divider"><span>ou</span></div>

        <button className="btn-oauth" onClick={() => handleOAuth('google')} disabled={loading}>
          Continuer avec Google
        </button>
        <button className="btn-oauth" onClick={() => handleOAuth('azure')} disabled={loading}>
          Continuer avec Microsoft
        </button>

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
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
          padding: 2.2rem;
          width: 380px;
          max-width: 100%;
          text-align: center;
        }
        .logo {
          width: 44px;
          height: 44px;
          border-radius: 11px;
          margin-bottom: 0.9rem;
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
        .form {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          margin-bottom: 0.8rem;
        }
        .form input {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 8px;
          padding: 0.65rem 0.9rem;
          color: #f4f1ea;
          font-size: 0.88rem;
        }
        .btn-primary {
          width: 100%;
          background: #4b39ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.7rem 1rem;
          font-weight: 600;
          font-size: 0.88rem;
          cursor: pointer;
          margin-top: 0.2rem;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .link-toggle {
          background: none;
          border: none;
          color: #8b90a8;
          font-size: 0.78rem;
          cursor: pointer;
          text-decoration: underline;
          margin-bottom: 1.2rem;
        }
        .divider {
          display: flex;
          align-items: center;
          color: #8b90a8;
          font-size: 0.76rem;
          margin: 0.6rem 0 1rem;
        }
        .divider::before, .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #232744;
        }
        .divider span {
          padding: 0 0.7rem;
        }
        .btn-oauth {
          width: 100%;
          background: #0b0e1a;
          border: 1px solid #232744;
          color: #f4f1ea;
          border-radius: 10px;
          padding: 0.65rem 1rem;
          font-size: 0.86rem;
          cursor: pointer;
          margin-bottom: 0.5rem;
        }
        .btn-oauth:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          color: #e5484d;
          font-size: 0.8rem;
          margin-top: 1rem;
        }
        .success {
          color: #3dd68c;
          font-size: 0.8rem;
          margin-top: 1rem;
        }
      `}</style>
    </div>
  );
}
