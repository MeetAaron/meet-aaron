// app/app/tour/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

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
        setAuthError(body.error || 'Accès refusé');
        setAuthLoading(false);
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

const SLIDES = [
  {
    slug: 'dashboard',
    icon: '📊',
    title: 'Tableau de bord',
    text: "Ta vue d'ensemble : prospects chauds, prochains RDV, et le bloc \"Actions requises\" où tu valides ce qu'Aaron a préparé pour toi.",
  },
  {
    slug: 'prospects',
    icon: '🎯',
    title: 'Prospects',
    text: "Le pipeline complet, avec une couleur par statut : vert (en bonne voie), jaune (en cours), orange (risque de perdre), rouge (perdu), bleu (RDV obtenu).",
  },
  {
    slug: 'campaigns',
    icon: '🚀',
    title: 'Campagnes',
    text: "Lance une prospection sur une zone géographique — Aaron cherche, contacte et négocie un RDV pour toi, sans que tu aies à écrire un seul email.",
  },
  {
    slug: 'agenda',
    icon: '📅',
    title: 'Agenda',
    text: "Tous tes RDV proposés par Aaron. Tu valides, reportes ou annules en un clic — Aaron gère ton calendrier Google et évite les conflits automatiquement.",
  },
  {
    slug: 'resultats',
    icon: '📈',
    title: 'Résultats',
    text: "Tes statistiques de conversion, l'efficacité de chaque campagne, et tes clients gagnés (exportables en CSV d'un clic pour les faire remonter dans ton propre CRM) — pour savoir ce qui marche vraiment.",
  },
  {
    slug: 'documents',
    icon: '📁',
    title: 'Mes documents',
    text: "Dépose un devis type, une plaquette, une liste de tarifs — Aaron les lit, les résume, et s'en sert pour mieux te représenter auprès des prospects.",
  },
  {
    slug: 'chat',
    icon: '💬',
    title: 'Chat avec Aaron',
    text: "Pose tes questions, demande un conseil commercial. Toute suggestion sur l'outil est automatiquement relayée au fondateur, sans email à écrire.",
  },
  {
    slug: 'connexions',
    icon: '🔗',
    title: 'Connexions',
    text: "Relie ton compte Google (email + calendrier) pour qu'Aaron envoie depuis ta propre adresse et respecte ton vrai emploi du temps.",
  },
  {
    slug: 'disponibilites',
    icon: '🕒',
    title: 'Disponibilités',
    text: "Déclare tes créneaux habituels et tes indisponibilités ponctuelles — Aaron ne proposera jamais un RDV en dehors.",
  },
  {
    slug: 'preferences',
    icon: '⚙️',
    title: 'Préférences',
    text: "Réglages des notifications, délai d'alerte avant un RDV, et niveau de collaboration avec ton CRM si tu veux aller plus loin.",
  },
  {
    slug: 'team',
    icon: '👥',
    title: 'Mon équipe',
    text: "Vue d'ensemble de chaque commercial : leurs statistiques et leur activité, en un coup d'œil.",
    role: 'patron',
  },
  {
    slug: 'suggestions',
    icon: '💡',
    title: 'Suggestions',
    text: "Les retours de ton équipe, qu'ils soient signalés manuellement ou détectés automatiquement par Aaron dans une conversation.",
    role: 'patron',
  },
];

export default function TourPage() {
  const { userId, role, authLoading, authError } = useAuthedUser();
  const [step, setStep] = useState(0);
  const [markedSeen, setMarkedSeen] = useState(false);

  const slides = SLIDES.filter((s) => !s.role || s.role === role);
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
              <span className="nav-icon">{s.icon}</span>
              {s.title}
            </li>
          ))}
        </ul>
      </nav>

      <div className="tour-card">
        <p className="tour-progress">{step + 1} / {slides.length}</p>
        <div className="tour-icon">{current.icon}</div>
        <h1>{current.title}</h1>
        <p className="tour-text">{current.text}</p>

        <div className="tour-dots">
          {slides.map((s, i) => (
            <span key={s.slug} className={i === step ? 'dot active' : 'dot'} />
          ))}
        </div>

        <div className="tour-actions">
          {step > 0 ? (
            <button className="btn-secondary" onClick={() => setStep(step - 1)}>← Précédent</button>
          ) : (
            <span />
          )}
          {isLast ? (
            <Link href={`/app/dashboard${userId ? `?user_id=${userId}` : ''}`} className="btn-primary">
              C'est parti !
            </Link>
          ) : (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>Suivant →</button>
          )}
        </div>

        <Link href={`/app/dashboard${userId ? `?user_id=${userId}` : ''}`} className="skip">
          Passer la visite
        </Link>
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
          font-size: 0.95rem;
          width: 1.1em;
          text-align: center;
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
        .tour-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
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
