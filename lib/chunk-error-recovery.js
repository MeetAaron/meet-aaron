// lib/chunk-error-recovery.js
// Filet de sécurité contre les échecs de chargement de "chunk" Next.js
// (JS/CSS scindé par page) lors d'une navigation côté client, quand l'onglet
// est resté ouvert pendant qu'un nouveau déploiement a remplacé les fichiers
// buildés sur le serveur : le navigateur essaie de charger un chunk qui
// n'existe plus au chemin attendu (hash de build différent) et échoue
// silencieusement -> rendu dégradé (CSS non appliquée, composants qui ne
// s'hydratent pas correctement) sans aucune erreur visible pour la personne
// (bug remonté plusieurs fois par Alex, notamment sur la checklist
// d'onboarding du tableau de bord, 2026-08-27 -> 2026-08-30). Un repro
// Playwright exhaustif (10 largeurs d'écran, CSS/markup exacts) n'a jamais
// reproduit le bug depuis le code lui-même, ce qui pointe vers une cause
// côté navigateur/déploiement plutôt qu'un bug CSS — cohérent avec ce
// scénario, très plausible vu le nombre de déploiements enchaînés pendant
// qu'Alex avait des onglets ouverts en train de tester.
//
// On détecte les erreurs caractéristiques ("Loading chunk X failed",
// "ChunkLoadError", "Failed to fetch dynamically imported module") au niveau
// window (error + unhandledrejection : seuls endroits qui les interceptent
// de façon fiable avec l'App Router) et on force un rechargement complet une
// seule fois (garde anti-boucle via sessionStorage) : ça régénère la page
// avec les bons fichiers, sans que la personne ait à deviner qu'il faut
// recharger elle-même.
export const CHUNK_ERROR_RECOVERY_SCRIPT = `
(function () {
  var FLAG_KEY = 'meetaaron_chunk_reload_at';
  var COOLDOWN_MS = 15000;
  function isChunkError(message) {
    if (!message) return false;
    return /Loading chunk [\\w.-]+ failed/i.test(message) ||
      /ChunkLoadError/i.test(message) ||
      /Failed to fetch dynamically imported module/i.test(message) ||
      /Importing a module script failed/i.test(message);
  }
  function reloadOnce() {
    try {
      var last = Number(window.sessionStorage.getItem(FLAG_KEY) || 0);
      if (Date.now() - last < COOLDOWN_MS) return;
      window.sessionStorage.setItem(FLAG_KEY, String(Date.now()));
    } catch (err) {}
    window.location.reload();
  }
  window.addEventListener('error', function (event) {
    var message = (event && (event.message || (event.error && event.error.message))) || '';
    if (isChunkError(message)) reloadOnce();
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = (reason && (reason.message || String(reason))) || '';
    if (isChunkError(message)) reloadOnce();
  });
})();
`;
