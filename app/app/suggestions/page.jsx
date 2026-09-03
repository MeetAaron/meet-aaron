// app/app/suggestions/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      const body = await res.json();

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }

      setUserId(body.user.id);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, authLoading, authError };
}

export default function SuggestionsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Bug remonté par Alex (2026-08-19) : le titre "Accès non autorisé" s'affichait
  // pour N'IMPORTE QUELLE erreur de /api/feedback (401 session invalide, 500
  // hoquet serveur, coupure réseau, qui n'était même pas gérée du tout avant ce
  // correctif), pas seulement pour un vrai refus de rôle (403). Voir le même
  // correctif sur app/app/team/page.jsx.
  const [loadErrorStatus, setLoadErrorStatus] = useState(null);
  const [locale] = useLocale();

  function loadFeedback() {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    setLoadErrorStatus(null);
    fetch(`/api/feedback?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, status: r.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          setLoadError(body.error);
          setLoadErrorStatus(status);
        } else {
          setFeedback(body.feedback || []);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoadError(t('preferences.loadError', locale));
        setLoadErrorStatus(null);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--muted); font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--accent-red); font-family: 'Inter', sans-serif; text-align: center; padding: 2rem; }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active={t('nav.suggestions', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('suggestions.eyebrow', locale)}</p>
        <h1>{t('nav.suggestions', locale)}</h1>
        <p className="subtitle">
          {t('suggestions.subtitle', locale)}
        </p>
      </header>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : loadError ? (
        <div>
          <EmptyState
            title={loadErrorStatus === 403 ? t('suggestions.accessDenied', locale) : t('preferences.loadError', locale)}
            body={loadError}
          />
          <button type="button" onClick={loadFeedback} style={{ marginTop: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.2rem', fontSize: '0.86rem', cursor: 'pointer' }}>
            {t('common.retry', locale)}
          </button>
        </div>
      ) : feedback.length === 0 ? (
        <EmptyState title={t('suggestions.emptyTitle', locale)} body={t('suggestions.emptyBody', locale)} />
      ) : (
        <div className="list">
          {feedback.map((f) => (
            <div className="card" key={f.id}>
              <div className="card-top">
                <span className="author">{f.users?.full_name || t('suggestions.defaultAuthor', locale)}</span>
                <span className={`source-badge ${f.source === 'chat_auto' ? 'auto' : 'manual'}`}>
                  {f.source === 'chat_auto' ? t('suggestions.sourceAuto', locale) : t('suggestions.sourceManual', locale)}
                </span>
                <span className="date">{new Date(f.created_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
              <p className="message">{f.message}</p>
              {f.context && f.context !== f.message && (
                <p className="context">« {f.context} »</p>
              )}
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.8rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.86rem;
          max-width: 620px;
          margin: 0;
        }
        .muted {
          color: var(--muted);
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          max-width: 720px;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1.1rem 1.3rem;
        }
        .card-top {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.6rem;
        }
        .author {
          font-weight: 600;
          font-size: 0.88rem;
        }
        .source-badge {
          font-size: 0.72rem;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .source-badge.auto {
          border-color: var(--accent);
          color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .date {
          margin-left: auto;
          font-size: 0.76rem;
          color: var(--muted);
        }
        .message {
          margin: 0 0 0.4rem;
          font-size: 0.92rem;
          line-height: 1.5;
        }
        .context {
          margin: 0;
          font-size: 0.8rem;
          color: var(--muted);
          font-style: italic;
        }
      `}</style>
    </Shell>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: 4rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
        }
        .empty-title {
          font-weight: 600;
          margin: 0 0 0.35rem;
        }
        .empty-body {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId, onNotificationsChanged, onNotificationContact }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  // Docx Modifs Aaron (30/08/2026) : la rubrique Clients est réservée au
  // compte aaron@meetaaron.app (supprimée pour tous les autres comptes,
  // fondateur comme commercial) — même logique "fermé par défaut" que
  // userRole ci-dessus. Produits est retiré pour tout le monde, et
  // Suggestions devient un onglet de Mon équipe (voir app/app/team/page.jsx).
  const [userEmail, setUserEmail] = useState(null);
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
        setUserRole(prefs.role || null);
        setUserEmail(prefs.email || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
  ];
  return (
    <div className="shell">
      {/* Habillage téléphone/tablette : barre du haut + barre d'onglets du
          bas (components/MobileChrome.jsx, styles dans app/globals.css) —
          remplace l'ancien bouton hamburger flottant (docx 30/08, item 8). */}
      <MobileChrome
        title={active}
        items={NAV_ITEMS}
        userId={userId}
        onMenu={() => setMobileOpen(true)}
        menuLabel={t('shell.openMenu', locale)}
        moreLabel={t('shell.more', locale)}
        locale={locale}
      />
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {l.toUpperCase()}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            <span className="nav-label">{t('common.logout', locale)}</span>
          </button>
        </div>
      </nav>
      <main className="content">
        {/* Notifications « bulles » en haut de CHAQUE page, toujours au même
            endroit (demande Alex, 03/09/2026). Avant, le bandeau n'existait
            que sur Tableau de bord et Contacts, et la cloche du rail était
            invisible sous 901px : sur téléphone, un commercial ne voyait donc
            AUCUNE notification tant qu'il n'était pas sur l'une de ces deux
            pages. Placé ici, dans le Shell, la position est identique partout
            et sur tous les écrans.
            Coût nul quand il n'y a rien à traiter : Stories rend `null` si
            aucun groupe n'est en attente (voir components/Stories.jsx), donc
            aucune page ne perd de hauteur utile. */}
        <Stories userId={userId} locale={locale} onChanged={onNotificationsChanged} onOpenContact={onNotificationContact} />
        {children}
      </main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          min-width: 0;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mobile-menu-btn {
          display: none;
        }
        .sidebar-overlay {
          display: none;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .mobile-menu-btn {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 60;
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
          }
          .mobile-menu-btn .bar {
            display: block;
            width: 18px;
            height: 2px;
            margin: 0 auto;
            background: var(--text);
            border-radius: 1px;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
            z-index: 65;
          }
          .content {
            padding: 1.5rem;
            padding-top: 4.5rem;
          }
        }
      `}</style>
    </div>
  );
}
