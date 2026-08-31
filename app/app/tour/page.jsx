// app/app/tour/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale } from '@/lib/i18n';
import { NavIcon } from '@/components/NavIcon';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

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
      setRole(body.user.role);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, role, authLoading, authError };
}

function slidesFor(locale) {
  return [
    {
      slug: 'dashboard',
      icon: '📊',
      title: t('tour.slide.dashboard.title', locale),
      text: t('tour.slide.dashboard.text', locale),
    },
    {
      slug: 'prospects',
      icon: '🎯',
      title: t('tour.slide.prospects.title', locale),
      text: t('tour.slide.prospects.text', locale),
    },
    // docx AJOUT GLOBAL item A6 : "sales" (Opportunités) et "customer"
    // (Clients) manquaient entièrement de la visite guidée — seul Aaron
    // Prospect y était présenté, alors que ce sont 2 des 3 modules Aaron à
    // part entière (même ordre que la barre latérale, voir NAV_ITEMS dans
    // app/app/dashboard/page.jsx).
    {
      slug: 'sales',
      icon: '🤝',
      title: t('tour.slide.sales.title', locale),
      text: t('tour.slide.sales.text', locale),
    },
    {
      slug: 'customer',
      icon: '🌟',
      title: t('tour.slide.customer.title', locale),
      text: t('tour.slide.customer.text', locale),
    },
    {
      slug: 'campaigns',
      icon: '🚀',
      title: t('tour.slide.campaigns.title', locale),
      text: t('tour.slide.campaigns.text', locale),
    },
    {
      slug: 'agenda',
      icon: '📅',
      title: t('tour.slide.agenda.title', locale),
      text: t('tour.slide.agenda.text', locale),
    },
    {
      slug: 'resultats',
      icon: '📈',
      title: t('tour.slide.resultats.title', locale),
      text: t('tour.slide.resultats.text', locale),
    },
    {
      slug: 'documents',
      icon: '📁',
      title: t('tour.slide.documents.title', locale),
      text: t('tour.slide.documents.text', locale),
    },
    {
      slug: 'chat',
      icon: '💬',
      title: t('tour.slide.chat.title', locale),
      text: t('tour.slide.chat.text', locale),
    },
    // docx item 7 (2026-08-27) : la visite guidée référençait encore
    // l'ancienne structure "Préférences" à 3 onglets (entreprise,
    // notifications, abonnement) en tant que page séparée — obsolète depuis
    // la fusion "Mon compte" du 25/08 (voir daf8d67 et
    // app/app/preferences/page.jsx, qui n'est plus qu'une redirection). La
    // slide "preferences" dédiée a été supprimée (100% redondante avec
    // celle-ci) et ce texte couvre maintenant les 6 onglets réels de "Mon
    // compte" (profil, entreprise, connexion, CRM, préférences, abonnement).
    {
      slug: 'connexions',
      icon: '🔗',
      title: t('tour.slide.connexions.title', locale),
      // Le rappel "active les notifications push" (ajouté le 27/08/2026,
      // push_subscriptions restait vide malgré la préférence "Push" cochée
      // dans Mon compte > Préférences, voir PushNotificationManager.jsx)
      // vivait d'abord dans une slide "push" séparée — mais la notification
      // push n'est pas une rubrique à part entière du menu (retour Alex,
      // 27/08/2026, docx "Modifs Aaron") : elle vit DANS l'onglet
      // Préférences de "Mon compte". Le rappel est désormais fondu dans le
      // texte de cette slide (voir tour.slide.connexions.text, lib/i18n.js)
      // plutôt que présenté comme une rubrique de menu qui n'existe pas.
      text: t('tour.slide.connexions.text', locale),
    },
    {
      slug: 'team',
      icon: '👥',
      title: t('tour.slide.team.title', locale),
      text: t('tour.slide.team.text', locale),
      role: 'patron',
    },
    {
      slug: 'suggestions',
      icon: '💡',
      title: t('tour.slide.suggestions.title', locale),
      text: t('tour.slide.suggestions.text', locale),
      role: 'patron',
    },
  ];
}

export default function TourPage() {
  const [locale] = useLocale();
  const { userId, role, authLoading, authError } = useAuthedUser();
  const [step, setStep] = useState(0);
  const [markedSeen, setMarkedSeen] = useState(false);

  const slides = slidesFor(locale).filter((s) => !s.role || s.role === role);
  const current = slides[step];

  useEffect(() => {
    if (!userId || markedSeen) return;
    fetch('/api/tour-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    setMarkedSeen(true);
  }, [userId, markedSeen]);

  if (authLoading) return <div className="loading">Connexion…</div>;
  if (authError) return <div className="loading error">{authError}</div>;
  if (!current) return null;

  const isLast = step === slides.length - 1;

  return (
    <div className="tour-wrap">
      <nav className="tour-sidebar">
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {slides.map((s, i) => (
            <li
              key={s.slug}
              className={i === step ? 'active' : ''}
              onClick={() => setStep(i)}
            >
              <span className="nav-icon"><NavIcon slug={s.slug} size={15} /></span>
              {s.title}
            </li>
          ))}
        </ul>
      </nav>

      <div className="tour-card">
        <p className="tour-progress">{step + 1} / {slides.length}</p>
        <div className="tour-icon-badge">
          <NavIcon slug={current.slug} size={40} />
        </div>
        <h1>{current.title}</h1>
        <p className="tour-text">{current.text}</p>

        <div className="tour-dots">
          {slides.map((s, i) => (
            <span key={s.slug} className={i === step ? 'dot active' : 'dot'} />
          ))}
        </div>

        <div className="tour-actions">
          {step > 0 ? (
            <button className="btn-secondary" onClick={() => setStep(step - 1)}>← {t('tour.previous', locale)}</button>
          ) : (
            <span />
          )}
          {isLast ? (
            // docx item 9 (2026-08-27) : après la dernière étape de la visite
            // guidée, on redirige vers l'onglet Connexion de "Mon compte"
            // (plutôt que directement le dashboard) pour enchaîner tout de
            // suite sur la connexion de la boîte email — étape suivante
            // naturelle de l'onboarding. La checklist du dashboard (déjà en
            // place) prend ensuite le relais pour guider vers le premier
            // prospect/la première campagne. "Passer" ci-dessous continue
            // d'aller directement au dashboard, pour respecter le choix
            // explicite de l'utilisateur de sauter la visite.
            <a href={`/app/connexions${userId ? `?user_id=${userId}&tab=connection` : '?tab=connection'}`} className="btn-primary">
              {t('tour.finish', locale)}
            </a>
          ) : (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>{t('tour.next', locale)} →</button>
          )}
        </div>

        <a href={`/app/dashboard${userId ? `?user_id=${userId}` : ''}`} className="skip">
          {t('tour.skip', locale)}
        </a>
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&display=swap');
        .loading {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          color: #8b90a8;
          font-family: 'Inter', sans-serif;
        }
        .loading.error {
          color: #e5484d;
          text-align: center;
          padding: 2rem;
        }
        .tour-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          background: #0b0e1a;
          font-family: 'Inter', sans-serif;
          padding: 1.5rem;
        }
        .tour-sidebar {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 18px;
          padding: 1.4rem 1rem;
          width: 240px;
          flex-shrink: 0;
          align-self: stretch;
          max-height: 640px;
          overflow-y: auto;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0 0.4rem;
          margin-bottom: 1.4rem;
        }
        .brand-mark {
          width: 28px;
          height: 28px;
          border-radius: 8px;
        }
        .brand span {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-weight: 600;
          font-size: 0.94rem;
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .nav-list li {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 0.7rem;
          border-radius: 8px;
          font-size: 0.86rem;
          color: #8b90a8;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .nav-list li:hover {
          color: #f4f1ea;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: #f4f1ea;
          font-weight: 500;
        }
        .nav-icon {
          width: 1.7em;
          height: 1.7em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
        }
        .tour-card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 18px;
          padding: 2.6rem 2.2rem;
          width: 460px;
          max-width: 100%;
          text-align: center;
        }
        .tour-progress {
          color: #8b90a8;
          font-size: 0.76rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 0 0 1.2rem;
        }
        .tour-icon-badge {
          width: 84px;
          height: 84px;
          border-radius: 50%;
          margin: 0 auto 1.2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #f4f1ea;
          background: radial-gradient(circle at 32% 28%, #6a5bf5, #4b39ef 55%, #362a9e);
          box-shadow: 0 10px 28px rgba(75, 57, 239, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-size: 1.5rem;
          margin: 0 0 0.8rem;
        }
        .tour-text {
          color: #c7cadd;
          font-size: 0.94rem;
          line-height: 1.6;
          margin: 0 0 1.6rem;
        }
        .tour-dots {
          display: flex;
          justify-content: center;
          gap: 0.35rem;
          margin-bottom: 1.8rem;
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #232744;
        }
        .dot.active {
          background: #4b39ef;
          width: 18px;
          border-radius: 4px;
        }
        .tour-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.8rem;
        }
        .btn-primary, .btn-secondary {
          border-radius: 10px;
          padding: 0.7rem 1.3rem;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          border: none;
        }
        .btn-primary {
          background: #4b39ef;
          color: #fff;
        }
        .btn-secondary {
          background: transparent;
          color: #8b90a8;
          border: 1px solid #232744;
        }
        .skip {
          display: inline-block;
          margin-top: 1.4rem;
          color: #8b90a8;
          font-size: 0.8rem;
          text-decoration: underline;
        }
        @media (max-width: 860px) {
          .tour-sidebar {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
