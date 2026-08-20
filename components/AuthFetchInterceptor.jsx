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

import { supabaseBrowser, isExplicitlyLoggedInToday } from '@/lib/supabase-browser';

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
      window.location.href = '/login';
    }
  }
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
        const { data: refreshed } = await supabaseBrowser.auth.refreshSession();
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

    const response = await originalFetch(input, opts);

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
        const { data } = await supabaseBrowser.auth.getSession();
        if (!data?.session) {
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
