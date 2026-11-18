// lib/theme.js
// Thème de l'application. Préférence 100% côté navigateur (localStorage),
// pas de colonne en base — c'est un réglage d'affichage, pas une donnée
// métier.
//
// 18/11/2026 (décision d'Alex) : le thème par défaut n'est plus le sombre
// mais AUTOMATIQUE — l'app suit le réglage du téléphone ou de l'ordinateur
// (prefers-color-scheme), et reste claire quand l'appareil ne dit rien.
// Motif : le clair se lit mieux pour la plupart des gens et « vend » mieux,
// et celui qui a mis son appareil en sombre retrouve le sombre sans rien
// régler. Le choix manuel Clair / Sombre reste possible et prime.
//
// Stockage : 'light' ou 'dark' = choix explicite ; clé absente = automatique.

const STORAGE_KEY = 'meetaaron_theme';

function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (err) {
    return 'light';
  }
}

// Le CHOIX de l'utilisateur : 'auto', 'light' ou 'dark'.
export function getThemeChoice() {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch (err) {
    return 'auto';
  }
}

// Le thème réellement affiché : 'light' ou 'dark'.
export function getStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  const choice = getThemeChoice();
  return choice === 'auto' ? systemTheme() : choice;
}

// Applique un choix ('auto', 'light', 'dark') et le mémorise.
export function applyTheme(choice) {
  if (typeof document === 'undefined') return;
  const explicit = choice === 'light' || choice === 'dark';
  const next = explicit ? choice : systemTheme();
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.style.colorScheme = next;
  try {
    if (explicit) window.localStorage.setItem(STORAGE_KEY, choice);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Best-effort — la préférence ne sera juste pas mémorisée d'une session
    // à l'autre, sans jamais faire échouer le changement de thème lui-même.
  }
}

// Script exécuté le plus tôt possible (avant l'hydratation React) pour éviter
// un flash de mauvais thème — voir app/layout.jsx. En automatique, il suit
// aussi le changement de réglage de l'appareil pendant que l'app est ouverte
// (passage en sombre le soir, par exemple).
export const THEME_INIT_SCRIPT = `
(function () {
  var KEY = '${STORAGE_KEY}';
  function stored() {
    try { var v = window.localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch (err) { return null; }
  }
  var mq = null;
  try { mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null; } catch (err) {}
  function apply() {
    var theme = stored() || (mq && mq.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }
  apply();
  try {
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!stored()) apply(); });
  } catch (err) {}
})();
`;
