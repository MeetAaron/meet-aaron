// app/app/chat/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

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
        setAuthError(body.error || 'Accès refusé');
        setAuthLoading(false);
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

// Questions de découverte posées par Aaron une par une lors du premier accueil,
// pour construire un vrai profil commercial "clé en main" plutôt qu'un simple
// pavé de texte libre. Les réponses alimentent /api/business-summary.
const ONBOARDING_QUESTIONS = [
  "Pour commencer : dans quel secteur d'activité et pour quelle taille d'entreprise travailles-tu le plus souvent ?",
  "Est-ce que tu as une seule famille de clients bien homogène, ou plusieurs profils bien distincts ?",
  "Et question un peu plus perso : comment décrirais-tu le comportement ou le caractère de tes clients en général (pressés, méfiants, bavards, factuels...) ? Pas besoin d'être précis, écris comme ça te vient.",
  "Quel est ton produit ou service phare, celui que tu proposes le plus souvent ?",
  "Quel est l'argument qui fait mouche le plus souvent auprès de tes prospects ?",
  "Quelle est l'objection ou l'hésitation que tu entends le plus fréquemment ?",
  "Et l'idéal pour toi après un premier contact : obtenir un rendez-vous, envoyer un devis, proposer un essai gratuit, ou autre chose ?",
];

export default function ChatPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [isWelcome, setIsWelcome] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryDone, setSummaryDone] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [onboardingStep, setOnboardingStep] = useState(-1); // -1 = pas en cours de questionnaire
  const [onboardingAnswers, setOnboardingAnswers] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);

  // Lu directement depuis window.location (plutôt que useSearchParams) pour éviter
  // d'avoir à englober la page dans un <Suspense> côté build Next.js.
  useEffect(() => {
    const welcome = new URLSearchParams(window.location.search).get('welcome');
    if (welcome === '1') {
      setIsWelcome(true);
    }
  }, []);

  // Charge les infos de l'utilisateur (dont son prénom) pour qu'Aaron l'utilise
  // dans son message d'accueil et tout au long de la conversation.
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setUserInfo(res.user);
      })
      .catch(() => {});
  }, [userId]);

  // Rapatrie l'historique déjà persisté (voir migration_chat_history_2026-08-13.sql
  // et app/api/chat-history/route.ts) avant toute décision d'afficher l'accueil —
  // sans ça, revenir sur cette page après être parti ailleurs (ex: "Mes documents")
  // en plein questionnaire d'onboarding faisait tout recommencer à zéro.
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/chat-history?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (Array.isArray(res.messages) && res.messages.length > 0) {
          setMessages(res.messages);
          setOnboardingStep(typeof res.onboarding_step === 'number' ? res.onboarding_step : -1);
          setOnboardingAnswers(Array.isArray(res.onboarding_answers) ? res.onboarding_answers : []);
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [userId]);

  useEffect(() => {
    if (!isWelcome || messages.length > 0) return;
    // On attend d'avoir le prénom pour un accueil personnalisé plutôt que générique.
    if (!userInfo) return;
    // On attend de savoir si un historique existe déjà en base avant de semer
    // l'accueil, pour ne pas écraser une conversation/un questionnaire en cours.
    if (!historyLoaded) return;
    const firstName = userInfo.first_name || (userInfo.full_name || '').split(' ')[0] || '';
    const welcomeMessages = [
      {
        role: 'assistant',
        content:
          `Bonjour${firstName ? ' ' + firstName : ''}, je suis Aaron, ton copilote commercial IA. Voici ce que je fais pour toi :\n\n` +
          "• pendant que tu roules, que tu déjeunes ou que tu dors, moi je prospecte : je pars chercher, un par un, des prospects qui correspondent vraiment à ton profil client (zone, secteur, taille d'entreprise) ;\n" +
          "• je leur écris et je relance en ton nom, depuis ta propre boîte mail, en adaptant chaque message à la personne et à ce qu'elle répond ;\n" +
          "• je repère les signaux d'intérêt, je remplis ta fiche prospect au fil de l'échange, et surtout : ce que je te garantis, ce sont des rendez-vous — par téléphone, en physique ou en visio, directement dans ton agenda.\n\n" +
          "Ce que je ne fais pas : pas d'emailing de masse ni de listes achetées — ici, tout est fait un par un, de façon personnalisée et clé en main. " +
          "Et je ne prends aucune décision finale à ta place (devis, tarifs, engagements) : ça reste toujours toi qui conclus.\n\n" +
          "Avant de me lancer sur le terrain, j'ai besoin d'apprendre à connaître ton métier — quelques questions rapides, une par une, ça prend 2 minutes en tout.",
      },
      {
        role: 'assistant',
        content: ONBOARDING_QUESTIONS[0],
      },
    ];
    setMessages(welcomeMessages);
    setOnboardingStep(0);

    // Persiste tout de suite l'accueil + le démarrage du questionnaire : si la
    // page est quittée avant même la première réponse, on ne repart plus de zéro.
    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        messages: welcomeMessages,
        onboarding_step: 0,
        onboarding_answers: [],
      }),
    }).catch(() => {});
  }, [isWelcome, messages.length, userInfo, historyLoaded, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleGenerateSummary() {
    if (summarizing) return;
    setSummarizing(true);

    // Si le questionnaire guidé a été répondu, on envoie les paires question/réponse
    // structurées (bien plus exploitables pour Aaron qu'un pavé de texte libre).
    // Sinon (questionnaire sauté ou messages libres), on retombe sur l'ancien
    // comportement : tous les messages de l'utilisateur concaténés.
    const description = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const res = await fetch('/api/business-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, description, qa: onboardingAnswers }),
    });
    const data = await res.json();
    setSummarizing(false);

    if (!res.ok) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.error || "Je n'ai pas encore assez d'informations pour faire un résumé — ajoute un document ou décris-moi ton métier ici." },
      ]);
      return;
    }

    setSummaryDone(true);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          `Voici ce que j'ai compris de ton activité :\n\n${data.summary}\n\n` +
          "On pourra toujours l'ajuster plus tard. Je te propose maintenant une petite visite guidée de l'appli — " +
          "clique sur \"Voir comment fonctionne l'appli\" ci-dessous.",
      },
    ]);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    // Questionnaire de découverte guidé : on avance localement, question par
    // question, sans appeler le modèle général — la séquence reste prévisible
    // et instantanée, comme un vrai petit onboarding "clé en main".
    if (onboardingStep >= 0 && onboardingStep < ONBOARDING_QUESTIONS.length) {
      const updatedAnswers = [
        ...onboardingAnswers,
        { question: ONBOARDING_QUESTIONS[onboardingStep], answer: userMessage.content },
      ];
      setOnboardingAnswers(updatedAnswers);

      const nextStep = onboardingStep + 1;
      let assistantMessage;
      let newOnboardingStep;
      if (nextStep < ONBOARDING_QUESTIONS.length) {
        newOnboardingStep = nextStep;
        assistantMessage = { role: 'assistant', content: ONBOARDING_QUESTIONS[nextStep] };
        setOnboardingStep(nextStep);
        setMessages([...newMessages, assistantMessage]);
      } else {
        newOnboardingStep = -1;
        assistantMessage = {
          role: 'assistant',
          content:
            "Parfait, merci ! Si tu as un devis type, une plaquette ou une liste de tarifs sous la main, direction " +
            "\"Mes documents\" pour me les envoyer — ça m'aide encore plus à te représenter auprès des prospects. " +
            "Sinon, clique directement sur \"Générer mon résumé\" ci-dessous et je te dis ce que j'ai compris de " +
            "ton activité.",
        };
        setOnboardingStep(-1);
        setMessages([...newMessages, assistantMessage]);
      }

      // Persiste ce tour de questionnaire (question + réponse) et la nouvelle
      // progression, pour ne pas la reperdre si la page est quittée avant la fin.
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          messages: [userMessage, assistantMessage],
          onboarding_step: newOnboardingStep,
          onboarding_answers: updatedAnswers,
        }),
      }).catch(() => {});

      return;
    }

    setSending(true);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        message: userMessage.content,
        history: messages,
      }),
    });

    const data = await res.json();
    setSending(false);

    if (data.reply) {
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    }
  }

  async function handleSendFeedback(e) {
    e.preventDefault();
    if (!feedbackText.trim() || feedbackSending) return;
    setFeedbackSending(true);

    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, message: feedbackText }),
    });

    setFeedbackSending(false);
    setFeedbackText('');
    setShowFeedback(false);
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif;
          }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active="Chat avec Aaron" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Discussion</p>
          <h1>Chat avec Aaron</h1>
        </div>
        <button className="btn-feedback" onClick={() => setShowFeedback(!showFeedback)}>
          🚩 Signaler à l'équipe
        </button>
      </header>

      {feedbackSent && <p className="feedback-sent">Merci, ton message a été transmis à l'équipe !</p>}

      {showFeedback && (
        <form className="feedback-form" onSubmit={handleSendFeedback}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Une idée, un bug, une suggestion ? Décris-le ici, ça sera transmis directement à l'équipe Meet Aaron."
            rows={3}
          />
          <div className="feedback-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowFeedback(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={feedbackSending || !feedbackText.trim()}>
              {feedbackSending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}

      <div className="chat-box">
        <div className="messages">
          {messages.length === 0 && (
            <div className="intro">
              <p>
                {isWelcome
                  ? 'Chargement…'
                  : 'Salut ! Pose-moi une question sur tes prospects, tes campagnes, ou demande-moi un conseil commercial.'}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="bubble assistant typing">Aaron réfléchit…</div>}
          <div ref={bottomRef} />
        </div>

        {isWelcome && (
          <div className="welcome-actions">
            {!summaryDone && (
              <button type="button" className="btn-secondary" onClick={handleGenerateSummary} disabled={summarizing}>
                {summarizing ? 'Génération du résumé…' : 'Générer mon résumé'}
              </button>
            )}
            <Link href={`/app/tour${userId ? `?user_id=${userId}` : ''}`} className="btn-primary btn-tour">
              Voir comment fonctionne l'appli
            </Link>
          </div>
        )}

        <form className="input-row" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écris ton message…"
            disabled={sending}
          />
          <button type="submit" className="btn-send" disabled={sending || !input.trim()}>
            Envoyer
          </button>
        </form>
      </div>

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.2rem;
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
          margin: 0;
        }
        .btn-feedback {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 10px;
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .feedback-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: #3dd68c;
          padding: 0.7rem 1rem;
          border-radius: 10px;
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
        .feedback-form {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .feedback-form textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .feedback-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.7rem;
        }
        .btn-primary, .btn-secondary {
          border-radius: 8px;
          padding: 0.5rem 1rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          font-weight: 600;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .chat-box {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          height: 60vh;
          overflow: hidden;
        }
        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.4rem;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }
        .intro {
          color: var(--muted);
          font-size: 0.9rem;
          text-align: center;
          margin-top: 2rem;
        }
        .bubble {
          max-width: 70%;
          padding: 0.7rem 1rem;
          border-radius: 14px;
          font-size: 0.9rem;
          line-height: 1.45;
          white-space: pre-wrap;
        }
        .bubble.user {
          align-self: flex-end;
          background: var(--accent);
          color: white;
          border-bottom-right-radius: 4px;
        }
        .bubble.assistant {
          align-self: flex-start;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-bottom-left-radius: 4px;
        }
        .bubble.typing {
          color: var(--muted);
          font-style: italic;
        }
        .welcome-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          padding: 0 1rem 1rem;
        }
        .btn-tour {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }
        .input-row {
          display: flex;
          gap: 0.6rem;
          padding: 1rem;
          border-top: 1px solid var(--border);
        }
        .input-row input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.7rem 1rem;
          color: var(--text);
          font-size: 0.9rem;
        }
        .btn-send {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.7rem 1.2rem;
          font-weight: 600;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });

  // Un module (Aaron Vente / Aaron Client) est grisé dans la navigation tant
  // que l'offre souscrite par la société (companies.offer, voir Préférences)
  // ne correspond pas à ce module. Aaron Prospect (Campagnes/Prospects) reste
  // toujours accessible : c'est l'offre de base incluse à la souscription.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offer = body.preferences?.offer || 'AP';
        setLockedModules({ sales: offer !== 'AS', customer: offer !== 'AC' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard', icon: '📊' },
    { label: 'Prospects', slug: 'prospects', icon: '🎯' },
    { label: 'Aaron Vente', slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: 'Aaron Client', slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: 'Campagnes', slug: 'campaigns', icon: '🚀' },
    { label: 'Agenda', slug: 'agenda', icon: '📅' },
    { label: 'Résultats', slug: 'resultats', icon: '📈' },
    { label: 'Mes documents', slug: 'documents', icon: '📁' },
    { label: 'Chat avec Aaron', slug: 'chat', icon: '💬' },
    { label: 'Connexions', slug: 'connexions', icon: '🔗' },
    { label: 'Disponibilités', slug: 'disponibilites', icon: '🕒' },
    { label: 'Préférences', slug: 'preferences', icon: '⚙️' },
    { label: 'Mon équipe', slug: 'team', icon: '👥' },
    { label: 'Suggestions', slug: 'suggestions', icon: '💡' },
  ];
  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Ouvrir le menu"
        onClick={() => setMobileOpen(true)}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel">🔒</span>}</li>
            </Link>
          ))}
        </ul>
      </nav>
      <main className="content">{children}</main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0b0e1a;
          --surface: #131629;
          --border: #232744;
          --accent: #4b39ef;
          --accent-green: #3dd68c;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 240px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 1.5rem 1.2rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: var(--font-display);
          font-weight: 600;
          margin-bottom: 2rem;
        }
        .brand-mark {
          width: 30px;
          height: 30px;
          border-radius: 8px;
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          padding: 0.6rem 0.7rem;
          border-radius: 8px;
          font-size: 0.88rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .nav-icon {
          font-size: 0.95rem;
          width: 1.1em;
          text-align: center;
          flex-shrink: 0;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.locked {
          opacity: 0.45;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
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
            width: 38px;
            height: 38px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            padding: 0;
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
            width: 240px;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
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
