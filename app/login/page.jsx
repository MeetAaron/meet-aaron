// app/login/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser, setRememberMe } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

export default function LoginPage() {
  const [locale, setLocale] = useLocale();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Lu directement depuis window.location (plutôt que useSearchParams) pour
  // éviter d'avoir à englober la page dans un <Suspense> côté build Next.js.
  useEffect(() => {
    const verified = new URLSearchParams(window.location.search).get('verified');
    if (verified === '1') {
      setMessage(t('auth.verifiedMessage', locale));
    } else if (verified === 'error') {
      setError(t('auth.verifyError', locale));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item 1/A1) : pré-remplir email +
  // mot de passe quand "se souvenir de moi" est coché. On ne stocke QUE
  // l'email nous-mêmes (pas sensible) — jamais le mot de passe en clair dans
  // notre propre stockage, ce serait un risque de sécurité inutile. Pour le
  // mot de passe, la bonne pratique est de laisser le gestionnaire de mots de
  // passe du NAVIGATEUR s'en charger (stockage chiffré côté OS/navigateur,
  // pas côté app) : voir les attributs autoComplete ajoutés sur les champs
  // ci-dessous, qui permettent au navigateur de proposer "Enregistrer le mot
  // de passe ?" et de le pré-remplir lui-même ensuite.
  useEffect(() => {
    try {
      const rememberedEmail = window.localStorage.getItem('aaron-remembered-email');
      if (rememberedEmail) setEmail(rememberedEmail);
    } catch (err) {}
  }, []);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === 'signin') {
      setRememberMe(remember);
      try {
        if (remember) {
          window.localStorage.setItem('aaron-remembered-email', email);
        } else {
          window.localStorage.removeItem('aaron-remembered-email');
        }
      } catch (err) {}
      const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      // Marque cet onglet comme "connexion explicite faite" (voir
      // components/AuthFetchInterceptor.jsx) — nécessaire même si la session
      // Supabase était déjà valide/persistée avant ce clic, pour que la porte
      // d'entrée de /app laisse passer.
      try { window.sessionStorage.setItem('aaron-explicit-login', '1'); } catch (err) {}
      window.location.href = '/onboarding';
    } else {
      const { data, error } = await supabaseBrowser.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }

      // Envoie notre propre email de confirmation via Gmail (aaron), plutôt que
      // de dépendre du mailer par défaut de Supabase (peu fiable / rate-limité).
      if (data.user) {
        const res = await fetch('/api/auth/send-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_user_id: data.user.id, email }),
        });
        if (!res.ok) {
          setMessage(t('auth.signupPartialError', locale));
          return;
        }
      }
      setMessage(t('auth.signupSuccess', locale));
    }
  }

  async function handleOAuth(provider) {
    setLoading(true);
    setError(null);
    // Voir handleEmailSubmit : on pose le marqueur dès le lancement de l'OAuth
    // (avant la redirection vers Google/Microsoft) car il n'y a pas d'autre
    // point de passage unique après un retour OAuth réussi.
    try { window.sessionStorage.setItem('aaron-explicit-login', '1'); } catch (err) {}
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
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Meet Aaron</h1>
        <p className="subtitle">
          {mode === 'signin' ? t('auth.taglineSignin', locale) : t('auth.taglineSignup', locale)}
        </p>

        <form onSubmit={handleEmailSubmit} className="form">
          <input
            type="email"
            placeholder={t('auth.emailLabel', locale)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder={t('auth.passwordLabel', locale)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            minLength={6}
          />
          {mode === 'signin' && (
            <label className="remember-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {t('auth.rememberMe', locale)}
            </label>
          )}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t('common.loading', locale) : mode === 'signin' ? t('auth.signIn', locale) : t('auth.signUp', locale)}
          </button>
        </form>

        <button className="link-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); }}>
          {mode === 'signin' ? `${t('auth.noAccount', locale)} ${t('auth.switchToSignup', locale)}` : `${t('auth.hasAccount', locale)} ${t('auth.switchToSignin', locale)}`}
        </button>

        <div className="divider"><span>{t('auth.or', locale)}</span></div>

        <button className="btn-oauth" onClick={() => handleOAuth('google')} disabled={loading}>
          {t('auth.continueWithGoogle', locale)}
        </button>
        <button className="btn-oauth" onClick={() => handleOAuth('azure')} disabled={loading}>
          {t('auth.continueWithMicrosoft', locale)}
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
        .lang-switcher {
          background: #0b0e1a;
          border: 1px solid #232744;
          color: #8b90a8;
          border-radius: 8px;
          padding: 0.35rem 0.5rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1rem;
          cursor: pointer;
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
        .remember-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #8b90a8;
          font-size: 0.82rem;
          cursor: pointer;
          text-align: left;
          padding: 0.1rem 0.1rem 0.2rem;
        }
        .remember-row input {
          width: 15px;
          height: 15px;
          accent-color: #4b39ef;
          cursor: pointer;
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
