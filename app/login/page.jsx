// app/login/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser, setRememberMe, markExplicitLoginToday, rememberPostLoginNext } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

export default function LoginPage() {
  const [locale, setLocale] = useLocale();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot' | 'reset'
  // « Mot de passe oublié ? » (31/08/2026) — voir app/api/auth/request-
  // password-reset et reset-password : lien reçu par email → ?reset=<jeton>.
  const [resetToken, setResetToken] = useState(null);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  // Bug remonté par Alex (27/08/2026, compte de son père) : l'email de
  // confirmation peut échouer à l'envoi (voir /api/auth/send-verification,
  // dépend de la connexion Gmail d'un seul commercial — SYSTEM_EMAIL_SENDER_
  // USER_ID) alors que le message de fin d'inscription affirme à tort qu'on
  // peut se connecter tout de suite (voir /api/auth/verify-email, commentaire
  // en tête de fichier) : tant que Supabase "Confirm email" est activé
  // (réglage par défaut du projet), signInWithPassword échoue avec "Email not
  // confirmed" tant que ce lien n'a pas été cliqué — et sans lui, la personne
  // reste bloquée sans aucun moyen de s'en sortir seule. Ce nouvel état
  // détecte précisément cette erreur pour proposer un renvoi immédiat.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState(null);

  // Lu directement depuis window.location (plutôt que useSearchParams) pour
  // éviter d'avoir à englober la page dans un <Suspense> côté build Next.js.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    if (verified === '1') {
      setMessage(t('auth.verifiedMessage', locale));
    } else if (verified === 'error') {
      setError(t('auth.verifyError', locale));
    }
    // ?next=/app/… (posé par AuthFetchInterceptor) : page à rouvrir après
    // connexion — consommée par /onboarding, voir lib/supabase-browser.ts.
    rememberPostLoginNext(params.get('next'));
    const reset = params.get('reset');
    if (reset && /^[a-f0-9]{64}$/.test(reset)) {
      setResetToken(reset);
      setMode('reset');
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
    setUnconfirmedEmail(null);
    setResendMessage(null);

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
        // "Email not confirmed" : message exact renvoyé par Supabase Auth
        // (GoTrue) quand "Confirm email" est activé côté projet et que le
        // lien de confirmation n'a jamais été cliqué (voir commentaire plus
        // haut). On propose un renvoi immédiat plutôt que de laisser la
        // personne bloquée avec une simple erreur.
        if (/email not confirmed/i.test(error.message)) {
          setUnconfirmedEmail(email);
        } else {
          setError(error.message);
        }
        setLoading(false);
        return;
      }
      // Marque la date du jour comme "connexion explicite faite" (voir
      // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) —
      // nécessaire même si la session Supabase était déjà valide/persistée
      // avant ce clic, pour que la porte d'entrée de /app laisse passer. Reste
      // valide jusqu'à minuit (heure locale), donc les visites suivantes ce
      // même jour n'auront pas besoin de repasser par cet écran.
      markExplicitLoginToday();
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

  async function handleResendVerification() {
    setResendBusy(true);
    setResendMessage(null);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unconfirmedEmail }),
      });
      if (!res.ok) {
        setResendMessage(t('auth.resendError', locale));
      } else {
        setResendMessage(t('auth.resendSuccess', locale));
      }
    } catch (err) {
      setResendMessage(t('auth.resendError', locale));
    } finally {
      setResendBusy(false);
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || t('auth.resetGenericError', locale));
      } else {
        setMessage(t('auth.resetLinkSent', locale));
      }
    } catch (err) {
      setError(t('auth.resetGenericError', locale));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    if (password !== passwordConfirm) {
      setError(t('auth.resetMismatch', locale));
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || t('auth.resetGenericError', locale));
      } else {
        setMessage(t('auth.resetDone', locale));
        setMode('signin');
        setPassword('');
        setPasswordConfirm('');
        setResetToken(null);
        try {
          window.history.replaceState(null, '', '/login');
        } catch (err) {}
      }
    } catch (err) {
      setError(t('auth.resetGenericError', locale));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider) {
    setLoading(true);
    setError(null);
    // Voir handleEmailSubmit : on pose le marqueur dès le lancement de l'OAuth
    // (avant la redirection vers Google/Microsoft) car il n'y a pas d'autre
    // point de passage unique après un retour OAuth réussi.
    markExplicitLoginToday();
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
          {mode === 'signin'
            ? t('auth.taglineSignin', locale)
            : mode === 'signup'
            ? t('auth.taglineSignup', locale)
            : mode === 'forgot'
            ? t('auth.forgotTagline', locale)
            : t('auth.resetTagline', locale)}
        </p>

        {mode === 'forgot' && (
          <form onSubmit={handleForgotSubmit} className="form">
            <input
              type="email"
              placeholder={t('auth.emailLabel', locale)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t('common.loading', locale) : t('auth.forgotSubmit', locale)}
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleResetSubmit} className="form">
            <input
              type="password"
              placeholder={t('auth.resetNewPassword', locale)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
            <input
              type="password"
              placeholder={t('auth.resetConfirmPassword', locale)}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t('common.loading', locale) : t('auth.resetSubmit', locale)}
            </button>
          </form>
        )}

        {(mode === 'signin' || mode === 'signup') && (
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
        )}

        {mode === 'signin' && (
          <button className="link-toggle forgot-link" onClick={() => { setMode('forgot'); setError(null); setMessage(null); }}>
            {t('auth.forgotLink', locale)}
          </button>
        )}

        {(mode === 'forgot' || mode === 'reset') ? (
          <button className="link-toggle" onClick={() => { setMode('signin'); setError(null); setMessage(null); }}>
            {t('auth.backToSignin', locale)}
          </button>
        ) : (
          <button className="link-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); setUnconfirmedEmail(null); setResendMessage(null); }}>
            {mode === 'signin' ? `${t('auth.noAccount', locale)} ${t('auth.switchToSignup', locale)}` : `${t('auth.hasAccount', locale)} ${t('auth.switchToSignin', locale)}`}
          </button>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <>
            <div className="divider"><span>{t('auth.or', locale)}</span></div>

            {/* « Continuer avec Google » retiré le 02/09/2026.
                Raison : ce parcours passait par Supabase Auth, donc par
                l'URL ftssujspaoliheynbhpq.supabase.co/auth/v1/callback. Google
                exige que tout domaine utilisé par une redirection figure dans
                les « domaines autorisés » de l'écran de consentement — et la
                VÉRIFICATION de l'application (scopes restreints Gmail) exige
                de prouver la propriété de chacun de ces domaines via Search
                Console. Impossible pour supabase.co : ce domaine bloquait donc
                la vérification à terme.
                La connexion Gmail/Agenda d'Aaron n'est PAS concernée : elle a
                son propre parcours OAuth sur meetaaron.app/api/auth/google/
                callback (voir app/api/auth/google/route.ts), qui reste actif.
                Pour rétablir ce bouton un jour : prendre le domaine
                personnalisé Supabase (auth.meetaaron.app), puis remettre ce
                bloc et réactiver le fournisseur Google côté Supabase. */}
            <button className="btn-oauth" onClick={() => handleOAuth('azure')} disabled={loading}>
              {t('auth.continueWithMicrosoft', locale)}
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        {unconfirmedEmail && (
          <div className="unconfirmed-box">
            <p className="error">{t('auth.unconfirmedError', locale)}</p>
            <button type="button" className="link-toggle" onClick={handleResendVerification} disabled={resendBusy}>
              {resendBusy ? t('common.loading', locale) : t('auth.resendButton', locale)}
            </button>
            {resendMessage && <p className="success">{resendMessage}</p>}
          </div>
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
        .forgot-link {
          margin-top: -0.3rem;
          font-size: 0.8rem;
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
        .unconfirmed-box {
          margin-top: 0.4rem;
          text-align: center;
        }
        .unconfirmed-box .error {
          margin-top: 0.2rem;
        }
        .unconfirmed-box .link-toggle {
          margin-top: 0.4rem;
        }
      `}</style>
    </div>
  );
}
