// app/app/chat/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { ONBOARDING_QUESTION_KEYS, ONBOARDING_QUESTION_SUGGESTIONS, getOnboardingQuestions } from '@/lib/onboarding-questions';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import RailMore, { railLinkClass } from '@/components/RailMore';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import Ic from '@/components/UiIcon';
import { frenchTypography } from '@/lib/text-typography';
import { buildBusinessProfilePreview } from '@/lib/business-profile-format';

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

// Questions de découverte et puces : voir lib/onboarding-questions.js (partagé
// avec le parcours de première connexion, 22/10/2026).

// Code langue BCP47 attendu par SpeechSynthesisUtterance.lang — la voix
// utilisée dépend ensuite des voix installées côté navigateur/OS de
// l'utilisateur (hors de notre contrôle), mais indiquer la bonne langue
// aide le navigateur à choisir une voix cohérente quand plusieurs sont
// disponibles.
const SPEECH_LANG_BY_LOCALE = {
  fr: 'fr-FR',
  en: 'en-US',
  de: 'de-DE',
  it: 'it-IT',
  es: 'es-ES',
  pt: 'pt-PT',
  nl: 'nl-NL',
};

// Libellé de séparateur de jour dans le fil (refonte messagerie
// 01/09/2026) : « Aujourd'hui » / « Hier » / date complète, comme Messenger.
function dayLabel(date, locale) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (date.toDateString() === today.toDateString()) return t('chat.dayToday', locale);
  if (date.toDateString() === yesterday.toDateString()) return t('chat.dayYesterday', locale);
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
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
  // Bug remonté par Alex (27/08/2026) : le bouton "Générer le résumé" se
  // basait sur `isWelcome` seul — donc visible dès la 1ère question (jamais
  // "à la toute fin" comme demandé), ET absent en régénération depuis Mon
  // compte (ce flux ne passe jamais par `isWelcome`, voir restartRequested
  // plus bas). `questionnaireDone` est mis à true UNIQUEMENT quand la
  // dernière question du questionnaire vient d'être répondue (voir
  // handleSend), pour les deux flux à la fois — donc jamais avant la fin,
  // et toujours visible ensuite quel que soit le flux d'origine.
  const [questionnaireDone, setQuestionnaireDone] = useState(false);
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
  // Vrai seulement si le questionnaire a été (re)démarré par un clic dans
  // CETTE session — voir l'effet « questionnaire fantôme » plus bas.
  const explicitStartRef = useRef(false);
  // Dépôt de document dans le chat (demande d'Alex, 22/08/2026) : pendingDocument
  // contient les métadonnées du document déjà uploadé (voir
  // app/api/chat/document/route.ts) mais pas encore sauvegardé dans "Mes
  // documents" — renvoyé à chaque appel /api/chat tant qu'il reste "joint",
  // pour qu'Aaron continue d'avoir accès à son contenu sur plusieurs tours
  // (ex: le temps qu'il demande confirmation de sauvegarde). Il disparaît
  // uniquement quand Aaron l'a sauvegardé (data.document_saved, voir
  // handleSend) ou quand le commercial le retire lui-même via le ✕ du chip.
  //
  // Bug remonté par Alex (29/08/2026) : une fois le document envoyé dans un
  // message (visible dans la bulle, voir bubble-attachment plus bas), le chip
  // flottant au-dessus du champ de saisie restait affiché tel quel — donnant
  // l'impression que le document n'avait pas été envoyé (comme sur
  // Claude.ai/ChatGPT, où le fichier "part" dans la conversation et
  // disparaît de la zone de saisie). `pendingDocumentAlreadyInChat` (calculé
  // plus bas, avant le rendu) détecte que ce document apparaît déjà dans un
  // message envoyé et cache alors le chip flottant — le document continue
  // néanmoins d'être transmis à Aaron en arrière-plan tant qu'il n'est pas
  // sauvegardé/retiré, seul l'affichage change.
  const [pendingDocument, setPendingDocument] = useState(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [attachError, setAttachError] = useState(null);
  // Demande Alex (29/08/2026) : une fois qu'Aaron a posé (une fois) la
  // question "tu veux que je sauvegarde ce document ?", on affiche 2 boutons
  // de réponse rapide (Oui/Non) sous SA réponse plutôt que de forcer le
  // commercial à taper "oui"/"non" — voir le bloc offerSaveDocument dans
  // handleSend. Remis à false à chaque nouveau document joint (voir
  // handleFileSelected) pour pouvoir reproposer les boutons sur le suivant.
  const [docSaveAsked, setDocSaveAsked] = useState(false);
  // Filet de sécurité sur l'appel /api/chat (l'appel principal, hors
  // questionnaire de découverte) : avant, aucun try/catch ici — une erreur
  // réseau ou un 500 sans JSON valide faisait planter handleSend en plein
  // vol, "sending" restait bloqué à true (input verrouillé indéfiniment) et
  // rien n'informait le commercial. Voir aussi chat.sendError (lib/i18n.js).
  const [sendError, setSendError] = useState(null);
  // Conversations multiples (demande d'Alex, 25/08/2026) : "possibilité
  // d'ouvrir une nouvelle conversation" + "possibilité de mettre une conv en
  // favoris" — voir migration_chat_conversations_2026-08-25.sql. Conservation
  // illimitée (comme Claude/ChatGPT) : `conversations` peut contenir plus de
  // 10 entrées, rien n'est supprimé automatiquement. `activeConversationId`
  // est celle actuellement affichée dans la boîte de chat.
  const [conversations, setConversations] = useState([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [conversationsError, setConversationsError] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [creatingConversation, setCreatingConversation] = useState(false);
  // Tiroir « mes conversations » (refonte messagerie 01/09/2026).
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  // Bug remonté par Alex (26/08/2026) : un document joint mais pas encore
  // confirmé/sauvegardé (pendingDocument) disparaissait dès qu'on quittait la
  // page (changement de rubrique) et qu'on y revenait — c'est un state React
  // pur, qui repart à `null` à chaque montage du composant, exactement comme
  // le brouillon ci-dessus avant son propre correctif. Le fichier reste bien
  // dans Storage entre-temps (voir app/api/chat/document/route.ts) : seule la
  // référence en mémoire était perdue. Même traitement que draftStorageKey.
  const pendingDocStorageKey = userId ? `meetaaron_chat_pending_doc_${userId}` : null;

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

  // Item 6 (docx Modifs Aaron 30/08/2026) : "lorsque le commercial se connecte
  // via un code envoyé par le fondateur, Aaron ajoute automatiquement le
  // profil entreprise — pas besoin pour le salarié de recréer la fiche".
  // Le profil vit déjà sur la société (companies.business_summary, partagé
  // par tous les comptes de la même société) ; il restait à ne PAS relancer
  // le questionnaire à l'arrivée d'un commercial dont la société a déjà son
  // profil (sinon ses réponses auraient écrasé celui du fondateur). Chargé
  // uniquement sur l'accueil (?welcome=1), seul endroit où ça se décide.
  const [companyProfileExists, setCompanyProfileExists] = useState(null); // null = pas encore su
  // CHARGE SUR TOUTE OUVERTURE DU CHAT DEPUIS LE 12/10/2026 — avant, la
  // condition etait « !userId || !isWelcome », donc cette information
  // n'etait lue QUE sur l'accueil (?welcome=1).
  //
  // Consequence : le garde-fou « questionnaire fantome » plus bas commence
  // par `if (companyProfileExists !== true) return;`. Sur une arrivee directe
  // sur /app/chat — c'est-a-dire le cas NORMAL, celui du menu de gauche —
  // la valeur restait a null, le garde-fou ne s'executait jamais, et un
  // onboarding_step residuel en base relancait le questionnaire depuis la
  // question 1. Exactement le symptome remonte par Alex le 12/10 apres avoir
  // deconnecte sa boite mail : « ca me redemande a nouveau mon activite,
  // c'est idiot ».
  //
  // Le correctif du 04/09 etait donc juste sur le fond et trop etroit sur la
  // portee. Regle voulue : le questionnaire ne se demande QU'UNE FOIS, sauf
  // relance explicite (?restart_questionnaire=1) ou compte supprime puis
  // recree. Deconnecter une boite mail n'a rien a voir avec le profil
  // d'entreprise et ne doit evidemment rien relancer.
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/business-summary?user_id=${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setCompanyProfileExists(!!res?.summary))
      .catch(() => setCompanyProfileExists(false));
  }, [userId]);

  // Item 11 (docx Modifs Aaron 30/08/2026) : "au bout de 24 h la conversation
  // est classée en historique — mais pas 24 h après le DÉBUT : imagine
  // l'utilisateur qui utilise le chat pendant 2 h et hop, classé." La règle
  // est donc l'INACTIVITÉ : 24 h sans aucun message (updated_at de la
  // conversation, remis à jour à chaque message par /api/chat-history et
  // /api/chat). Au-delà, une nouvelle conversation démarre automatiquement
  // et l'ancienne reste dans la liste (rien n'est supprimé). Exceptions :
  // conversation encore vide (on la réutilise), questionnaire de profil en
  // cours (on ne coupe pas le fil des questions), et réouverture manuelle
  // d'une ancienne conversation (voir inactivityCheckPendingRef).
  const CONVERSATION_INACTIVITY_MS = 24 * 60 * 60 * 1000;
  const inactivityCheckPendingRef = useRef(false);
  async function rotateInactiveConversation() {
    const res = await fetch('/api/chat-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!body?.conversation) return false;
    setConversations((prev) => [body.conversation, ...prev]);
    setActiveConversationId(body.conversation.id);
    try {
      window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, body.conversation.id);
    } catch {
      // Voir draftStorageKey plus haut.
    }
    return true;
  }

  // Résout la conversation à afficher (voir migration_chat_conversations_2026-08-25.sql) :
  // reprend la dernière conversation ouverte par ce commercial sur cet appareil
  // (localStorage, même principe que draftStorageKey plus haut), sinon la plus
  // récente renvoyée par l'API, sinon en crée une nouvelle si aucune n'existe
  // encore (tout premier message d'un commercial).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const activeKey = `meetaaron_chat_active_conversation_${userId}`;
    // Une erreur d'un premier chargement (identifiant pas encore confirmé)
    // ne doit pas rester affichée après un rechargement réussi.
    setConversationsError(false);

    fetch(`/api/chat-conversations?user_id=${userId}`)
      .then((r) => r.json())
      .then(async (res) => {
        if (cancelled) return;
        if (!Array.isArray(res.conversations)) {
          setConversationsError(true);
          return;
        }
        let list = res.conversations;
        setConversations(list);

        let savedId = null;
        try {
          savedId = window.localStorage.getItem(activeKey);
        } catch {
          // localStorage indisponible — voir draftStorageKey plus haut, même dégradation silencieuse.
        }
        let chosen = list.find((c) => c.id === savedId) || list[0] || null;

        if (!chosen) {
          // Tout premier passage de ce commercial : pas encore de conversation en base.
          const createRes = await fetch('/api/chat-conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
          }).catch(() => null);
          const createBody = createRes ? await createRes.json().catch(() => null) : null;
          if (createBody?.conversation) {
            chosen = createBody.conversation;
            setConversations([chosen]);
          }
        }

        if (chosen) {
          // Item 11 (docx 30/08) : la vérification "24 h sans échange" ne se
          // fait qu'à l'arrivée sur la page, jamais quand le commercial
          // rouvre lui-même une vieille conversation depuis la liste.
          inactivityCheckPendingRef.current = true;
          setActiveConversationId(chosen.id);
          try {
            window.localStorage.setItem(activeKey, chosen.id);
          } catch {
            // Voir plus haut.
          }
        }
      })
      .catch(() => setConversationsError(true))
      .finally(() => !cancelled && setConversationsLoaded(true));

    return () => { cancelled = true; };
  }, [userId]);


  // Rapatrie l'historique déjà persisté (voir migration_chat_history_2026-08-13.sql
  // et app/api/chat-history/route.ts) avant toute décision d'afficher l'accueil —
  // sans ça, revenir sur cette page après être parti ailleurs (ex: "Mes documents")
  // en plein questionnaire d'onboarding faisait tout recommencer à zéro. Se
  // redéclenche à chaque changement de conversation active (nouvelle
  // conversation créée, ou changement manuel depuis la liste ci-dessous).
  useEffect(() => {
    if (!userId || !activeConversationId) return;
    setHistoryLoaded(false);
    setMessages([]);
    let rotated = false;
    fetch(`/api/chat-history?user_id=${userId}&conversation_id=${activeConversationId}`)
      .then((r) => r.json())
      .then(async (res) => {
        const hasMessages = Array.isArray(res.messages) && res.messages.length > 0;
        const step = typeof res.onboarding_step === 'number' ? res.onboarding_step : -1;
        if (inactivityCheckPendingRef.current) {
          inactivityCheckPendingRef.current = false;
          const conv = conversations.find((c) => c.id === activeConversationId);
          const lastActivity = conv?.updated_at ? new Date(conv.updated_at).getTime() : Date.now();
          const inactiveForTooLong = Date.now() - lastActivity > CONVERSATION_INACTIVITY_MS;
          if (hasMessages && inactiveForTooLong && step < 0 && !isWelcome && !restartRequested) {
            rotated = await rotateInactiveConversation();
            if (rotated) return; // l'effet se relance sur la nouvelle conversation (vide)
          }
        }
        if (hasMessages) {
          setMessages(res.messages);
          setOnboardingStep(step);
          setOnboardingAnswers(Array.isArray(res.onboarding_answers) ? res.onboarding_answers : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!rotated) setHistoryLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, activeConversationId]);

  // Bug remonté par Alex (29/08/2026, "il va falloir que moi et Ludovic on
  // répondent encore une fois au questionnaire ?") : questionnaireDone (voir
  // plus haut) n'était mis à true QUE juste après avoir répondu à la
  // dernière question EN DIRECT (handleSend) — jamais recalculé depuis
  // l'historique déjà persisté en base (onboarding_step/onboarding_answers,
  // hydratés par l'effet juste au-dessus). Un commercial ayant déjà terminé
  // le questionnaire lors d'une session précédente ne revoyait donc JAMAIS
  // le bouton "Générer le profil de l'entreprise" en revenant sur cette page
  // plus tard — comme si le questionnaire n'avait jamais été fait, alors que
  // ses réponses étaient bien là. onboarding_step === -1 ET au moins une
  // réponse enregistrée = questionnaire déjà terminé (onboarding_step vaut
  // aussi -1 avant le tout premier démarrage, d'où le ET sur les réponses
  // pour ne pas confondre "jamais commencé" et "déjà fini"). Sans incidence
  // sur "Reprendre le questionnaire" (repart avec onboarding_answers vide,
  // donc cette condition ne redevient vraie qu'une fois réellement refini).
  useEffect(() => {
    if (onboardingStep === -1 && onboardingAnswers.length > 0) {
      setQuestionnaireDone(true);
    }
  }, [onboardingStep, onboardingAnswers]);

  // Questionnaire FANTÔME (bug remonté par Alex, 04/09/2026 : « pourquoi il me
  // redemande le questionnaire alors qu'on avait déjà échangé dessus et que
  // j'ai mon profil d'entreprise ? »).
  // Cause : onboarding_step est stocké sur l'UTILISATEUR (pas sur la
  // conversation). L'ancienne relance automatique — supprimée hier — avait
  // laissé onboarding_step = 0 en base chez les utilisateurs touchés. À chaque
  // ouverture du chat, l'historique remettait donc la page en mode
  // questionnaire, et le premier « Bonjour » repartait sur la question 1.
  // Règle : quand le profil de l'entreprise existe déjà, un questionnaire ne
  // peut être en cours QUE s'il a été démarré par un clic dans cette session.
  // Tout autre état « en cours » venu de la base est un résidu : on le remet
  // à -1, et on le persiste pour que ça ne revienne jamais.
  useEffect(() => {
    if (companyProfileExists !== true) return;
    if (onboardingStep < 0 || explicitStartRef.current) return;
    setOnboardingStep(-1);
    if (!userId) return;
    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, onboarding_step: -1 }),
    }).catch(() => {});
  }, [companyProfileExists, onboardingStep, userId]);

  useEffect(() => {
    if (!isWelcome || messages.length > 0) return;
    // On attend que le chargement du prénom soit TERMINÉ (succès ou échec, voir
    // userInfoLoaded ci-dessus) pour un accueil personnalisé quand c'est possible
    // — mais sans bloquer indéfiniment si ce fetch échoue.
    if (!userInfoLoaded) return;
    // On attend de savoir si un historique existe déjà en base avant de semer
    // l'accueil, pour ne pas écraser une conversation/un questionnaire en cours.
    if (!historyLoaded) return;
    // Item 6 : on attend de savoir si la société a déjà son profil.
    if (companyProfileExists === null) return;
    const firstName = userInfo ? (userInfo.first_name || (userInfo.full_name || '').split(' ')[0] || '') : '';
    const onboardingQuestions = getOnboardingQuestions(locale);
    const intro =
      `${t('chat.welcomeGreeting', locale).replace('{firstName}', firstName ? ' ' + firstName : '')}\n\n` +
      `• ${t('chat.welcomeBullet1', locale)}\n` +
      `• ${t('chat.welcomeBullet2', locale)}\n` +
      `• ${t('chat.welcomeBullet3', locale)}\n\n` +
      `${t('chat.welcomeNotDoing', locale)}\n\n`;

    if (companyProfileExists) {
      // Commercial qui rejoint une société déjà profilée (item 6) : pas de
      // questionnaire, le profil de l'équipe s'applique à lui.
      const welcomeMessages = [{ role: 'assistant', content: intro + t('chat.welcomeProfileAlreadyDone', locale) }];
      setMessages(welcomeMessages);
      setOnboardingStep(-1);
      setSummaryDone(true);
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          messages: welcomeMessages,
          onboarding_step: -1,
          onboarding_answers: [],
        }),
      }).catch(() => {});
      return;
    }

    const welcomeMessages = [
      { role: 'assistant', content: intro + t('chat.welcomeBeforeStart', locale) },
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
        conversation_id: activeConversationId,
        messages: welcomeMessages,
        onboarding_step: 0,
        onboarding_answers: [],
      }),
    }).catch(() => {});
  }, [isWelcome, messages.length, userInfo, userInfoLoaded, historyLoaded, userId, locale, activeConversationId, companyProfileExists]);

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
    // Item 13 (31/08/2026) : le tableau de bord renvoie ici chaque jour tant
    // que le profil n'est pas généré — si un questionnaire est DÉJÀ en cours
    // (étape >= 0), on le reprend là où il en était au lieu de l'effacer et
    // de tout recommencer.
    if (onboardingStep >= 0) {
      setRestartSeeded(true);
      return;
    }

    // CORRECTION 04/09/2026 (Alex : « gros problème, ça me repose le
    // questionnaire […] ce questionnaire doit être mis qu'une seule fois lors
    // de la création du compte »).
    //
    // Avant : arriver ici avec ?restart_questionnaire=1 RELANÇAIT le
    // questionnaire d'autorité — onboarding_step remis à 0 et
    // onboarding_answers VIDÉES. Or le tableau de bord pointe ce lien tant
    // que le profil d'entreprise n'est pas généré : un commercial dont le
    // profil manquait (ou avait été perdu, cf. le bug du 03/09) se voyait
    // donc reposer les 11 questions à chaque passage, en perdant à chaque
    // fois les réponses déjà données. C'est exactement ce qu'Alex a vécu.
    //
    // Désormais Aaron PROPOSE, il n'impose pas : un seul message avec deux
    // boutons. Tant que le commercial n'a pas cliqué « oui », rien n'est
    // touché — ni l'étape, ni les réponses, ni le profil. Le questionnaire
    // ne démarre donc plus jamais tout seul en dehors de la toute première
    // conversation d'un nouveau compte (voir l'effet `isWelcome` plus haut,
    // qui reste le SEUL démarrage automatique).
    //
    // Ce message d'offre n'est volontairement PAS persisté : il n'appartient
    // pas à la conversation, c'est une invite contextuelle. S'il est ignoré,
    // il ne laisse aucune trace dans l'historique.
    setMessages((prev) => [...prev, { role: 'assistant', content: t('chat.restartOfferTitle', locale), offerRestartQuestionnaire: true }]);
    setRestartSeeded(true);
  }, [restartRequested, restartSeeded, userInfoLoaded, historyLoaded, userId, locale, activeConversationId, onboardingStep]);

  // Démarrage EXPLICITE du questionnaire, déclenché seulement par le bouton
  // « Oui, on le refait » sous le message d'offre ci-dessus.
  function startQuestionnaireNow() {
    explicitStartRef.current = true;
    const onboardingQuestions = getOnboardingQuestions(locale);

    // Bug remonté par Alex (06/09/2026, capture du chat) : « il ne faut pas
    // qu'Aaron pose la question du questionnaire vu qu'on y a déjà répondu ».
    // Avant, « reprendre le questionnaire » remettait onboarding_step à 0 ET
    // VIDAIT onboarding_answers : Aaron reposait la question 1 (« dans quel
    // secteur d'activité travailles-tu ? ») à quelqu'un qui y avait déjà
    // répondu et dont le profil d'entreprise existait. On repart désormais là
    // où le commercial s'était arrêté : les réponses sont conservées (elles
    // sont strictement séquentielles, une par question, voir handleSend) et
    // l'étape reprise est simplement le nombre de réponses déjà données.
    const answered = Array.isArray(onboardingAnswers) ? onboardingAnswers.length : 0;

    // Tout est déjà répondu : on ne repose RIEN. Aaron dit ce qu'il sait et
    // laisse le commercial nommer le point à corriger — c'est une relecture,
    // pas un nouveau questionnaire.
    if (answered >= onboardingQuestions.length) {
      const doneMessages = [{ role: 'assistant', content: t('chat.questionnaireAlreadyComplete', locale) }];
      setMessages((prev) => [...prev.filter((m) => !m.offerRestartQuestionnaire), ...doneMessages]);
      setOnboardingStep(-1);
      setQuestionnaireDone(true);
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          messages: doneMessages,
          onboarding_step: -1,
        }),
      }).catch(() => {});
      return;
    }

    const resumeStep = answered;
    const intro =
      resumeStep > 0
        ? t('chat.resumeQuestionnaireIntro', locale)
            .replace('{done}', String(resumeStep))
            .replace('{total}', String(onboardingQuestions.length))
        : t('chat.restartQuestionnaireIntro', locale);
    const restartMessages = [
      { role: 'assistant', content: intro },
      { role: 'assistant', content: onboardingQuestions[resumeStep] },
    ];
    // Retire l'invite (non persistée) avant d'ajouter le vrai démarrage.
    setMessages((prev) => [...prev.filter((m) => !m.offerRestartQuestionnaire), ...restartMessages]);
    setOnboardingStep(resumeStep);
    setSummaryDone(false);
    setQuestionnaireDone(false);

    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        conversation_id: activeConversationId,
        messages: restartMessages,
        onboarding_step: resumeStep,
      }),
    }).catch(() => {});
  }

  // Refus : on retire l'invite et on répond une ligne, sans rien persister ni
  // modifier. Le commercial retrouve sa conversation exactement comme avant.
  function declineQuestionnaireRestart() {
    setMessages((prev) => [
      ...prev.filter((m) => !m.offerRestartQuestionnaire),
      { role: 'assistant', content: t('chat.restartDeclinedMessage', locale) },
    ]);
  }

  // docx item A3 : scroller uniquement la liste de messages elle-même (pas
  // toute la page) à chaque nouveau message. `scrollIntoView` sans option
  // `block: 'nearest'` peut aussi faire défiler des ancêtres qui montrent
  // déjà l'élément (ex: la page entière si le fil dépasse la fenêtre),
  // ce qui produisait le "la page descend toute seule" remonté par Alex — on
  // manipule directement `scrollTop` du conteneur scrollable pour rester
  // strictement local à la boîte de chat.
  //
  // Item 14 (docx Modifs Aaron 30/08/2026) : "parfois Aaron écrit 2 messages
  // à la suite — dans ce cas, ancrer la première ligne du premier message,
  // car là ça descend tout en bas et on ne comprend pas". Quand ce sont des
  // messages d'Aaron qui arrivent, on cale donc le haut de la boîte sur le
  // DÉBUT du premier nouveau message (le commercial lit de haut en bas,
  // comme sur ChatGPT) ; quand c'est le commercial qui vient d'envoyer, ou
  // pendant qu'Aaron "écrit", on reste tout en bas comme avant.
  const previousMessageCountRef = useRef(0);
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    const appended = messages.length - previousCount;
    if (!sending && appended > 0 && previousCount > 0 && messages[messages.length - 1]?.role === 'assistant') {
      let first = messages.length - 1;
      while (first - 1 >= previousCount && messages[first - 1]?.role === 'assistant') first -= 1;
      const rows = el.querySelectorAll('.msg-row');
      const target = rows[first];
      if (target) {
        el.scrollTop = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 6;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
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

  // Restaure le document en attente (pas encore sauvegardé) dès que
  // l'utilisateur est connu — même principe que le brouillon ci-dessus, une
  // seule fois pour ne pas écraser un nouvel upload en cours.
  //
  // Bug trouvé le 27/08/2026 (Alex : le document "perd son contexte actif"
  // en pleine conversation, sans même changer de page) : cet effet de
  // restauration et celui de sauvegarde ci-dessous s'exécutaient tous les
  // deux au montage, DANS LE MÊME lot d'effets. `setPendingDocument(doc)`
  // ici ne met pas à jour la variable `pendingDocument` capturée par la
  // closure de l'effet de sauvegarde suivant (le re-render n'a pas encore eu
  // lieu) — cet effet de sauvegarde voyait donc encore `pendingDocument ===
  // null` et appelait `localStorage.removeItem(...)`, effaçant SILENCIEUSEMENT
  // la valeur que cet effet-ci venait tout juste de lire. Le document restait
  // affiché (state React déjà mis à jour) mais sa sauvegarde localStorage
  // avait disparu : le prochain démontage du composant (nouvel onglet du
  // chat, changement de conversation, etc.) le perdait pour de bon, avant
  // même que l'outil sauvegarder_document n'ait pu agir. `pendingDocRestored`
  // (state, pas juste une ref) bloque l'effet de sauvegarde tant que la
  // restauration n'est pas passée par au moins un rendu.
  const [pendingDocRestored, setPendingDocRestored] = useState(false);
  useEffect(() => {
    if (!pendingDocStorageKey || pendingDocRestored) return;
    try {
      const saved = window.localStorage.getItem(pendingDocStorageKey);
      if (saved) setPendingDocument(JSON.parse(saved));
    } catch {
      // localStorage indisponible ou JSON corrompu — le document restera
      // simplement non restauré, sans bloquer le reste de la page.
    } finally {
      setPendingDocRestored(true);
    }
  }, [pendingDocStorageKey, pendingDocRestored]);

  // Sauvegarde le document en attente à chaque changement, pour qu'il
  // survive un aller-retour vers une autre rubrique. Gated sur
  // `pendingDocRestored` (voir commentaire ci-dessus) : ne s'exécute qu'une
  // fois la restauration effectivement passée par un rendu, jamais avant.
  useEffect(() => {
    if (!pendingDocStorageKey || !pendingDocRestored) return;
    try {
      if (pendingDocument) {
        window.localStorage.setItem(pendingDocStorageKey, JSON.stringify(pendingDocument));
      } else {
        window.localStorage.removeItem(pendingDocStorageKey);
      }
    } catch {
      // Voir plus haut.
    }
  }, [pendingDocStorageKey, pendingDocument, pendingDocRestored]);

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

  // Profil d'entreprise enrichi (demande Alex, 29/08/2026) : le document
  // généré par /api/business-summary est désormais structuré en sections
  // (titres "## ", voir lib/business-profile-format.ts) et peut être bien
  // plus long que l'ancien résumé de 5-9 phrases. Alex a explicitement
  // demandé de ne plus le déverser en entier dans la bulle de chat ("ca
  // devait être un résumé style word... on en voit un aperçu de texte") —
  // cette fonction construit un court aperçu en prose (titres retirés, texte
  // tronqué) pour la bulle, le document complet restant consultable via le
  // bouton "Voir le profil de l'entreprise" (Mon compte > Mon entreprise).
  // buildBusinessProfilePreview vit maintenant dans lib/business-profile-format.ts
  // (factorisé le 29/08/2026 pour être réutilisé aussi dans Mon compte > Mon
  // entreprise, voir app/app/connexions/page.jsx) — comportement inchangé.
  const buildSummaryPreview = buildBusinessProfilePreview;

  // Item 12 : tant que le profil se génère, le navigateur demande
  // confirmation avant de fermer/quitter l'onglet (message générique imposé
  // par les navigateurs — impossible de le personnaliser).
  useEffect(() => {
    if (!summarizing) return undefined;
    const guard = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [summarizing]);

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
          `${t('chat.summaryIntro', locale)}\n\n${buildSummaryPreview(data.summary)}\n\n` +
          t('chat.summaryOutro', locale),
        viewProfileLink: true,
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
      setDocSaveAsked(false); // nouveau document -> on peut reproposer les boutons Oui/Non
    } catch {
      setAttachError(t('chat.attachError', locale));
    } finally {
      setUploadingDocument(false);
    }
  }

  // Demande Alex (29/08/2026) : refactor pour accepter un texte "en dur"
  // (overrideText) en plus du contenu du champ de saisie — utilisé par les
  // boutons de réponse rapide Oui/Non (voir plus bas) qui envoient
  // directement une réponse sans passer par le <textarea>, contrairement aux
  // "chips" de suggestion du questionnaire d'onboarding qui ne font eux que
  // PRÉ-REMPLIR le champ (voir suggestion-chip plus haut, comportement
  // inchangé).
  async function handleSend(e, overrideText) {
    if (e?.preventDefault) e.preventDefault();
    const rawText = overrideText !== undefined ? overrideText : input;
    // Bug remonté par Alex (29/08/2026) : impossible d'envoyer un document
    // seul, sans texte — le bouton "Envoyer" restait grisé et cette garde
    // bloquait l'envoi tant que le champ était vide, même avec un document
    // joint. Un document joint suffit désormais à autoriser l'envoi (voir
    // aussi btn-send plus bas, même condition).
    if ((!rawText.trim() && !pendingDocument) || sending) return;
    setSendError(null);

    // Texte de repli quand on envoie un document seul, sans rien écrire —
    // voir chat.attachOnlyMessage (lib/i18n.js).
    const messageContent = rawText.trim() || t('chat.attachOnlyMessage', locale);

    // UX pièce jointe (demande Alex, 27/08/2026, façon ChatGPT/Claude) : le
    // fichier joint s'affiche désormais comme un repère DANS la bulle de
    // message envoyée, pas seulement comme un chip flottant au-dessus du
    // champ de saisie. Le chip lui-même reste inchangé côté logique (voir
    // pendingDocument plus haut) — il doit continuer à être renvoyé à chaque
    // tour tant que le document n'est pas sauvegardé/retiré, potentiellement
    // sur plusieurs messages d'affilée (le temps qu'Aaron demande
    // confirmation) — seul l'AFFICHAGE de CE message précis change : on note
    // simplement, au moment de l'envoi, quel document était joint à ce
    // tour-ci, pour l'afficher dans sa bulle d'historique.
    const userMessage = {
      role: 'user',
      content: messageContent,
      ...(pendingDocument ? { attachment: { file_name: pendingDocument.file_name } } : {}),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    // Questionnaire de découverte guidé : on avance question par question,
    // en local pour la logique de progression (prévisible, jamais bloquée
    // par un souci réseau/API), mais chaque message est d'abord CLASSÉ par
    // un appel IA léger (/api/chat/onboarding-ack) : est-ce une vraie
    // réponse à la question posée, ou une question/incompréhension de la
    // part du commercial ? Retour Alex (2026-08-25, capture à l'appui) :
    // avant ce correctif, un message comme "c'est à dire ?" était traité
    // comme SI c'était la réponse, et Aaron enchaînait quand même sur la
    // question suivante — un simple formulaire déguisé, pas une vraie
    // interaction. Maintenant : si ce n'est pas une réponse, Aaron clarifie
    // (reply) et REPOSE la même question, sans avancer ni enregistrer quoi
    // que ce soit comme réponse. Best-effort : si l'appel échoue ou que le
    // plafond API est atteint, on retombe sur l'ancien comportement (avance
    // directement, sans accroche) — jamais bloquant pour la progression.
    const onboardingQuestions = getOnboardingQuestions(locale);
    if (onboardingStep >= 0 && onboardingStep < onboardingQuestions.length) {
      const askedQuestion = onboardingQuestions[onboardingStep];
      setSending(true);

      let isAnswer = true;
      let reply = null;
      try {
        const ackRes = await fetch('/api/chat/onboarding-ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // previous_answers (01/09/2026) : sans elles, l'appel ne voyait
          // QUE la question posée et la réponse brute, sans savoir ce que
          // vend la société — Aaron comblait le vide avec un mot plausible
          // mais faux ("cabinet" pour un distributeur de portes de garage,
          // signalé par le père d'Alex). Les réponses déjà données dans ce
          // même questionnaire sont le seul contexte fiable disponible à ce
          // stade (business_summary n'existe pas encore, il est justement
          // généré à la fin) — on les transmet pour qu'Aaron accuse
          // réception dans les mots du commercial, pas dans les siens.
          body: JSON.stringify({
            user_id: userId,
            question: askedQuestion,
            answer: userMessage.content,
            previous_answers: onboardingAnswers,
          }),
        });
        const ackData = await ackRes.json();
        isAnswer = ackData.is_answer !== false;
        reply = ackData.reply || null;
      } catch {
        // Voir commentaire ci-dessus — dégradation silencieuse.
      }

      let assistantMessage;
      let newOnboardingStep;
      let answersToSave = onboardingAnswers;

      if (!isAnswer) {
        // Pas une réponse : on ne fait PAS avancer le questionnaire, et on
        // n'enregistre RIEN comme réponse à la question posée — sinon "c'est
        // à dire ?" se retrouverait enregistré comme réponse au résumé final.
        newOnboardingStep = onboardingStep;
        assistantMessage = { role: 'assistant', content: reply || askedQuestion };
      } else {
        const updatedAnswers = [...onboardingAnswers, { question: askedQuestion, answer: userMessage.content }];
        answersToSave = updatedAnswers;
        setOnboardingAnswers(updatedAnswers);

        const nextStep = onboardingStep + 1;
        if (nextStep < onboardingQuestions.length) {
          newOnboardingStep = nextStep;
          const nextQuestion = onboardingQuestions[nextStep];
          assistantMessage = { role: 'assistant', content: reply ? `${reply}\n\n${nextQuestion}` : nextQuestion };
          setOnboardingStep(nextStep);
        } else {
          newOnboardingStep = -1;
          const completion = t('chat.onboardingCompleteDocs', locale);
          assistantMessage = { role: 'assistant', content: reply ? `${reply}\n\n${completion}` : completion };
          setOnboardingStep(-1);
          // Voir le commentaire sur questionnaireDone plus haut : dernière
          // question tout juste répondue, donc c'est exactement ici (jamais
          // avant) que le bouton "Générer le résumé" doit devenir visible.
          setQuestionnaireDone(true);
        }
      }

      setSending(false);
      setMessages([...newMessages, assistantMessage]);

      // Persiste ce tour de questionnaire (question + réponse, si c'en était
      // vraiment une) et la nouvelle progression, pour ne pas la reperdre si
      // la page est quittée avant la fin.
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          messages: [userMessage, assistantMessage],
          onboarding_step: newOnboardingStep,
          onboarding_answers: answersToSave,
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
          conversation_id: activeConversationId,
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

      // Boutons de réponse rapide Oui/Non (demande Alex, 29/08/2026) : un
      // document reste joint et Aaron ne vient pas de le sauvegarder dans CE
      // tour -> c'est très probablement le tour où il pose sa question "tu
      // veux que je le sauvegarde ?" (il ne la pose qu'une fois par document,
      // voir CHAT_SYSTEM_PROMPT côté serveur). On ne propose les boutons
      // qu'une seule fois par document (docSaveAsked) pour ne pas les
      // réafficher sur tous les tours suivants tant que le document reste
      // attaché en arrière-plan.
      const offerSaveDocument = !!pendingDocument && !data.document_saved && !docSaveAsked;
      if (offerSaveDocument) setDocSaveAsked(true);

      // Demande Alex (29/08/2026, "il manque un bouton je confirme") : même
      // principe pour l'ajout au profil d'entreprise — voir l'outil
      // proposer_ajout_profil (app/api/chat/route.ts), appelé par Aaron au
      // moment où IL PROPOSE l'ajout (pas quand il l'exécute). Un signal
      // explicite du serveur, pas une déduction du texte — fiable même si
      // Aaron reformule sa question différemment d'une fois sur l'autre.
      const profileProposal = data.profile_update_proposal || null;

      if (data.reply) {
        setMessages([...newMessages, { role: 'assistant', content: data.reply, offerSaveDocument, profileProposal }]);
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

  // "possibilité d'ouvrir une nouvelle conversation" (Alex, 25/08/2026).
  async function handleNewConversation() {
    if (creatingConversation) return;
    setCreatingConversation(true);
    try {
      const res = await fetch('/api/chat-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json();
      if (!res.ok || !body.conversation) return;
      setConversations((prev) => [body.conversation, ...prev]);
      setActiveConversationId(body.conversation.id);
      try {
        window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, body.conversation.id);
      } catch {
        // Voir draftStorageKey plus haut.
      }
    } finally {
      setCreatingConversation(false);
    }
  }

  function handleSwitchConversation(conversationId) {
    setDrawerOpen(false);
    if (conversationId === activeConversationId) return;
    setActiveConversationId(conversationId);
    try {
      window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, conversationId);
    } catch {
      // Voir draftStorageKey plus haut.
    }
  }

  // "possibilité de mettre une conv en favoris" (Alex, 25/08/2026) — épingle
  // en haut de liste (voir tri dans GET /api/chat-conversations), ne protège
  // plus rien d'une suppression automatique puisqu'il n'y en a pas.
  async function handleToggleFavorite(conversation, e) {
    e.stopPropagation();
    const nextValue = !conversation.is_favorite;
    setConversations((prev) =>
      prev
        .map((c) => (c.id === conversation.id ? { ...c, is_favorite: nextValue } : c))
        .sort((a, b) => (b.is_favorite === a.is_favorite ? 0 : b.is_favorite ? 1 : -1))
    );
    try {
      await fetch(`/api/chat-conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, is_favorite: nextValue }),
      });
    } catch {
      // Best-effort : au pire l'état local se resynchronisera au prochain
      // chargement de la liste (changement de page puis retour).
    }
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

  // Voir le commentaire sur pendingDocument plus haut : un document déjà
  // visible dans un message envoyé (bulle) n'a plus besoin d'être répété
  // comme chip flottant au-dessus du champ de saisie.
  const pendingDocumentAlreadyInChat =
    !!pendingDocument && messages.some((m) => m.role === 'user' && m.attachment?.file_name === pendingDocument.file_name);

  return (
    <Shell active={t('nav.chat', locale)} userId={userId}>
      {/* Refonte 01/09/2026 (demande Alex : « dans le chat Aaron, ça doit
          ressembler à Messenger ou Insta ; là on dirait un forum des années
          2000 ») : plus de titre de page ni d'encadré de 60vh au milieu de
          l'écran — une vraie fenêtre de messagerie plein écran, avec la
          barre d'en-tête (avatar + nom + statut), le fil au centre et la
          zone de saisie collée en bas. La liste des conversations passe
          dans un tiroir latéral, comme sur Messenger. */}
      {/* .mg-page (16/10/2026, Alex : « tout doit être sur une page, même
          sur téléphone — on ne doit pas avoir à descendre ») : sur
          téléphone, ce bloc occupe exactement l'espace entre la barre du
          haut et la barre d'onglets du bas (encoches comprises) ; seul le
          fil défile, la zone de saisie reste toujours visible. */}
      <div className="mg-page">
      <header className="mg-head">
        <span className="mg-avatar"><img src="/icon.png" alt="" /></span>
        <div className="mg-id">
          <p className="mg-name">Aaron</p>
          <p className="mg-status"><span className="mg-dot" aria-hidden="true" />{t('chat.headerStatus', locale)}</p>
        </div>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={handleNewConversation}
          disabled={creatingConversation}
          title={t('chat.newConversation', locale)}
          aria-label={t('chat.newConversation', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={() => setDrawerOpen(true)}
          title={t('chat.conversationsTitle', locale)}
          aria-label={t('chat.conversationsTitle', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={() => setShowFeedback(!showFeedback)}
          title={t('chat.feedbackButton', locale)}
          aria-label={t('chat.feedbackButton', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" /></svg>
        </button>
      </header>

      {/* Barre de progression du questionnaire de découverte (demande Alex,
          27/08/2026, façon assistants campagnes/marketing), visible
          uniquement pendant le questionnaire lui-même (onboardingStep >= 0),
          pour les deux flux (création initiale ET régénération depuis Mon
          compte). Remplacée le 27/08/2026 (docx "Modifs Aaron", "tu as
          oublié la barre de progression PAR POINT... si il y a 8 questions
          alors une barre avec 8 points, et à chaque question répondue un
          point se remplit") par une suite de points discrets — un par
          question — plutôt qu'une barre continue en pourcentage : un point
          est rempli une fois la question CORRESPONDANTE répondue (index
          strictement inférieur à onboardingStep, qui pointe la question
          affichée mais pas encore répondue), le point de la question en
          cours est mis en évidence sans être plein. */}
      {onboardingStep >= 0 && (
        <div
          className="questionnaire-progress"
          role="progressbar"
          aria-valuenow={onboardingStep + 1}
          aria-valuemin={1}
          aria-valuemax={getOnboardingQuestions(locale).length}
          aria-label={t('chat.questionnaireProgressLabel', locale)}
        >
          <span className="questionnaire-progress-count">
            {t('chat.questionnaireProgressCount', locale)
              .replace('{current}', String(onboardingStep + 1))
              .replace('{total}', String(getOnboardingQuestions(locale).length))}
          </span>
          <span className="questionnaire-progress-dots">
            {getOnboardingQuestions(locale).map((_, i) => (
              <span
                key={i}
                className={`questionnaire-progress-dot${i < onboardingStep ? ' filled' : ''}${i === onboardingStep ? ' current' : ''}`}
              />
            ))}
          </span>
        </div>
      )}

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

      {/* Item 12 (docx Modifs Aaron 30/08/2026) : pendant la génération du
          profil (1-2 min), une fenêtre bloquante — "comme ça l'utilisateur
          comprend qu'il ne peut pas quitter tant que ce n'est pas terminé".
          Doublée d'un garde-fou beforeunload (voir l'effet plus haut) si
          malgré tout il ferme l'onglet. */}
      {summarizing && (
        <div className="gen-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="gen-card">
            <div className="gen-spinner" aria-hidden="true" />
            <h2 className="gen-title">{t('chat.generatingModalTitle', locale)}</h2>
            <p className="gen-body">{t('chat.generatingModalBody', locale)}</p>
            <div className="gen-bar" aria-hidden="true"><span /></div>
            <p className="gen-hint">{t('chat.generatingModalHint', locale)}</p>
          </div>
        </div>
      )}

      <div className="messenger">
        <div className="mg-messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="intro">
              <p>
                {isWelcome
                  ? t('common.loading', locale)
                  : t('chat.introGreeting', locale)}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            // Regroupement façon Messenger (01/09/2026) : les messages
            // consécutifs du même interlocuteur se collent, seul le DERNIER
            // du groupe porte la petite pointe et l'avatar d'Aaron, et
            // l'heure ne s'affiche qu'une fois par groupe. Un séparateur de
            // jour est inséré quand on change de date (created_at renvoyé
            // par /api/chat-history ; absent sur un message tout juste
            // envoyé côté client, on retombe silencieusement sur "pas de
            // séparateur, pas d'heure").
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const firstOfGroup = !prev || prev.role !== m.role;
            const lastOfGroup = !next || next.role !== m.role;
            const at = m.created_at ? new Date(m.created_at) : null;
            const prevAt = prev?.created_at ? new Date(prev.created_at) : null;
            const newDay = at && (!prevAt || at.toDateString() !== prevAt.toDateString());
            return (
            <div key={`w${i}`} className="mg-group-wrap">
            {newDay && (
              <div className="mg-day"><span>{dayLabel(at, locale)}</span></div>
            )}
            {/* Bug remonté par Alex (29/08/2026) : une sélection à la souris
                (clic gauche maintenu, pour copier un morceau de conversation)
                ne récupérait que les bulles Aaron, jamais les bulles
                utilisateur. Cause : chaque bulle était directement l'enfant
                flex de .messages, avec align-self pour la pousser à
                droite/gauche — l'espace vide à côté n'appartenait à AUCUN
                élément DOM, et le navigateur y accrochait la ligne voisine.
                Correctif : chaque bulle est enveloppée dans une ligne
                .msg-row qui occupe TOUTE la largeur (justify-content au lieu
                d'align-self), donc il y a toujours un élément sous le curseur.

                03/09/2026 : ce bloc était écrit en commentaire `//` au milieu
                du JSX — donc rendu comme du TEXTE dans la conversation, sous
                les yeux de l'utilisateur. En JSX, un commentaire placé entre
                des balises doit être une accolade contenant un commentaire de
                bloc ; la syntaxe // ne commente rien à cet endroit. */}
            <div className={`msg-row ${m.role}${firstOfGroup ? ' first' : ''}${lastOfGroup ? ' last' : ''}`}>
            {m.role === 'assistant' && (
              <span className={`mg-msg-avatar${lastOfGroup ? '' : ' hidden'}`} aria-hidden="true">
                <img src="/icon.png" alt="" />
              </span>
            )}
            <div className={`bubble ${m.role}`}>
              {m.attachment && (
                <div className="bubble-attachment"><Ic name="paperclip" size={13} /> {m.attachment.file_name}</div>
              )}
              {/* Typographie (demande Alex, 29/08/2026, capture à l'appui) :
                  seuls les textes GÉNÉRÉS PAR AARON passent par
                  frenchTypography (espace insécable avant : ; ! ?, pour
                  éviter la ponctuation orpheline en début de ligne) — jamais
                  le texte tapé par le commercial lui-même, qu'on affiche tel
                  quel. Voir lib/text-typography.js. */}
              {m.role === 'assistant' ? frenchTypography(m.content) : m.content}
              {/* Boutons de réponse rapide Oui/Non (demande Alex, 29/08/2026) :
                  affichés uniquement sous le dernier message, quand Aaron
                  vient de proposer de sauvegarder le document joint — un clic
                  envoie directement la réponse, sans repasser par le champ de
                  saisie (contrairement aux chips de suggestion de l'onboarding,
                  qui ne font que pré-remplir le champ). */}
              {m.offerSaveDocument && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={() => handleSend(null, 'Oui, sauvegarde-le.')}
                  >
                    {t('chat.quickReplySaveYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={() => handleSend(null, "Non, ce n'est pas nécessaire.")}
                  >
                    {t('chat.quickReplySaveNo', locale)}
                  </button>
                </div>
              )}
              {/* Proposition de (re)faire le questionnaire — voir
                  startQuestionnaireNow. Rien n'est modifié tant que le
                  commercial n'a pas cliqué « oui ». */}
              {m.offerRestartQuestionnaire && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={startQuestionnaireNow}
                  >
                    {t('chat.quickReplyRestartYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={declineQuestionnaireRestart}
                  >
                    {t('chat.quickReplyRestartNo', locale)}
                  </button>
                </div>
              )}
              {/* Boutons de réponse rapide Confirmer/Annuler (demande Alex,
                  29/08/2026, "il manque un bouton je confirme") — pour la
                  proposition d'ajout au profil d'entreprise (voir
                  proposer_ajout_profil côté serveur). */}
              {m.profileProposal && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={() => handleSend(null, 'Oui, je confirme, ajoute-le à mon profil.')}
                  >
                    {t('chat.quickReplyProfileYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={() => handleSend(null, 'Non, laisse tomber.')}
                  >
                    {t('chat.quickReplyProfileNo', locale)}
                  </button>
                </div>
              )}
              {/* Bouton "Voir le profil de l'entreprise" (demande Alex,
                  29/08/2026 : "on en voit un aperçu de texte et on peut
                  cliquer... et là on voit un super document") — le message
                  n'affiche plus qu'un aperçu du document complet (voir
                  handleGenerateSummary, buildSummaryPreview), ce bouton
                  ouvre l'onglet "Mon entreprise" de Mon compte où le
                  document entier est éditable, exportable en Word/PDF. Pas
                  de garde sur i/sending : contrairement aux boutons de
                  réponse rapide ci-dessus, c'est une simple navigation (pas
                  une action ponctuelle), donc rester cliquable même sur un
                  ancien message est voulu. */}
              {m.viewProfileLink && (
                <div className="tour-link-row">
                  <a href={`/app/connexions${userId ? `?user_id=${userId}&tab=company` : '?tab=company'}`} className="tour-link">
                    {t('chat.viewBusinessProfileButton', locale)}
                  </a>
                </div>
              )}
            </div>
            </div>
            {lastOfGroup && at && (
              <div className={`mg-time ${m.role}`}>{at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</div>
            )}
            </div>
            );
          })}
          {sending && (
            <div className="msg-row assistant first last">
              <span className="mg-msg-avatar" aria-hidden="true"><img src="/icon.png" alt="" /></span>
              <div className="bubble assistant typing" aria-label={t('chat.aaronThinking', locale)}>
                <span className="mg-typing"><i /><i /><i /></span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {questionnaireDone && !summaryDone && (
          <div className="welcome-actions">
            <button type="button" className="btn-secondary" onClick={handleGenerateSummary} disabled={summarizing}>
              {summarizing ? t('chat.generatingSummary', locale) : t('chat.generateSummaryButton', locale)}
            </button>
            {/* Demande Alex (29/08/2026) : la génération prend 1-2 minutes
                (document long, plusieurs sections) — sans indication, on
                dirait que le bouton est resté bloqué. Rassure l'utilisateur
                plutôt que de le laisser deviner. */}
            {summarizing && <span className="welcome-actions-hint">{t('chat.generatingSummaryHint', locale)}</span>}
          </div>
        )}

        {/* Bug remonté par Alex (29/08/2026) : ce chip restait affiché même
            APRÈS l'envoi du document dans un message (déjà visible dans sa
            bulle, voir bubble-attachment) — donnant l'impression qu'il
            n'était pas parti. pendingDocumentAlreadyInChat détecte ce cas
            (le document apparaît déjà dans un message envoyé) et cache alors
            ce chip flottant, comme sur Claude.ai/ChatGPT une fois le fichier
            envoyé. Il continue néanmoins d'être transmis à Aaron en
            arrière-plan (voir pendingDocument plus haut) tant qu'il n'est
            pas sauvegardé/retiré — seul l'affichage change. */}
        {((pendingDocument && !pendingDocumentAlreadyInChat) || uploadingDocument || attachError || sendError) && (
          <div className="attach-row">
            {uploadingDocument && <span className="attach-chip attach-loading">{t('chat.attachUploading', locale)}</span>}
            {pendingDocument && !uploadingDocument && !pendingDocumentAlreadyInChat && (
              <span className="attach-chip">
                <Ic name="paperclip" size={13} /> {pendingDocument.file_name}
                <button
                  type="button"
                  className="attach-remove"
                  onClick={() => setPendingDocument(null)}
                  aria-label={t('chat.attachRemove', locale)}
                >
                  <Ic name="x" size={12} strokeWidth={2.6} />
                </button>
              </span>
            )}
            {attachError && <span className="attach-error">{attachError}</span>}
            {sendError && <span className="attach-error">{sendError}</span>}
          </div>
        )}

        {/* Suggestions cliquables (demande Alex, docx "Modifs Aaron") :
            uniquement pendant le questionnaire, traduites dans les 7 langues
            du site (voir ONBOARDING_QUESTION_SUGGESTIONS plus haut). Repli sur
            le français si jamais une locale/clé venait à manquer. */}
        {onboardingStep >= 0 && !sending && (ONBOARDING_QUESTION_SUGGESTIONS[locale]?.[ONBOARDING_QUESTION_KEYS[onboardingStep]] || ONBOARDING_QUESTION_SUGGESTIONS.fr[ONBOARDING_QUESTION_KEYS[onboardingStep]]) && (
          <div className="suggestion-row">
            {(ONBOARDING_QUESTION_SUGGESTIONS[locale]?.[ONBOARDING_QUESTION_KEYS[onboardingStep]] || ONBOARDING_QUESTION_SUGGESTIONS.fr[ONBOARDING_QUESTION_KEYS[onboardingStep]]).map((s) => (
              <button
                key={s.label}
                type="button"
                className="suggestion-chip"
                onClick={() => {
                  // Bug remonté par Alex (30/08/2026) : cliquer sur un chip
                  // REMPLAÇAIT tout le texte déjà saisi (setInput(s.text) tout
                  // court) — impossible de composer sa réponse en cliquant
                  // plusieurs chips à la suite, ou d'écrire une phrase autour
                  // d'un chip. Corrigé pour insérer le texte du chip À LA
                  // POSITION DU CURSEUR (comme un vrai copier-coller) plutôt
                  // que de tout écraser : le texte avant, après, ou entre deux
                  // chips cliqués l'un après l'autre est désormais préservé.
                  const el = textareaRef.current;
                  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : input.length;
                  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : input.length;
                  const before = input.slice(0, start);
                  const after = input.slice(end);
                  // Espace de séparation si besoin, pour ne pas coller le chip
                  // directement à un mot déjà présent avant/après le curseur.
                  const needsSpaceBefore = before && !/\s$/.test(before);
                  const needsSpaceAfter = after && !/^\s/.test(after);
                  const insert = `${needsSpaceBefore ? ' ' : ''}${s.text}${needsSpaceAfter ? ' ' : ''}`;
                  const newValue = before + insert + after;
                  const newCursorPos = before.length + insert.length;
                  setInput(newValue);
                  // Repositionne le curseur juste après le texte inséré, une
                  // fois que React a bien reporté newValue dans le DOM du
                  // <textarea> contrôlé (value={input}) — sinon setSelectionRange
                  // s'appliquerait encore sur l'ancienne valeur.
                  requestAnimationFrame(() => {
                    el?.focus();
                    el?.setSelectionRange(newCursorPos, newCursorPos);
                  });
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <form className="mg-composer" onSubmit={handleSend}>
          <input
            ref={fileInputRef}
            type="file"
            className="file-input-hidden"
            onChange={handleFileSelected}
            accept=".pdf,.txt,.csv,.doc,.docx,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <button
            type="button"
            className="mg-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploadingDocument}
            title={t('chat.attachButton', locale)}
            aria-label={t('chat.attachButton', locale)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 0 1 5.18 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.5-8.49" /></svg>
          </button>
          <textarea
            ref={textareaRef}
            className="mg-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            // Revenu en arrière (demande Alex, 27/08/2026, docx "Modifs
            // Aaron") : Entrée ne doit PLUS envoyer le message, juste
            // revenir à la ligne (comportement natif d'un <textarea>, donc
            // rien à gérer ici) — seul un clic sur "Envoyer" envoie
            // désormais le message.
            placeholder={t('chat.inputPlaceholder', locale)}
            disabled={sending}
          />
          {/* Bug remonté par Alex (29/08/2026) : un document seul, sans texte,
              devait pouvoir être envoyé (bouton grisé sinon) — voir la même
              condition sur la garde en tête de handleSend. */}
          {/* Bouton rond fléché, comme dans une messagerie — le libellé
              « Envoyer » reste en aria-label pour l'accessibilité. */}
          <button
            type="submit"
            className="mg-send"
            disabled={sending || (!input.trim() && !pendingDocument)}
            title={t('chat.send', locale)}
            aria-label={t('chat.send', locale)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
      </div>
      </div>

      {/* "possibilité d'ouvrir une nouvelle conversation" + "possibilité de
          mettre une conv en favoris" (Alex, 25/08/2026), affiché "en bas du
          bloc chat avec aaron" comme demandé. Conservation illimitée (voir
          migration_chat_conversations_2026-08-25.sql) : le favori sert
          uniquement à épingler en haut de liste, rien n'est jamais supprimé
          automatiquement. */}
      {/* Tiroir « mes conversations » (refonte messagerie 01/09/2026) : la
          liste ne s'empile plus sous le fil (effet forum), elle glisse
          depuis la droite comme la liste de discussions d'une messagerie. */}
      {drawerOpen && <div className="mg-drawer-overlay" onClick={() => setDrawerOpen(false)} />}
      <aside className={`conversations-panel${drawerOpen ? ' open' : ''}`}>
        <div className="conversations-head">
          <h2>{t('chat.conversationsTitle', locale)}</h2>
          <button type="button" className="mg-icon-btn" onClick={() => setDrawerOpen(false)} aria-label={t('common.close', locale)}><Ic name="x" size={16} /></button>
        </div>
        <button type="button" className="mg-new-conv" onClick={handleNewConversation} disabled={creatingConversation}>
          + {t('chat.newConversation', locale)}
        </button>
        <p className="conversations-hint">{t('chat.conversationsHint', locale)}</p>
        {conversationsError && conversations.length === 0 ? (
          <p className="conversations-error">{t('chat.conversationsLoadError', locale)}</p>
        ) : (
          <ul className="conversations-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`conversation-row ${c.id === activeConversationId ? 'active' : ''}`}
                  onClick={() => handleSwitchConversation(c.id)}
                >
                  <span
                    className={`conversation-star ${c.is_favorite ? 'is-favorite' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleToggleFavorite(c, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleToggleFavorite(c, e);
                    }}
                    title={c.is_favorite ? t('chat.favoriteRemove', locale) : t('chat.favoriteAdd', locale)}
                    aria-label={c.is_favorite ? t('chat.favoriteRemove', locale) : t('chat.favoriteAdd', locale)}
                  >
                    <Ic name="star" size={14} fill={c.is_favorite ? 'currentColor' : 'none'} />
                  </span>
                  <span className="conversation-info">
                    <span className="conversation-title">{c.title || t('chat.conversationUntitled', locale)}</span>
                    {c.preview && <span className="conversation-preview">{c.preview}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* docx AJOUT GLOBAL item A8 : "revoir la visite guidée" doit rester
          accessible en permanence juste sous le chat (pas seulement pendant
          l'onboarding, et plus dans le pied de page de Préférences — voir
          app/app/preferences/page.jsx). */}
      <div className="tour-link-row">
        <a href={`/app/tour${userId ? `?user_id=${userId}` : ''}`} className="tour-link">
          {t('chat.viewTourButton', locale)}
        </a>
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
        /* Barre d'étape du questionnaire (revue 06/09/2026 : « la barre de
           progression du questionnaire est mal placée »). Elle flottait
           collée à gauche sous l'en-tête, sans compteur ni contenant : on ne
           savait ni ce qu'elle mesurait, ni où on en était. C'est désormais
           un vrai bandeau, aligné sur la largeur du fil de discussion, avec
           « Question 3 sur 13 » à gauche et les points à droite. */
        .questionnaire-progress {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.9rem;
          flex-wrap: wrap;
          margin: 0 0 1rem;
          padding: 0.55rem 0.9rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
        }
        .questionnaire-progress-count {
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .questionnaire-progress-dots {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .questionnaire-progress-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--border);
          transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }
        .questionnaire-progress-dot.filled {
          background: var(--accent);
        }
        .questionnaire-progress-dot.current {
          background: var(--accent);
          transform: scale(1.35);
          box-shadow: 0 0 0 3px rgba(75, 57, 239, 0.22);
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
        /* ============ Fenêtre de messagerie (refonte 01/09/2026) ============
           Demande d'Alex : « dans le chat Aaron ça doit ressembler à
           Messenger ou Insta ; là on dirait un forum des années 2000 ».
           La colonne prend toute la hauteur disponible, l'en-tête et la
           saisie sont fixes, seul le fil défile. */
        /* Fil centré et borné, comme une messagerie : sur un grand écran une
           ligne de texte qui traverse 1500 px est illisible. */
        .mg-head {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0 0.2rem 0.9rem;
          border-bottom: 1px solid var(--border-soft);
          max-width: 940px;
          margin: 0 auto;
          width: 100%;
        }
        .mg-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--surface);
          box-shadow: 0 0 0 2px rgba(75, 57, 239, 0.35);
        }
        .mg-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mg-id { flex: 1; min-width: 0; }
        .mg-name {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.02rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .mg-status {
          margin: 0.1rem 0 0;
          font-size: 0.76rem;
          color: var(--muted);
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        .mg-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
        }
        .mg-icon-btn {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9rem;
          transition: background var(--fast), color var(--fast);
        }
        .mg-icon-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
        .mg-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .messenger {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 13rem);
          min-height: 420px;
          max-width: 940px;
          margin: 0 auto;
          width: 100%;
        }
        .mg-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.1rem 0.4rem 0.6rem;
          display: flex;
          flex-direction: column;
          /* 0.12rem → 0.4rem entre deux bulles d'un même auteur (Alex,
             04/09/2026 : « les 2 messages à la suite d'Aaron sont trop
             collés »). Messenger et WhatsApp laissent 4 à 6 px ; à 2 px les
             bulles se touchaient et se lisaient comme un seul pavé. */
          gap: 0.4rem;
        }
        .mg-group-wrap { display: contents; }
        .intro {
          color: var(--muted);
          font-size: 0.9rem;
          text-align: center;
          margin-top: 2rem;
        }
        .mg-day {
          display: flex;
          justify-content: center;
          margin: 1rem 0 0.7rem;
        }
        .mg-day span {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          font-size: 0.7rem;
          padding: 0.2rem 0.75rem;
          border-radius: 999px;
          text-transform: capitalize;
        }
        .msg-row {
          display: flex;
          width: 100%;
          align-items: flex-end;
          gap: 0.45rem;
        }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.assistant { justify-content: flex-start; }
        .msg-row.first { margin-top: 0.9rem; }
        .mg-msg-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          overflow: hidden;
          flex-shrink: 0;
          align-self: flex-end;
        }
        .mg-msg-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mg-msg-avatar.hidden { visibility: hidden; }
        .bubble {
          max-width: min(70%, 620px);
          padding: 0.62rem 0.95rem;
          border-radius: 20px;
          font-size: 0.92rem;
          line-height: 1.45;
          white-space: pre-wrap;
          overflow-wrap: break-word;
        }
        /* Coins « collés » à l'intérieur d'un groupe : le repère visuel des
           messageries — un seul bloc quand on enchaîne plusieurs messages. */
        .msg-row.user .bubble {
          background: linear-gradient(135deg, var(--accent), var(--accent-light));
          color: #fff;
          border-bottom-right-radius: 6px;
        }
        .msg-row.user:not(.first) .bubble { border-top-right-radius: 6px; }
        .msg-row.assistant .bubble {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border-soft);
          color: var(--text);
          border-bottom-left-radius: 6px;
        }
        .msg-row.assistant:not(.first) .bubble { border-top-left-radius: 6px; }
        .mg-time {
          font-size: 0.66rem;
          color: var(--muted-soft);
          margin: 0.15rem 0 0.1rem;
          padding: 0 0.3rem;
        }
        .mg-time.user { text-align: right; }
        .mg-time.assistant { text-align: left; padding-left: 2.1rem; }
        .bubble.typing { padding: 0.75rem 1rem; }
        .mg-typing { display: inline-flex; gap: 4px; align-items: center; }
        .mg-typing i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--muted);
          animation: mg-blink 1.2s infinite ease-in-out;
        }
        .mg-typing i:nth-child(2) { animation-delay: 0.18s; }
        .mg-typing i:nth-child(3) { animation-delay: 0.36s; }
        @keyframes mg-blink {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        .bubble-attachment {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.78rem;
          font-weight: 600;
          opacity: 0.85;
          margin-bottom: 0.35rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.25);
        }
        .bubble.assistant .bubble-attachment {
          border-bottom-color: var(--border);
        }
        .quick-replies {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.7rem;
        }
        .quick-reply-btn {
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text);
        }
        .quick-reply-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .quick-reply-yes {
          border-color: var(--accent);
        }
        .welcome-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          padding: 0 1rem 1rem;
        }
        .gen-overlay {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: rgba(5, 6, 12, 0.72);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .gen-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 2rem 1.8rem;
          width: min(440px, 100%);
          text-align: center;
          box-shadow: var(--shadow-lg);
        }
        .gen-spinner {
          width: 44px;
          height: 44px;
          margin: 0 auto 1rem;
          border-radius: 50%;
          border: 3px solid var(--border);
          border-top-color: var(--accent-light);
          animation: gen-spin 0.9s linear infinite;
        }
        @keyframes gen-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .gen-title {
          margin: 0 0 0.5rem;
          font-family: var(--font-display);
          font-size: 1.2rem;
        }
        .gen-body {
          margin: 0 0 1rem;
          color: var(--muted);
          font-size: 0.9rem;
          line-height: 1.5;
        }
        .gen-bar {
          height: 6px;
          border-radius: 999px;
          background: var(--bg);
          border: 1px solid var(--border);
          overflow: hidden;
          margin-bottom: 0.8rem;
        }
        .gen-bar span {
          display: block;
          height: 100%;
          width: 40%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), var(--accent-light));
          animation: gen-slide 1.6s ease-in-out infinite;
        }
        @keyframes gen-slide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(260%);
          }
        }
        .gen-hint {
          margin: 0;
          font-size: 0.78rem;
          color: var(--muted-soft);
        }
        .welcome-actions-hint {
          flex-basis: 100%;
          color: var(--muted);
          font-size: 0.82rem;
        }
        .btn-tour {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }
        /* Tiroir latéral (refonte messagerie) : masqué par défaut, glisse
           depuis la droite au clic sur l'icône « liste » de l'en-tête. */
        .conversations-panel {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(340px, 88vw);
          z-index: 119;
          background: var(--bg-elevated);
          border-left: 1px solid var(--border);
          box-shadow: var(--shadow-lg);
          padding: 1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));
          overflow-y: auto;
          transform: translateX(100%);
          transition: transform 0.25s var(--ease);
          box-sizing: border-box;
        }
        .conversations-panel.open { transform: translateX(0); }
        .mg-new-conv {
          width: 100%;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          margin-bottom: 0.7rem;
        }
        .mg-new-conv:disabled { opacity: 0.5; cursor: not-allowed; }
        .conversations-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.4rem;
        }
        .conversations-head h2 {
          font-size: 0.95rem;
          margin: 0;
          font-family: var(--font-display);
        }
        .conversations-hint {
          font-size: 0.76rem;
          color: var(--muted);
          margin: 0 0 0.9rem;
        }
        .conversations-error {
          font-size: 0.82rem;
          color: var(--accent-red);
          margin: 0;
        }
        .conversations-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          max-height: 260px;
          overflow-y: auto;
        }
        .conversation-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.6rem;
          cursor: pointer;
          text-align: left;
        }
        .conversation-row:hover {
          background: var(--bg);
        }
        .conversation-row.active {
          background: var(--bg);
          border-color: var(--border);
        }
        .conversation-star {
          flex-shrink: 0;
          font-size: 1rem;
          color: var(--muted);
          line-height: 1;
          cursor: pointer;
        }
        .conversation-star.is-favorite {
          color: #F0C94E;
        }
        .conversation-info {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          min-width: 0;
          flex: 1;
        }
        .conversation-title {
          font-size: 0.84rem;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .conversation-preview {
          font-size: 0.74rem;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tour-link-row {
          text-align: center;
          margin-top: 0.8rem;
        }
        /* Bug remonté par Alex (29/08/2026) : ce lien ("Voir comment
           fonctionne l'appli") était un simple texte souligné discret
           (couleur --muted, petite taille) — pas assez visible pour qu'on
           comprenne qu'on peut cliquer dessus. Repris avec le même habillage
           que .btn-secondary (bordure, fond au survol) pour qu'il se
           reconnaisse clairement comme un bouton, tout en restant un <Link>
           (navigation, pas d'action JS). */
        .tour-link {
          display: inline-block;
          color: var(--text);
          font-size: 0.82rem;
          font-weight: 600;
          text-decoration: none;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.5rem 1rem;
        }
        .tour-link:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--accent);
        }
        .attach-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          padding: 0 1rem;
          margin-top: 0.6rem;
        }
        /* Réponses suggérées (revue 06/09/2026 : « les chips font un peu
           vieux »). Avant : contour gris, texte violet, fond de page — trois
           couleurs qui ne se parlaient pas, et un look de tag cliquable des
           années 2010. Maintenant : pastille pleine mais discrète, teintée de
           l'accent de l'app, texte à l'encre normale (c'est du contenu, pas
           un lien), et un « + » qui apparaît au survol parce que le clic
           INSÈRE le texte dans le champ, il ne l'envoie pas. */
        .suggestion-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          padding: 0.7rem 1rem 0;
        }
        .suggestion-chip {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          background: var(--surface);
          border: 1px solid var(--border-soft, var(--border));
          color: var(--text);
          border-radius: 10px;
          padding: 0.42rem 0.7rem;
          font-family: inherit;
          font-size: 0.79rem;
          font-weight: 500;
          line-height: 1.25;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
        }
        .suggestion-chip::before {
          content: '+';
          font-size: 0.9rem;
          line-height: 1;
          color: var(--accent);
          opacity: 0.55;
          transition: opacity 0.15s ease;
        }
        .suggestion-chip:hover {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.09);
          transform: translateY(-1px);
        }
        .suggestion-chip:hover::before {
          opacity: 1;
        }
        .suggestion-chip:active {
          transform: translateY(0);
        }
        .suggestion-chip:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
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
        .mg-composer {
          display: flex;
          align-items: flex-end;
          gap: 0.4rem;
          padding: 0.6rem 0.2rem 0.2rem;
          border-top: 1px solid var(--border-soft);
        }
        .file-input-hidden { display: none; }
        .mg-attach, .mg-send {
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .mg-attach { background: transparent; color: var(--muted); }
        .mg-attach:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
        .mg-send { background: var(--accent); color: #fff; }
        .mg-send:hover:not(:disabled) { background: var(--accent-light); transform: scale(1.05); }
        .mg-attach:disabled, .mg-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .mg-input {
          flex: 1;
          min-width: 0;
          max-height: 140px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 22px;
          padding: 0.68rem 1.05rem;
          color: var(--text);
          /* 16px : évite le zoom automatique de Safari iOS à la mise au point */
          font-size: 16px;
          font-family: inherit;
          line-height: 1.45;
          resize: none;
          overflow-y: auto;
          transition: border-color var(--fast);
        }
        .mg-input:focus { outline: none; border-color: var(--accent); }
        .mg-input::placeholder { color: var(--muted); }
        .mg-input:disabled { opacity: 0.6; }

        /* Tiroir des conversations + adaptation téléphone */
        .mg-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 6, 12, 0.55);
          backdrop-filter: blur(2px);
          z-index: 118;
        }
        .mg-page { display: contents; }
        @media (max-width: 900px) {
          /* Bloc plein écran entre les deux barres fixes (MobileChrome,
             globals.css : haut 52 px, bas 62 px, plus les encoches). */
          .mg-page {
            display: flex;
            flex-direction: column;
            position: fixed;
            top: calc(52px + env(safe-area-inset-top, 0px));
            bottom: calc(62px + env(safe-area-inset-bottom, 0px));
            left: 0;
            right: 0;
            z-index: 20;
            background: var(--bg);
            padding: 0 0.75rem;
          }
          /* La page chat est un bloc plein écran fixe (ci-dessus) qui a déjà
             son propre en-tête « Aaron ». Le bandeau de notifications
             (Stories) injecté par le Shell en haut du contenu se retrouvait
             SOUS ce bloc fixe et dépassait par-dessus l'en-tête (signalé par
             Alex, 19/10/2026 : « ça cache la partie Aaron en haut du chat »).
             On le masque donc UNIQUEMENT sur la page chat en mobile : les
             notifications restent visibles sur toutes les autres pages, et
             dans la cloche du rail sur grand écran. */
          .content > .stories,
          .content > .all-clear { display: none; }
          .messenger {
            flex: 1;
            min-height: 0;
            height: auto;
          }
          /* En-tête réduit à une ligne : le titre « Chat avec Aaron » est
             déjà dans la barre du haut. */
          .mg-head { padding: 0.45rem 0.1rem; gap: 0.55rem; }
          .mg-avatar { width: 30px; height: 30px; }
          .mg-page .mg-name { font-size: 0.92rem !important; line-height: 1.2 !important; margin: 0 !important; }
          .mg-page .mg-status { font-size: 0.72rem !important; line-height: 1.2 !important; margin: 0 !important; }
          .mg-icon-btn { width: 34px; height: 34px; }
          .mg-messages { padding: 0.7rem 0.1rem 0.4rem; }
          .mg-page .intro { margin-top: 1rem; font-size: 0.92rem !important; }
          .bubble { max-width: 86%; font-size: 0.95rem; }
          .mg-composer {
            background: var(--bg);
            padding: 0.45rem 0 0.5rem;
            gap: 0.35rem;
          }
          /* Zone de saisie plus haute : on voit ce qu'on écrit (Alex). */
          .mg-input {
            min-height: 48px;
            max-height: 38dvh;
            padding: 0.75rem 1rem;
          }
        }
      `}</style>
    </Shell>
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
  // Docx « derniers ajouts » (05/09/2026) : « Mon équipe » disparaissait
  // 1–2 s à chaque changement de rubrique, le temps que /api/preferences
  // réponde, puis réapparaissait. On relit d'abord le rôle mémorisé lors de
  // la dernière réponse (par utilisateur), puis la réponse le confirme : la
  // rubrique est là dès le premier rendu et ne bouge plus.
  useEffect(() => {
    if (!userId) return;
    try {
      const cached = window.localStorage.getItem(`aaron_role:${userId}`);
      if (cached) setUserRole(cached);
    } catch {
      // stockage indisponible : on attend simplement la réponse réseau
    }
  }, [userId]);
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
        try {
          window.localStorage.setItem(`aaron_role:${userId}`, prefs.role || '');
        } catch {
          // idem : best effort
        }
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
        {/* Rail replié (≥901px) : le nom de la langue ne tient pas dans 78 px
            (« França… », capture Alex 05/09) — .lang-wrap affiche le code (FR)
            par-dessus le select, qui garde les noms complets dans sa liste. */}
        <div className="lang-wrap" data-code={locale.toUpperCase()}>
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
            <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
          ))}
        </select>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className={railLinkClass(item.slug, item.label, active)}
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        {/* Rubriques rares dans « Plus » (modernisation 16/10/2026, point 4) — components/RailMore.jsx */}
        <RailMore items={NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron'))} active={active} userId={userId} label={t('shell.more', locale)} notIncludedLabel={t('shell.notIncluded', locale)} />
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon"><NavIcon slug="logout" /></span>
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
          --border-soft: var(--tint-7);
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
          box-shadow: 0 0 0 1px var(--tint-8), 0 4px 14px rgba(75, 57, 239, 0.35);
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
          background: var(--tint-4);
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
