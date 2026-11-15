// components/VersionWatcher.jsx
//
// RECHARGEMENT AUTOMATIQUE QUAND UNE NOUVELLE VERSION EST EN LIGNE
// (15/11/2026, propose a Alex, valide : « oui »).
//
// Les applis iPhone et Android affichent le site : une mise a jour du site
// arrive donc dans l'app sans passer par les stores… mais seulement au
// prochain chargement de page. Quelqu'un qui laisse l'app ouverte en
// arriere-plan pendant des jours gardait l'ancienne version.
//
// Ici : quand la page revient au premier plan, on demande au serveur
// l'identifiant de la version en ligne (/api/version). S'il a change :
//   - si rien n'est en cours de saisie, la page se recharge tout de suite
//     (dans l'app, derriere l'ecran de lancement : on voit le logo une
//     seconde, pas une page qui clignote) ;
//   - sinon on ne touche a rien — pas question de faire perdre un texte en
//     cours — et on note que la version est perimee : le prochain
//     changement de rubrique fera un chargement complet
//     (components/MobileChrome.jsx lit window.__aaronNewVersion).
//
// Garde-fous : jamais deux rechargements pour la meme version (au cas ou le
// serveur et la page ne seraient pas d'accord), une verification par minute
// au plus, et rien du tout si l'identifiant de version est inconnu.

'use client';

import { useEffect } from 'react';
import { getCapacitor } from '@/lib/native-app';

const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || '';
// Pas de préfixe « aaron_ » : la page de connexion efface ces clés
// (clearAppStorageOnLogout, lib/supabase-browser.ts) et le garde-fou
// « jamais deux rechargements pour la même version » y sautait. La valeur
// est un identifiant de commit, rien de personnel ; sessionStorage seulement.
const RELOADED_KEY = 'ma_build_reloaded';
const MIN_INTERVAL_MS = 60 * 1000;

// Vrai si un rechargement ferait perdre quelque chose a l'utilisateur.
function userIsBusy() {
  try {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
    // Un texte en cours de redaction (email, note, message du chat).
    const areas = document.querySelectorAll('textarea');
    for (let i = 0; i < areas.length; i += 1) {
      if ((areas[i].value || '').trim()) return true;
    }
    // Une fenetre ouverte par-dessus la page (formulaire, fiche, confirmation).
    // (.sidebar-overlay n'est que le fond du menu latéral : rien à perdre.)
    if (document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .overlay, .modal, [class*="-overlay"]:not(.sidebar-overlay), [class*="-modal"]')) return true;
  } catch {
    return true;
  }
  return false;
}

export default function VersionWatcher() {
  useEffect(() => {
    if (!MY_BUILD) return undefined;
    let lastCheck = Date.now();
    let checking = false;

    async function check() {
      if (document.visibilityState !== 'visible') return;
      if (checking || Date.now() - lastCheck < MIN_INTERVAL_MS) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const res = await window.fetch('/api/version', { cache: 'no-store' });
        const body = res.ok ? await res.json() : null;
        const online = body && typeof body.id === 'string' ? body.id : '';
        if (!online || online === MY_BUILD) return;
        window.__aaronNewVersion = true;
        let already = null;
        try { already = window.sessionStorage.getItem(RELOADED_KEY); } catch {}
        if (already === online) return;
        if (userIsBusy()) return;
        try { window.sessionStorage.setItem(RELOADED_KEY, online); } catch {}
        // Dans l'app : l'ecran de lancement couvre le rechargement. Il se
        // retire tout seul au bout de 6 s si la page ne le fait pas avant
        // (components/NativeAppBridge.jsx).
        const cap = getCapacitor();
        const splash = cap && cap.Plugins && cap.Plugins.SplashScreen;
        if (splash && typeof splash.show === 'function') {
          try {
            await Promise.race([
              Promise.resolve(splash.show({ autoHide: true, showDuration: 6000, fadeInDuration: 150, fadeOutDuration: 250 })),
              new Promise((resolve) => setTimeout(resolve, 400)),
            ]);
          } catch {}
        }
        window.location.reload();
      } catch {
        // Hors ligne ou serveur injoignable : on reessaiera au prochain retour.
      } finally {
        checking = false;
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return null;
}
