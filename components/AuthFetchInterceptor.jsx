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

    return originalFetch(input, opts);
  };
}

export default function AuthFetchInterceptor() {
  return null;
}
