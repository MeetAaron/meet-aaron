// lib/theme.js
// Mode clair optionnel (tâche #129, piste 2). Préférence 100% côté
// navigateur (localStorage), pas de nouvelle colonne/migration — c'est un
// réglage d'affichage, pas une donnée métier. Par défaut l'app reste en
// thème sombre (comportement inchangé) tant que l'utilisateur n'a jamais
// activé le mode clair explicitement.

const STORAGE_KEY = 'meetaaron_theme';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch (err) {
    // Stockage indisponible (navigation privée stricte, etc.) — on retombe
    // sur le thème sombre par défaut, jamais bloquant.
    return 'dark';
  }
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.style.colorScheme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch (err) {
    // Best-effort — la préférence ne sera juste pas mémorisée d'une session
    // à l'autre, sans jamais faire échouer le changement de thème lui-même.
  }
}

// Script à exécuter le plus tôt possible (avant l'hydratation React) pour
// éviter un flash "sombre puis clair" chez un utilisateur ayant déjà choisi
// le mode clair — voir app/layout.jsx.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var theme = window.localStorage.getItem('${STORAGE_KEY}') === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (err) {}
})();
`;
