// app/onboarding/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useLocale } from '@/lib/i18n';

// Modules Aaron proposés dès l'inscription (demande d'Alex 2026-08-17) : avant,
// seul Aaron Prospect était proposé au patron, Opportunités/Clients ne
// s'activaient qu'après coup dans Préférences & abonnement. Même
// architecture Stripe (voir lib/subscription.ts, app/api/checkout/route.ts) :
// chaque module choisi ici devient sa propre ligne d'abonnement. Tarifs et
// descriptions repris tels quels de app/app/preferences/page.jsx
// (preferences.offers.apDesc/asDesc/acDesc) pour rester cohérent avec ce qui
// est affiché après-coup — cette page n'est pas traduite (comme le reste du
// tunnel d'inscription), donc textes en dur en français, pas de clé i18n.
const AARON_MODULES = [
  {
    value: 'AP',
    label: 'Aaron Prospect',
    price: '30€ / mois',
    desc: 'Prospection, relances et prise de rendez-vous.',
    info: "Aaron cherche et contacte de nouveaux prospects pour vous, relance ceux qui ne répondent pas, et prend des rendez-vous directement dans votre agenda.",
  },
  {
    value: 'AS',
    label: 'Aaron Opportunités',
    price: '30€ / mois',
    desc: 'Négociation, devis, gestion des objections.',
    info: "Une fois un rendez-vous obtenu, Aaron vous aide à faire avancer l'affaire : conseils avant RDV, devis chiffrés à partir de votre catalogue, relances jusqu'à la signature.",
  },
  {
    value: 'AC',
    label: 'Aaron Clients',
    price: '30€ / mois',
    desc: 'Fidélisation et relation client post-vente.',
    info: "Une fois le client signé, Aaron prend le relais sur la relation post-vente : suivi de satisfaction, réponses aux demandes courantes, alertes si un client montre des signes de mécontentement.",
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [locale] = useLocale();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null); // null | 'patron' | 'commercial'
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState('');
  const [selectedModules, setSelectedModules] = useState(['AP']);
  const [openInfo, setOpenInfo] = useState(null); // value du module dont l'explication est ouverte, ou null
  const [attested, setAttested] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
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
      // Pré-remplissage best-effort depuis les infos OAuth (Google/Microsoft) si dispo.
      const metaFullName = session.user.user_metadata?.full_name || '';
      const [metaFirst, ...metaRest] = metaFullName.split(' ').filter(Boolean);
      setFirstName(metaFirst || '');
      setLastName(metaRest.join(' '));

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

  function toggleModule(value) {
    setSelectedModules((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handlePatronSubmit(e) {
    e.preventDefault();
    if (selectedModules.length === 0) {
      setError('Sélectionnez au moins un module Aaron avant de continuer.');
      return;
    }
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
        first_name: firstName.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        company_name: companyName,
        country,
        locale,
        modules: selectedModules,
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

  async function handleJoinCompany(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch('/api/join-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_user_id: session.user.id,
        email: session.user.email,
        first_name: firstName.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        invite_code: inviteCode,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error || 'Une erreur est survenue');
      return;
    }

    router.push('/app/chat?welcome=1');
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

  if (!role) {
    return (
      <div className="wrap">
        <div className="card">
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>Bienvenue sur Meet Aaron</h1>
          <p className="subtitle">Pour commencer, dites-nous qui vous êtes.</p>

          <button type="button" className="role-btn" onClick={() => setRole('patron')}>
            <span className="role-title">Je suis dirigeant(e) / fondateur(trice)</span>
            <span className="role-desc">Je crée l'espace Meet Aaron de mon entreprise (abonnement).</span>
          </button>

          <button type="button" className="role-btn" onClick={() => setRole('commercial')}>
            <span className="role-title">Je suis commercial(e)</span>
            <span className="role-desc">On m'a donné un code d'invitation pour rejoindre l'espace de mon entreprise.</span>
          </button>
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
          .role-btn {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.3rem;
            width: 100%;
            background: #0b0e1a;
            border: 1px solid #232744;
            border-radius: 10px;
            padding: 1rem 1.1rem;
            margin-bottom: 0.8rem;
            cursor: pointer;
            text-align: left;
            transition: border-color 0.15s ease;
          }
          .role-btn:hover {
            border-color: #4b39ef;
          }
          .role-title {
            color: #f4f1ea;
            font-weight: 600;
            font-size: 0.92rem;
          }
          .role-desc {
            color: #8b90a8;
            font-size: 0.8rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="wrap">
      {role === 'patron' ? (
        <form className="card" onSubmit={handlePatronSubmit}>
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>Créez votre espace Meet Aaron</h1>
          <p className="subtitle">Quelques infos, puis direction le paiement pour activer votre compte.</p>

          <div className="name-row">
            <label>
              Prénom
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: Aaron" required />
            </label>
            <label>
              Nom
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Martin" required />
            </label>
          </div>

          <label>
            Nom de votre société
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ex: Open X" required />
          </label>

          <label>
            Pays de votre société
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ex: France" required />
          </label>

          <div className="modules-field">
            <span className="modules-label">Modules Aaron souhaités</span>
            <div className="modules-grid">
              {AARON_MODULES.map((m) => {
                const selected = selectedModules.includes(m.value);
                return (
                  <div key={m.value} className={`module-card${selected ? ' selected' : ''}`}>
                    {/* div (pas <button>) car elle contient elle-même le bouton "?" —
                        deux <button> imbriqués sont invalides en HTML et cassent le
                        rendu. role="button"/tabIndex/onKeyDown pour rester utilisable
                        au clavier malgré tout. */}
                    <div
                      className="module-toggle"
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onClick={() => toggleModule(m.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleModule(m.value);
                        }
                      }}
                    >
                      <span className="module-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                      <span className="module-main">
                        <span className="module-title-row">
                          <span className="module-title">{m.label}</span>
                          <button
                            type="button"
                            className="info-btn"
                            aria-label={`En savoir plus sur ${m.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenInfo(openInfo === m.value ? null : m.value);
                            }}
                          >
                            ?
                          </button>
                        </span>
                        <span className="module-desc">{m.desc}</span>
                      </span>
                      <span className="module-price">{m.price}</span>
                    </div>
                    {openInfo === m.value && <p className="module-info">{m.info}</p>}
                  </div>
                );
              })}
            </div>
            {selectedModules.length > 0 && (
              <p className="modules-total">
                Total : {selectedModules.length * 30}€ / mois pour {selectedModules.length} module{selectedModules.length > 1 ? 's' : ''}
              </p>
            )}
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>Je certifie être autorisé(e) par mon entreprise à créer ce compte et à partager les documents commerciaux nécessaires au fonctionnement d'Aaron.</span>
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting || selectedModules.length === 0}>
            {submitting ? 'Redirection…' : 'Continuer vers le paiement'}
          </button>

          <button type="button" className="link-back" onClick={() => { setRole(null); setError(null); }}>
            ← Retour
          </button>
        </form>
      ) : (
        <form className="card" onSubmit={handleJoinCompany}>
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>Rejoignez votre équipe</h1>
          <p className="subtitle">Entrez le code d'invitation transmis par votre dirigeant(e).</p>

          <div className="name-row">
            <label>
              Prénom
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: Aaron" required />
            </label>
            <label>
              Nom
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Martin" required />
            </label>
          </div>

          <label>
            Code d'invitation
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="ex: OPENX-7K3F"
              style={{ textTransform: 'uppercase' }}
              required
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Connexion…' : 'Rejoindre mon équipe'}
          </button>

          <button type="button" className="link-back" onClick={() => { setRole(null); setError(null); }}>
            ← Retour
          </button>
        </form>
      )}

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
        .name-row {
          display: flex;
          gap: 0.7rem;
        }
        .name-row label {
          flex: 1;
          min-width: 0;
        }
        input[type='text'], input:not([type]) {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: #f4f1ea;
          font-size: 0.88rem;
        }
        .modules-field {
          margin-bottom: 1.2rem;
        }
        .modules-label {
          display: block;
          font-size: 0.82rem;
          color: #8b90a8;
          margin-bottom: 0.5rem;
        }
        .modules-grid {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .module-card {
          border-radius: 10px;
          overflow: hidden;
        }
        .module-toggle {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          width: 100%;
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 10px;
          padding: 0.7rem 0.9rem;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .module-card.selected .module-toggle {
          border-color: #4b39ef;
          background: rgba(75, 57, 239, 0.12);
        }
        .module-check {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border-radius: 6px;
          border: 1px solid #232744;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4b39ef;
          font-size: 0.8rem;
          font-weight: 700;
        }
        .module-card.selected .module-check {
          border-color: #4b39ef;
          background: #4b39ef;
          color: white;
        }
        .module-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .module-title-row {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .module-title {
          color: #f4f1ea;
          font-weight: 600;
          font-size: 0.88rem;
        }
        .info-btn {
          flex-shrink: 0;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 1px solid #8b90a8;
          background: none;
          color: #8b90a8;
          font-size: 0.66rem;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }
        .info-btn:hover {
          border-color: #4b39ef;
          color: #4b39ef;
        }
        .module-desc {
          color: #8b90a8;
          font-size: 0.76rem;
        }
        .module-price {
          flex-shrink: 0;
          color: #4b39ef;
          font-weight: 700;
          font-size: 0.86rem;
        }
        .module-info {
          background: #0b0e1a;
          border: 1px solid #232744;
          border-top: none;
          border-radius: 0 0 10px 10px;
          margin: 0;
          padding: 0.6rem 0.9rem 0.7rem;
          color: #8b90a8;
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .modules-total {
          text-align: right;
          color: #8b90a8;
          font-size: 0.78rem;
          margin: 0.6rem 0 0;
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
        .link-back {
          display: block;
          width: 100%;
          text-align: center;
          background: none;
          border: none;
          color: #8b90a8;
          font-size: 0.78rem;
          cursor: pointer;
          margin-top: 0.9rem;
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
