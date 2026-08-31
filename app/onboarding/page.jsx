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
    info: "Aaron cherche et contacte de nouveaux prospects pour vous, relance ceux qui ne répondent pas, et prend des rendez-vous directement dans votre agenda — de la prospection jusqu'à l'obtention d'une opportunité.",
  },
  {
    value: 'AS',
    label: 'Aaron Opportunités',
    price: '30€ / mois',
    desc: 'Négociation, devis, gestion des objections.',
    info: "Une fois un rendez-vous obtenu, Aaron vous aide à faire avancer l'affaire : conseils avant RDV, devis chiffrés à partir de votre catalogue, gestion des objections, relances jusqu'à la signature — de la négociation jusqu'à l'obtention d'un nouveau client.",
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
  // Deux questions bien distinctes (retour Alex 25/08, après avoir testé
  // avec un 2e compte) : QUI la personne est (personRole — fondateur/
  // dirigeant(e) ou commercial(e), détermine le rôle en base et donc si
  // "Mon équipe" apparaît dans le menu, voir Shell) puis, seulement pour un
  // commercial, COMMENT il/elle rejoint Meet Aaron (signupPath — code
  // d'activation de son entreprise, ou création de son propre espace payant
  // s'il n'en a pas). Avant, ces deux questions étaient confondues en une
  // seule ("role"), ce qui laissait croire qu'un commercial solo devait
  // forcément avoir un code pour s'inscrire.
  const [personRole, setPersonRole] = useState(null); // null | 'patron' | 'commercial'
  const [signupPath, setSignupPath] = useState(null); // null | 'invite_code' | 'own_space'
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
        // "patron" pour un(e) fondateur(trice)/dirigeant(e), "commercial"
        // pour un commercial solo qui paie pour lui-même sans code
        // d'activation (voir commentaire sur personRole/signupPath plus
        // haut) — lu par le webhook Stripe pour définir users.role, qui
        // détermine ensuite si "Mon équipe" apparaît dans le menu.
        role: personRole,
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

  if (!personRole || (personRole === 'commercial' && !signupPath)) {
    // Deux questions successives (retour Alex 25/08) : d'abord QUI (fondateur/
    // dirigeant(e) vs commercial(e) — détermine le rôle en base, donc si "Mon
    // équipe" apparaît dans le menu), puis, seulement pour un commercial,
    // COMMENT il/elle rejoint Meet Aaron (code d'activation de son
    // entreprise, ou son propre espace payant s'il n'en a pas).
    const askingSignupPath = personRole === 'commercial' && !signupPath;
    return (
      <div className="wrap">
        <div className="card">
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>Bienvenue sur Meet Aaron</h1>

          {!askingSignupPath ? (
            <>
              <p className="subtitle">Pour commencer, dites-nous qui vous êtes.</p>

              <button type="button" className="role-btn" onClick={() => setPersonRole('patron')}>
                <span className="role-title">Je suis fondateur(trice) / dirigeant(e)</span>
                <span className="role-desc">
                  Je crée l'espace Meet Aaron de mon entreprise et je configure l'abonnement (carte bancaire). Pas
                  besoin d'inviter toute mon équipe dès maintenant : je pourrai ajouter les sessions de mes employés
                  plus tard directement depuis l'application, au même prix.
                </span>
              </button>

              <button type="button" className="role-btn" onClick={() => setPersonRole('commercial')}>
                <span className="role-title">Je suis commercial(e)</span>
                <span className="role-desc">
                  Je fais de la prospection/vente pour une entreprise — avec ou sans code transmis par mon employeur.
                </span>
              </button>
            </>
          ) : (
            <>
              <p className="subtitle">Une dernière précision avant de continuer.</p>

              {/* Distinct de "Je suis commercial(e)" ci-dessus : avant, ce
                  choix ÉTAIT la question "qui êtes-vous", ce qui empêchait
                  un commercial solo (sans code, payant lui-même) de
                  simplement se déclarer commercial — il devait mentir et
                  se dire "dirigeant(e)" pour pouvoir payer. */}
              <button type="button" className="role-btn" onClick={() => setSignupPath('invite_code')}>
                <span className="role-title">J'ai un code d'activation de mon entreprise</span>
                <span className="role-desc">
                  Mon entreprise a déjà un abonnement Meet Aaron actif et m'a transmis un code pour rejoindre son
                  espace, sans payer individuellement.
                </span>
              </button>

              <button type="button" className="role-btn" onClick={() => setSignupPath('own_space')}>
                <span className="role-title">Je crée mon propre espace</span>
                <span className="role-desc">
                  Je n'ai pas de code : je configure mon propre abonnement (carte bancaire) pour utiliser Meet Aaron
                  seul(e).
                </span>
              </button>

              <button type="button" className="link-back" onClick={() => setPersonRole(null)}>
                ← Retour
              </button>
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
      {signupPath !== 'invite_code' ? (
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
          {/* Précision ajoutée le 25/08 : un commercial solo qui découvre ce
              champ juste après avoir cliqué "Je crée mon espace Meet Aaron"
              peut se demander s'il a le droit de continuer alors qu'il n'a
              pas de société au sens juridique — on lève l'ambiguïté ici. */}
          <p className="field-hint">Si vous êtes seul(e), indiquez simplement votre nom ou celui de votre activité.</p>

          <label>
            Pays de votre société
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ex: France" required />
          </label>

          {/* Abonnement unique Aaron (docx Modifs Aaron 30/08/2026 + décision
              Alex 31/08/2026) : plus de choix de modules à l'inscription —
              une seule offre à 30 €/mois qui inclut prospection,
              opportunités et suivi client. selectedModules reste ['AP']
              (le prix Aaron côté Stripe est l'ancien prix "AP"). */}
          <div className="modules-field">
            <span className="modules-label">Votre abonnement</span>
            <div className="modules-grid">
              <div className="module-card selected">
                <div className="module-toggle" aria-pressed="true">
                  <span className="module-check" aria-hidden="true">✓</span>
                  <span className="module-main">
                    <span className="module-title-row">
                      <span className="module-title">Aaron</span>
                    </span>
                    <span className="module-desc">
                      Prospection, relances, prise de rendez-vous, suivi des opportunités jusqu'à la signature — tout est inclus.
                    </span>
                  </span>
                  <span className="module-price">30€ / mois</span>
                </div>
              </div>
            </div>
            <p className="modules-hint">
              Sans engagement, résiliable à tout moment depuis l'application. Mises à jour et maintenance comprises.
            </p>
          </div>

          {/* Demande Alex (27/08/2026, docx "Modifs Aaron") : rassurer sur les
              technos utilisées (Supabase/GitHub/Vercel — standards
              professionnels sécurisés) et sur le fait que le partage de
              données reste au choix de l'utilisateur, révocable à tout
              moment — pour lever l'inquiétude au moment de cocher la case
              juste en dessous. */}
          <p className="field-hint">
            Concrètement : tes données sont hébergées chez Supabase, le code de Meet Aaron est hébergé sur GitHub et
            l'application tourne sur Vercel — des standards professionnels et sécurisés. Pas de panique : tu
            choisiras toi-même quelles données partager avec Aaron, et tu pourras les retirer à tout moment (on
            verra ça ensemble un peu plus tard, directement dans l'application).
          </p>

          <label className="checkbox-row">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>Je certifie être autorisé(e) par mon entreprise à créer ce compte et à partager les documents commerciaux nécessaires au fonctionnement d'Aaron.</span>
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting || selectedModules.length === 0}>
            {submitting ? 'Redirection…' : 'Continuer vers le paiement'}
          </button>

          <button
            type="button"
            className="link-back"
            onClick={() => {
              if (personRole === 'patron') {
                setPersonRole(null);
              } else {
                setSignupPath(null);
              }
              setError(null);
            }}
          >
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
            Code d'invitation de votre entreprise
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="ex: OPENX-7K3F"
              style={{ textTransform: 'uppercase' }}
              required
            />
          </label>
          {/* Précision ajoutée le 25/08 (retour Alex) : "code d'invitation"
              seul n'était pas assez explicite sur ce qu'il fait concrètement
              (rejoindre un abonnement déjà payé par l'entreprise). */}
          <p className="field-hint">
            Ce code vous a été transmis par votre dirigeant(e) ou responsable — il vous fait rejoindre l'abonnement
            déjà actif de votre entreprise, sans paiement de votre part.
          </p>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Connexion…' : 'Rejoindre mon équipe'}
          </button>

          {/* Échappatoire ajoutée le 25/08 : avant, quelqu'un arrivant ici
              sans code (cas Alex — commercial solo testant sans code
              d'entreprise) n'avait pas d'autre choix que "← Retour" puis
              redevine tout seul qu'il fallait cliquer l'autre bouton. */}
          <button type="button" className="link-secondary" onClick={() => { setSignupPath('own_space'); setError(null); }}>
            Vous n'avez pas de code ? Créez votre propre espace Meet Aaron →
          </button>

          <button type="button" className="link-back" onClick={() => { setSignupPath(null); setError(null); }}>
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
        .field-hint {
          font-size: 0.78rem;
          color: #8b90a8;
          margin: -0.7rem 0 1rem;
          line-height: 1.4;
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
        .modules-hint {
          font-size: 0.8rem;
          color: #8b90a8;
          margin: 0 0 0.7rem;
          line-height: 1.4;
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
        .link-secondary {
          display: block;
          width: 100%;
          text-align: center;
          background: none;
          border: none;
          color: #7c8cff;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          margin-top: 1rem;
        }
        .link-secondary:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
