// app/app/chat/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';

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

// Questions de découverte posées par Aaron une par une lors du premier accueil,
// pour construire un vrai profil commercial "clé en main" plutôt qu'un simple
// pavé de texte libre. Les réponses alimentent /api/business-summary.
const ONBOARDING_QUESTION_KEYS = [
  'chat.onboardingQ1',
  'chat.onboardingQ2',
  'chat.onboardingQ3',
  'chat.onboardingQ4',
  'chat.onboardingQ5',
  'chat.onboardingQ6',
  'chat.onboardingQ7',
];

function getOnboardingQuestions(locale) {
  return ONBOARDING_QUESTION_KEYS.map((key) => t(key, locale));
}

export default function ChatPage() {
  const [locale] = useLocale();
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
  // Bug remonté par Alex (2026-08-19, nouveau compte) : la page "Chat avec Aaron"
  // restait bloquée sur "Chargement…" indéfiniment. Cause : le message d'accueil
  // (voir l'effet ci-dessous) attendait `userInfo` non-null avant de s'afficher,
  // mais le fetch qui le charge n'avait ni gestion d'erreur ni marqueur "terminé"
  // — au moindre hoquet (réseau, 401 transitoire, etc.) `userInfo` restait `null`
  // pour toujours et l'accueil ne s'affichait jamais. `userInfoLoaded` distingue
  // "chargement en cours" de "chargement terminé, avec ou sans résultat" (même
  // principe que `historyLoaded` juste en dessous, qui lui gérait déjà ce cas).
  const [userInfoLoaded, setUserInfoLoaded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(-1); // -1 = pas en cours de questionnaire
  const [onboardingAnswers, setOnboardingAnswers] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Relance du questionnaire de découverte depuis Préférences (bouton "Relancer
  // le questionnaire de découverte", voir app/app/preferences/page.jsx) — pour
  // quelqu'un qui l'a manqué ou déconnecté en cours de route la première fois.
  // Distinct de isWelcome : ne dépend pas de messages.length === 0, puisqu'une
  // conversation existe déjà dans ce cas (restartSeeded sert de garde-fou
  // "une seule fois" à la place).
  const [restartRequested, setRestartRequested] = useState(false);
  const [restartSeeded, setRestartSeeded] = useState(false);
  // Dépôt de document dans le chat (demande d'Alex, 22/08/2026) : pendingDocument
  // contient les métadonnées du document déjà uploadé (voir
  // app/api/chat/document/route.ts) mais pas encore sauvegardé dans "Mes
  // documents" — renvoyé à chaque appel /api/chat tant qu'il reste affiché en
  // chip au-dessus du champ de saisie (voir handleSend). Il disparaît soit
  // parce qu'Aaron l'a sauvegardé (data.document_saved, voir handleSend), soit
  // parce que le commercial le retire lui-même via le ✕ du chip.
  const [pendingDocument, setPendingDocument] = useState(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [attachError, setAttachError] = useState(null);
  // Filet de sécurité sur l'appel /api/chat (l'appel principal, hors
  // questionnaire de découverte) : avant, aucun try/catch ici — une erreur
  // réseau ou un 500 sans JSON valide faisait planter handleSend en plein
  // vol, "sending" restait bloqué à true (input verrouillé indéfiniment) et
  // rien n'informait le commercial. Voir aussi chat.sendError (lib/i18n.js).
  const [sendError, setSendError] = useState(null);
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const prefillAppliedRef = useRef(false);
  // docx "CHAT AVEC AARON" item A1 : le texte en cours de rédaction (non
  // envoyé) doit survivre à un aller-retour sur une autre page — comme un
  // brouillon WhatsApp. La page se démonte complètement en changeant de
  // rubrique (ce n'est pas un problème d'auth/historique comme pour les
  // messages déjà envoyés, voir /api/chat-history plus haut), donc un state
  // React seul ne suffit pas : on persiste dans localStorage, scopé par
  // utilisateur pour ne pas mélanger les brouillons entre commerciaux d'une
  // même entreprise partageant le même navigateur.
  const draftStorageKey = userId ? `meetaaron_chat_draft_${userId}` : null;

  // Lu directement depuis window.location (plutôt que useSearchParams) pour éviter
  // d'avoir à englober la page dans un <Suspense> côté build Next.js.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setIsWelcome(true);
    }
    if (params.get('restart_questionnaire') === '1') {
      setRestartRequested(true);
    }
    // Tâche "Mon compte" (2026-08-22) : la carte "Ton CRM n'est pas dans la
    // liste ?" (app/app/connexions/page.jsx) amène ici avec un message
    // pré-rempli plutôt que d'ouvrir une conversation vide — le commercial
    // reste libre de le modifier avant de l'envoyer. On ne fait que
    // PRÉ-REMPLIR la zone de saisie, jamais d'envoi automatique. Priorité sur
    // un éventuel brouillon déjà sauvegardé (voir draftRestoredRef plus bas) :
    // un lien de préremplissage est une intention explicite et fraîche.
    const prefill = params.get('prefill');
    if (prefill) {
      setInput(prefill);
      prefillAppliedRef.current = true;
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
      .catch(() => {})
      .finally(() => setUserInfoLoaded(true));
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
    // On attend que le chargement du prénom soit TERMINÉ (succès ou échec, voir
    // userInfoLoaded ci-dessus) pour un accueil personnalisé quand c'est possible
    // — mais sans bloquer indéfiniment si ce fetch échoue.
    if (!userInfoLoaded) return;
    // On attend de savoir si un historique existe déjà en base avant de semer
    // l'accueil, pour ne pas écraser une conversation/un questionnaire en cours.
    if (!historyLoaded) return;
    const firstName = userInfo ? (userInfo.first_name || (userInfo.full_name || '').split(' ')[0] || '') : '';
    const onboardingQuestions = getOnboardingQuestions(locale);
    const welcomeMessages = [
      {
        role: 'assistant',
        content:
          `${t('chat.welcomeGreeting', locale).replace('{firstName}', firstName ? ' ' + firstName : '')}\n\n` +
          `• ${t('chat.welcomeBullet1', locale)}\n` +
          `• ${t('chat.welcomeBullet2', locale)}\n` +
          `• ${t('chat.welcomeBullet3', locale)}\n\n` +
          `${t('chat.welcomeNotDoing', locale)}\n\n` +
          t('chat.welcomeBeforeStart', locale),
      },
      {
        role: 'assistant',
        content: onboardingQuestions[0],
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
  }, [isWelcome, messages.length, userInfo, userInfoLoaded, historyLoaded, userId, locale]);

  // Relance du questionnaire (voir restartRequested plus haut) : ajoute une
  // courte intro + la première question à la suite de la conversation
  // existante (n'écrase rien — /api/chat-history insère, ne remplace jamais),
  // et repart de zéro sur la progression (étape 0, réponses vidées) pour que
  // /api/business-summary régénère un résumé propre à la fin.
  useEffect(() => {
    if (!restartRequested || restartSeeded) return;
    // Voir userInfoLoaded plus haut : on attend la FIN du chargement (pas un
    // résultat non-nul) pour ne jamais bloquer indéfiniment.
    if (!userInfoLoaded) return;
    if (!historyLoaded) return;

    const onboardingQuestions = getOnboardingQuestions(locale);
    const restartMessages = [
      { role: 'assistant', content: t('chat.restartQuestionnaireIntro', locale) },
      { role: 'assistant', content: onboardingQuestions[0] },
    ];
    setMessages((prev) => [...prev, ...restartMessages]);
    setOnboardingStep(0);
    setOnboardingAnswers([]);
    setSummaryDone(false);
    setRestartSeeded(true);

    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        messages: restartMessages,
        onboarding_step: 0,
        onboarding_answers: [],
      }),
    }).catch(() => {});
  }, [restartRequested, restartSeeded, userInfoLoaded, historyLoaded, userId, locale]);

  // docx item A3 : scroller uniquement la liste de messages elle-même (pas
  // toute la page) à chaque nouveau message. `scrollIntoView` sans option
  // `block: 'nearest'` peut aussi faire défiler des ancêtres qui montrent
  // déjà l'élément (ex: la page entière si `.chat-box` dépasse la fenêtre),
  // ce qui produisait le "la page descend toute seule" remonté par Alex — on
  // manipule directement `scrollTop` du conteneur scrollable pour rester
  // strictement local à la boîte de chat.
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // docx item A1 : restaure le brouillon non envoyé dès que l'utilisateur est
  // connu (une seule fois — on ne veut pas écraser ce que l'utilisateur est
  // déjà en train de retaper si l'effet se redéclenchait).
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (!draftStorageKey || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    // Un lien "?prefill=..." (voir plus haut) vient déjà de remplir la zone
    // de saisie avec une intention fraîche et explicite — on ne l'écrase pas
    // avec un vieux brouillon resté en localStorage.
    if (prefillAppliedRef.current) return;
    try {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (saved) setInput(saved);
    } catch {
      // localStorage indisponible (navigation privée stricte, etc.) — le
      // brouillon ne survivra simplement pas à un changement de page, sans
      // bloquer le reste de la fonctionnalité.
    }
  }, [draftStorageKey]);

  // Sauvegarde le brouillon à chaque frappe, pour qu'il survienne un aller-
  // retour vers une autre rubrique (la page se démonte entièrement).
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      if (input) {
        window.localStorage.setItem(draftStorageKey, input);
      } else {
        window.localStorage.removeItem(draftStorageKey);
      }
    } catch {
      // Voir plus haut.
    }
  }, [draftStorageKey, input]);

  // Le cadre ne s'agrandit "en direct" que via l'onChange du textarea (item
  // A2) — quand `input` change par programme plutôt que par frappe (brouillon
  // restauré au chargement, envoi qui vide le champ), rien ne redéclenche ce
  // handler DOM, donc on resynchronise la hauteur ici à chaque changement de
  // `input`, peu importe la cause.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    if (input) el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
        { role: 'assistant', content: data.error || t('chat.summaryErrorFallback', locale) },
      ]);
      return;
    }

    setSummaryDone(true);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          `${t('chat.summaryIntro', locale)}\n\n${data.summary}\n\n` +
          t('chat.summaryOutro', locale),
      },
    ]);
  }

  // Upload immédiat dès la sélection du fichier (pas seulement à l'envoi du
  // message) : le commercial voit tout de suite le chip "document joint" et
  // une éventuelle erreur (fichier trop lourd, échec réseau) avant même
  // d'écrire son message.
  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de resélectionner le même fichier plus tard
    if (!file || !userId) return;

    setAttachError(null);
    setUploadingDocument(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);

    try {
      const res = await fetch('/api/chat/document', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        setAttachError(body.error || t('chat.attachError', locale));
        return;
      }
      setPendingDocument(body.document);
    } catch {
      setAttachError(t('chat.attachError', locale));
    } finally {
      setUploadingDocument(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSendError(null);

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    // Questionnaire de découverte guidé : on avance question par question,
    // en local pour la logique de progression (prévisible, jamais bloquée
    // par un souci réseau/API) — mais avec, depuis le docx item A4, UN appel
    // IA léger avant d'enchaîner, pour qu'Aaron accuse réception de la
    // réponse au lieu de passer à la question suivante comme si de rien
    // n'était (cas remonté par Alex : répondre qu'un "premier contact" est
    // déjà un rendez-vous doit être reconnu, pas ignoré). Best-effort : si
    // l'appel échoue ou que le plafond API est atteint, on retombe sur
    // l'ancien comportement (juste la question suivante, sans accroche) —
    // jamais bloquant pour la progression du questionnaire.
    const onboardingQuestions = getOnboardingQuestions(locale);
    if (onboardingStep >= 0 && onboardingStep < onboardingQuestions.length) {
      const askedQuestion = onboardingQuestions[onboardingStep];
      const updatedAnswers = [...onboardingAnswers, { question: askedQuestion, answer: userMessage.content }];
      setOnboardingAnswers(updatedAnswers);
      setSending(true);

      let ack = null;
      try {
        const ackRes = await fetch('/api/chat/onboarding-ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, question: askedQuestion, answer: userMessage.content }),
        });
        const ackData = await ackRes.json();
        ack = ackData.ack || null;
      } catch {
        // Voir commentaire ci-dessus — dégradation silencieuse.
      }

      const nextStep = onboardingStep + 1;
      let assistantMessage;
      let newOnboardingStep;
      if (nextStep < onboardingQuestions.length) {
        newOnboardingStep = nextStep;
        const nextQuestion = onboardingQuestions[nextStep];
        assistantMessage = { role: 'assistant', content: ack ? `${ack}\n\n${nextQuestion}` : nextQuestion };
        setOnboardingStep(nextStep);
      } else {
        newOnboardingStep = -1;
        const completion = t('chat.onboardingCompleteDocs', locale);
        assistantMessage = { role: 'assistant', content: ack ? `${ack}\n\n${completion}` : completion };
        setOnboardingStep(-1);
      }
      setSending(false);
      setMessages([...newMessages, assistantMessage]);

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
    setSendError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          message: userMessage.content,
          history: messages,
          attached_document: pendingDocument || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSendError(data.error || t('chat.sendError', locale));
        return;
      }

      // Aaron vient de sauvegarder le document joint (outil sauvegarder_document,
      // voir app/api/chat/route.ts) — le chip disparaît, sa propre réponse texte
      // confirme déjà l'action au commercial.
      if (data.document_saved) setPendingDocument(null);

      if (data.reply) {
        setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
      } else {
        setSendError(t('chat.sendError', locale));
      }
    } catch {
      // Réseau coupé, timeout, réponse non-JSON... — voir commentaire sur
      // sendError plus haut : avant ce correctif, cette branche n'existait
      // pas du tout et "sending" restait bloqué à true.
      setSendError(t('chat.sendError', locale));
    } finally {
      setSending(false);
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
            background: var(--bg); color: var(--muted); font-family: 'Inter', sans-serif;
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
            background: var(--bg); color: var(--accent-red); font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active={t('nav.chat', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('chat.eyebrow', locale)}</p>
          <h1>{t('chat.title', locale)}</h1>
        </div>
        <button className="btn-feedback" onClick={() => setShowFeedback(!showFeedback)}>
          {t('chat.feedbackButton', locale)}
        </button>
      </header>

      {feedbackSent && <p className="feedback-sent">{t('chat.feedbackSentBanner', locale)}</p>}

      {showFeedback && (
        <form className="feedback-form" onSubmit={handleSendFeedback}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t('chat.feedbackPlaceholder', locale)}
            rows={3}
          />
          <div className="feedback-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowFeedback(false)}>{t('common.cancel', locale)}</button>
            <button type="submit" className="btn-primary" disabled={feedbackSending || !feedbackText.trim()}>
              {feedbackSending ? t('chat.sending', locale) : t('chat.send', locale)}
            </button>
          </div>
        </form>
      )}

      <div className="chat-box">
        <div className="messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="intro">
              <p>
                {isWelcome
                  ? t('common.loading', locale)
                  : t('chat.introGreeting', locale)}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="bubble assistant typing">{t('chat.aaronThinking', locale)}</div>}
          <div ref={bottomRef} />
        </div>

        {isWelcome && !summaryDone && (
          <div className="welcome-actions">
            <button type="button" className="btn-secondary" onClick={handleGenerateSummary} disabled={summarizing}>
              {summarizing ? t('chat.generatingSummary', locale) : t('chat.generateSummaryButton', locale)}
            </button>
          </div>
        )}

        {(pendingDocument || uploadingDocument || attachError || sendError) && (
          <div className="attach-row">
            {uploadingDocument && <span className="attach-chip attach-loading">{t('chat.attachUploading', locale)}</span>}
            {pendingDocument && !uploadingDocument && (
              <span className="attach-chip">
                📎 {pendingDocument.file_name}
                <button
                  type="button"
                  className="attach-remove"
                  onClick={() => setPendingDocument(null)}
                  aria-label={t('chat.attachRemove', locale)}
                >
                  ✕
                </button>
              </span>
            )}
            {attachError && <span className="attach-error">{attachError}</span>}
            {sendError && <span className="attach-error">{sendError}</span>}
          </div>
        )}

        <form className="input-row" onSubmit={handleSend}>
          <input
            ref={fileInputRef}
            type="file"
            className="file-input-hidden"
            onChange={handleFileSelected}
            accept=".pdf,.txt,.csv,.doc,.docx,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <button
            type="button"
            className="btn-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploadingDocument}
            title={t('chat.attachButton', locale)}
            aria-label={t('chat.attachButton', locale)}
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Entrée envoie (comme WhatsApp) ; Maj+Entrée insère un retour
              // à la ligne — sinon impossible d'écrire un message multi-ligne
              // avec un <textarea> qui envoie sur Entrée simple.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !sending) handleSend(e);
              }
            }}
            placeholder={t('chat.inputPlaceholder', locale)}
            disabled={sending}
          />
          <button type="submit" className="btn-send" disabled={sending || !input.trim()}>
            {t('chat.send', locale)}
          </button>
        </form>
      </div>

      {/* docx AJOUT GLOBAL item A8 : "revoir la visite guidée" doit rester
          accessible en permanence juste sous le chat (pas seulement pendant
          l'onboarding, et plus dans le pied de page de Préférences — voir
          app/app/preferences/page.jsx). */}
      <div className="tour-link-row">
        <Link href={`/app/tour${userId ? `?user_id=${userId}` : ''}`} className="tour-link">
          {t('chat.viewTourButton', locale)}
        </Link>
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
          border-radius: var(--radius-md);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .feedback-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: var(--accent-green);
          padding: 0.7rem 1rem;
          border-radius: var(--radius-md);
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
        .feedback-form {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .feedback-form textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
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
          border-radius: var(--radius-sm);
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
          border-radius: var(--radius-lg);
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
          border-radius: var(--radius-lg);
          font-size: 0.9rem;
          line-height: 1.45;
          white-space: pre-wrap;
          overflow-wrap: break-word;
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
        .tour-link-row {
          text-align: center;
          margin-top: 0.8rem;
        }
        .tour-link {
          color: var(--muted);
          font-size: 0.82rem;
          text-decoration: underline;
        }
        .tour-link:hover {
          color: var(--text);
        }
        .attach-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          padding: 0 1rem;
          margin-top: 0.6rem;
        }
        .attach-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.35rem 0.7rem;
          font-size: 0.8rem;
        }
        .attach-loading {
          color: var(--muted);
        }
        .attach-remove {
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0;
          line-height: 1;
        }
        .attach-remove:hover {
          color: var(--accent-red);
        }
        .attach-error {
          color: var(--accent-red);
          font-size: 0.8rem;
        }
        .file-input-hidden {
          display: none;
        }
        .btn-attach {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-md);
          width: 2.6rem;
          height: 2.6rem;
          flex-shrink: 0;
          font-size: 1rem;
          cursor: pointer;
        }
        .btn-attach:hover {
          color: var(--text);
          border-color: var(--accent);
        }
        .btn-attach:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .input-row {
          display: flex;
          align-items: flex-end;
          gap: 0.6rem;
          padding: 1rem;
          border-top: 1px solid var(--border);
        }
        .chat-textarea {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 1rem;
          color: var(--text);
          font-size: 0.9rem;
          font-family: inherit;
          line-height: 1.4;
          resize: none;
          /* docx item A2 : s'agrandit avec le contenu (voir l'effet JS qui
             ajuste style.height) jusqu'à ~6 lignes, puis défile — comme un
             champ de saisie WhatsApp, sans jamais avaler toute la page. */
          min-height: 2.6rem;
          max-height: 9rem;
          overflow-y: auto;
        }
        .btn-send {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-md);
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
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
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
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.preferences', locale), slug: 'preferences', icon: '⚙️' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
    { label: t('nav.suggestions', locale), slug: 'suggestions', icon: '💡' },
  ];
  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label={t('shell.openMenu', locale)}
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
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            {t('shell.connected', locale)}
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            {t('common.logout', locale)}
          </button>
        </div>
      </nav>
      <main className="content">{children}</main>
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
