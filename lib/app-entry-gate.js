// lib/app-entry-gate.js
//
// PORTE D'ENTREE DE /app, EXECUTEE AVANT TOUT LE RESTE (15/11/2026).
//
// La regle existe deja (components/AuthFetchInterceptor.jsx) : sans passage
// par « Se connecter » aujourd'hui, /app renvoie vers /login. Mais elle
// etait appliquee par le JavaScript de la page — donc APRES avoir telecharge
// et lance tout le code de la rubrique demandee. A l'ouverture de l'app
// iPhone (qui demarre sur /app/campaigns), ca donnait : ecran sombre
// « Connexion… » pendant le telechargement, PUIS seulement le renvoi vers
// /login, PUIS le chargement de la page de connexion. Trois ecrans, dix
// secondes en 4G.
//
// Ce petit script est ecrit directement dans le HTML, tout en haut du
// <body> : il s'execute des que le navigateur recoit la page, avant le
// moindre telechargement. Si la connexion du jour manque, on part tout de
// suite sur /login. Meme cle et meme format de date que
// lib/supabase-browser.ts (EXPLICIT_LOGIN_DATE_FLAG, todayLocalDateString).
// Le controle de AuthFetchInterceptor reste en place comme second filet.
export const APP_ENTRY_GATE_SCRIPT = `
(function () {
  try {
    var p = window.location.pathname;
    if (p !== '/app' && p.indexOf('/app/') !== 0) return;
    var d = new Date();
    var today = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    if (window.localStorage.getItem('aaron-explicit-login-date') === today) return;
    var next = p.indexOf('/app/') === 0 ? p + (window.location.search || '') : '';
    window.__aaronAppEntryChecked = true;
    window.location.replace(next ? '/login?next=' + encodeURIComponent(next) : '/login');
  } catch (err) {}
})();
`;
