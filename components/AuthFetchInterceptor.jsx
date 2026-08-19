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

import { supabaseBrowser } from '@/lib/supabase-browser';

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
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data?.session?.access_token;
      if (token) {
        opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
      }
    } catch (err) {
      // Si on ne peut pas lire la session, on laisse partir la requête sans le
      // header plutôt que de bloquer l'appli — la route protégée répondra 401,
      // ce qui est un échec propre plutôt qu'un plantage silencieux ici.
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
