// components/AuthFetchInterceptor.jsx
// Attache automatiquement le token de session Supabase (Authorization: Bearer ...)
// à chaque appel fetch('/api/...') fait depuis le navigateur, SANS avoir à modifier
// individuellement les dizaines d'appels fetch déjà présents dans les pages.
//
// Pourquoi : les routes API vérifient maintenant que la personne connectée est bien
// celle qu'elle prétend être (voir lib/auth-helpers.ts), via ce token. Sans ce
// patch, il aurait fallu réécrire l'appel fetch dans chaque page une par une —
// un chantier bien plus risqué à livrer sans pouvoir tout tester en direct.
//
// Le patch s'installe une seule fois, au chargement du module (donc avant que la
// moindre page ait la chance de lancer son premier appel réseau), pas dans un
// useEffect qui se déclencherait trop tard.

'use client';

import { supabaseBrowser, isExplicitlyLoggedInToday, getDeviceId, shouldCheckDeviceToday } from '@/lib/supabase-browser';

// Porte d'entrée de l'app (bug remonté par Alex le 2026-08-19, assoupli le
// 2026-08-20) : même avec une session Supabase encore valide et persistée
// (case "se souvenir de moi" cochée), on ne doit pas atterrir directement
// dans /app en silence sans qu'un premier passage explicite par "Se
// connecter" ait eu lieu — sans ça, un lien direct vers /app (ex. le bouton
// "Essayer maintenant" de la landing page) pouvait laisser voir une page à
// moitié fonctionnelle avec un token bancal, sans aucun moyen de s'en sortir
// ni de se déconnecter pour se reconnecter proprement.
//
// Version initiale (2026-08-19) : marqueur dans sessionStorage, donc exigé à
// CHAQUE nouvel onglet. Alex a ensuite demandé (2026-08-20) qu'un retour dans
// l'app plus tard la MÊME JOURNÉE n'redemande pas l'email/mot de passe et se
// reconnecte directement — d'où le passage à localStorage avec la date du
// jour (heure locale du navigateur) : le marqueur reste valide jusqu'à
// minuit, quel que soit le nombre de nouveaux onglets ouverts ce jour-là,
// et redemande une connexion explicite le lendemain. Le vrai contrôle
// d'authentification reste de toute façon fait par Supabase + les routes API
// (voir plus bas et lib/auth-helpers.ts) : ce marqueur ne fait qu'éviter de
// redemander bêtement un clic "Se connecter" quand la session est encore là.
if (typeof window !== 'undefined' && !window.__aaronAppEntryChecked) {
  window.__aaronAppEntryChecked = true;
  const path = window.location.pathname;
  if (path === '/app' || path.startsWith('/app/')) {
    if (!isExplicitlyLoggedInToday()) {
      // ?next= : revenir sur la page demandée une fois connecté (ex. QR code
      // « notifications sur ton téléphone » de Mon compte > Connexion) —
      // voir rememberPostLoginNext/consumePostLoginNext (lib/supabase-browser.ts).
      const next = path.startsWith('/app/') ? `${path}${window.location.search || ''}` : '';
      window.location.href = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
    }
  }
}

// Bug remonté par Alex (2026-08-22) sur la page Préférences : "Non
// authentifié — reconnecte-toi." qui persistait MÊME après une déconnexion/
// reconnexion explicite — donc pas une histoire de session périmée. Cette
// page charge 6 appels /api/... en parallèle dès le montage (préférences,
// quota API, résumé d'activité, signature, infos légales, plus l'appel
// dupliqué du composant Shell) : nettement plus que les autres pages. Le
// jeton de rafraîchissement Supabase est à usage unique — si deux appels
// simultanés appellent chacun refreshSession() de leur côté pile au même
// instant, le premier "gagne" et invalide le jeton pour le second, qui se
// retrouve avec un rafraîchissement en échec et repart donc sans jeton
// valide (d'où le 401 qui persiste, page après page, malgré la
// reconnexion : le même scénario de course se reproduit à chaque nouveau
// chargement de la page). On mutualise donc TOUT rafraîchissement dans une
// unique promesse partagée : si un rafraîchissement est déjà en cours, les
// appels suivants attendent son résultat au lieu d'en déclencher un nouveau.
let refreshInFlight = null;
function refreshSessionShared() {
  if (!refreshInFlight) {
    refreshInFlight = supabaseBrowser.auth.refreshSession().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

if (typeof window !== 'undefined' && !window.__aaronAuthFetchPatched) {
  window.__aaronAuthFetchPatched = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);

    if (!isApiCall) {
      return originalFetch(input, init);
    }

    const opts = init ? { ...init } : {};

    // Item 3bis (docx 30/08) : signale l'appareil à /api/auth/link une fois
    // par jour — le serveur envoie un email de sécurité au commercial si cet
    // appareil n'a jamais été vu sur son compte (voir lib/supabase-browser.ts).
    if (/\/api\/auth\/link(\?|$)/.test(url) && shouldCheckDeviceToday()) {
      const deviceId = getDeviceId();
      if (deviceId) opts.headers = { ...(opts.headers || {}), 'x-aaron-device': deviceId };
    }

    try {
      let { data } = await supabaseBrowser.auth.getSession();
      let session = data?.session;

      // Bug remonté par Alex (2026-08-19/20) : "Non authentifié — reconnectez-
      // vous" sur des actions qui suivent un formulaire un peu long à remplir
      // (ajout d'un créneau récurrent en Agenda, upload d'un document avec
      // description/catégorie) — le point commun étant le TEMPS passé sur la
      // page avant l'envoi. Piste retenue : le rafraîchissement automatique du
      // token Supabase tourne sur un minuteur en arrière-plan qui peut être
      // throttlé par le navigateur (onglet inactif, économie d'énergie), donc
      // le token en localStorage peut être expiré au moment de l'envoi sans
      // que le rafraîchissement automatique ait eu l'occasion de se déclencher.
      // On vérifie donc nous-mêmes l'expiration ici et on force un
      // rafraîchissement explicite si besoin, plutôt que de compter uniquement
      // sur le minuteur interne du client Supabase.
      const expiresAt = session?.expires_at; // secondes depuis epoch
      const expiringSoon = typeof expiresAt === 'number' && expiresAt <= Math.floor(Date.now() / 1000) + 10;
      if (session && expiringSoon) {
        const { data: refreshed } = await refreshSessionShared();
        if (refreshed?.session) session = refreshed.session;
      }

      const token = session?.access_token;
      if (token) {
        opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
      }
    } catch (err) {
      // Si on ne peut pas lire/rafraîchir la session, on laisse partir la
      // requête sans le header plutôt que de bloquer l'appli — la route
      // protégée répondra 401, ce qui est un échec propre plutôt qu'un
      // plantage silencieux ici.
    }

    let response = await originalFetch(input, opts);

    // Bug remonté à nouveau par Alex (2026-08-21) sur un upload de document :
    // malgré le rafraîchissement préventif ci-dessus (marge de 10s), un 401
    // "Non authentifié" pouvait encore survenir sur une requête un peu longue
    // à PARTIR (gros fichier, connexion lente) — le token était encore valide
    // de justesse au moment de l'estimation ci-dessus, mais plus au moment où
    // le serveur le vérifie réellement. Plutôt que d'essayer de deviner la
    // bonne marge de sécurité, on traite directement le symptôme : sur un 401,
    // on rafraîchit la session et on REJOUE la requête une seule fois avant de
    // considérer que c'est un vrai problème d'authentification. Rejouer est
    // sans risque ici : toutes les routes protégées vérifient l'authentification
    // tout en haut, avant toute écriture (voir lib/auth-helpers.ts) — un 401 veut
    // donc dire qu'aucun effet de bord n'a eu lieu côté serveur.
    if (response.status === 401 && isApiCall) {
      try {
        const { data: refreshed } = await refreshSessionShared();
        const retryToken = refreshed?.session?.access_token;
        if (retryToken) {
          const retryOpts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${retryToken}` } };
          response = await originalFetch(input, retryOpts);
        }
      } catch (err) {
        // Le rafraîchissement a échoué : on laisse la réponse 401 d'origine,
        // gérée normalement ci-dessous (redirection si la session a réellement disparu).
      }
    }

    // Session expirée ou invalide (voir lib/auth-helpers.ts : toutes les routes
    // protégées répondent 401 "Non authentifié — reconnectez-vous." dans ce cas,
    // jamais pour un autre motif — les routes cron et OAuth qui utilisent aussi
    // un 401 ne passent pas par fetch() donc ne sont jamais concernées ici).
    // Plutôt que de laisser chaque page (hook useAuthedUser dupliqué dans 17
    // pages) afficher ce message brut à l'utilisateur, on redirige directement
    // vers /login dès qu'un appel API renvoie 401 — un seul endroit à corriger
    // pour toutes les pages, au lieu de 17.
    //
    // Bug remonté par Alex (2026-08-19) : cette redirection pouvait se déclencher
    // juste après une connexion réussie ("connecté puis déconnecté aussitôt"),
    // sur un raté ponctuel côté serveur lors de la toute première vérification du
    // token (ex. léger délai de propagation juste après signInWithPassword) —
    // alors même que la session était toujours valide localement. On revérifie
    // donc la session locale avant de rediriger : si elle existe encore, ce 401
    // était probablement transitoire et on laisse la page gérer l'erreur comme
    // avant (pas de déconnexion forcée) ; on ne redirige que si la session a
    // réellement disparu.
    if (response.status === 401 && window.location.pathname !== '/login') {
      try {
        // Bug remonté à nouveau par Alex (2026-08-25) : "Non authentifié —
        // reconnecte-toi." qui persiste même en cliquant sur "Réessayer",
        // sans aucun moyen de s'en sortir. Cause probable : getSession() ne
        // fait AUCUN aller-retour réseau, il se contente de relire la copie
        // locale (mémoire/localStorage) de la session — si un rafraîchissement
        // de jeton a échoué silencieusement quelque part (jeton de
        // rafraîchissement à usage unique déjà consommé par un appel
        // concurrent, voir refreshSessionShared ci-dessus) sans que le client
        // Supabase local ait purgé son état, getSession() continue de
        // renvoyer une session qui "a l'air" valide alors que le serveur la
        // rejette déjà pour de bon — donc plus aucune redirection possible
        // vers /login, la page reste bloquée sur l'erreur brute. getUser(),
        // contrairement à getSession(), revalide réellement le jeton auprès
        // de Supabase avant de répondre.
        const { data, error } = await supabaseBrowser.auth.getUser();
        if (error || !data?.user) {
          // On nettoie explicitement l'état local avant de rediriger, pour
          // ne pas laisser une session locale corrompue perturber la page de
          // connexion elle-même ou la prochaine tentative.
          await supabaseBrowser.auth.signOut();
          window.location.href = '/login';
        }
      } catch (err) {
        window.location.href = '/login';
      }
    }

    return response;
  };
}

export default function AuthFetchInterceptor() {
  return null;
}
