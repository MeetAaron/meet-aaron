// lib/supabase-browser.ts
// Client Supabase utilisé côté NAVIGATEUR (pages 'use client') pour l'authentification.
// Utilise la clé publique "anon" — jamais la service_role ici.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// "Se souvenir de moi" (page /login) : quand la case est cochée (par défaut),
// la session est écrite dans localStorage et survit à la fermeture du
// navigateur — comportement historique, inchangé. Quand elle est décochée,
// la session est écrite dans sessionStorage à la place : elle reste valide
// tant que l'onglet reste ouvert, mais disparaît à la fermeture du
// navigateur. Le drapeau doit être positionné AVANT l'appel à
// signInWithPassword/signUp (c'est à ce moment que Supabase écrit le token).
const REMEMBER_ME_FLAG = 'aaron-remember-me';

export function setRememberMe(remember: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REMEMBER_ME_FLAG, remember ? '1' : '0');
}

function isRemembered(): boolean {
  if (typeof window === 'undefined') return true;
  // Par défaut (drapeau absent, ex. sessions déjà ouvertes avant ce
  // changement) on garde l'ancien comportement : toujours persistant.
  return window.localStorage.getItem(REMEMBER_ME_FLAG) !== '0';
}

const dynamicStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined') return;
    if (isRemembered()) {
      window.localStorage.setItem(key, value);
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
      window.localStorage.removeItem(key);
    }
  },
  removeItem(key: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

// Porte d'entrée explicite de /app (voir components/AuthFetchInterceptor.jsx) :
// un premier passage par "Se connecter" (ou le lancement d'une connexion
// Google/Microsoft) dans la journée suffit — les visites suivantes CE
// MÊME JOUR (heure locale du navigateur, jusqu'à minuit) entrent directement
// dans l'app sans redemander l'email/le mot de passe, tant que la session
// Supabase sous-jacente est toujours valide. Le lendemain (ou si le
// stockage a été vidé), il faut repasser explicitement par "Se connecter".
// Centralisé ici (plutôt que dupliqué dans chaque fichier qui y touche :
// AuthFetchInterceptor, /login, /app/preferences) pour que la clé de
// stockage et le format de date restent cohérents partout.
const EXPLICIT_LOGIN_DATE_FLAG = 'aaron-explicit-login-date';

function todayLocalDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function markExplicitLoginToday() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXPLICIT_LOGIN_DATE_FLAG, todayLocalDateString());
  } catch (err) {
    // Stockage indisponible (navigation privée stricte, etc.) : tant pis,
    // il faudra juste repasser par "Se connecter" au prochain onglet — pas
    // bloquant pour la connexion en cours.
  }
}

export function isExplicitlyLoggedInToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EXPLICIT_LOGIN_DATE_FLAG) === todayLocalDateString();
  } catch (err) {
    return false;
  }
}

// Appelé par TOUS les gestionnaires de déconnexion (handleLogout /
// confirmLogout des pages de l'app, ConnectionBadge), juste après
// supabaseBrowser.auth.signOut() — qui, lui, a déjà retiré la session
// Supabase (clé sb-<ref>-auth-token) de localStorage ET sessionStorage via
// dynamicStorage.removeItem ci-dessus.
//
// INVENTAIRE DU STOCKAGE NAVIGATEUR (CASA 6.6.1, 19/10/2026) :
//   - localStorage / sessionStorage : session Supabase (retirée par signOut),
//     puis des clés de confort propres à l'app — préfixes « meetaaron_ »
//     (brouillon de chat, conversation active, document en attente),
//     « aaron_ » / « aaron- » (rôle mémorisé, email mémorisé, pastilles
//     « déjà vu », identifiant d'appareil pour les notifications push),
//     drapeaux de connexion (EXPLICIT_LOGIN_DATE_FLAG, REMEMBER_ME_FLAG,
//     POST_LOGIN_NEXT_KEY), thème (lib/theme.js) et langue (lib/i18n.js).
//     Aucune de ces clés ne contient de jeton ni de donnée de prospect,
//     sauf le brouillon de chat, effacé ici.
//   - IndexedDB : non utilisé par l'application (aucune ouverture dans le
//     code) ; supprimé ici par précaution si un navigateur en avait créé.
//   - Cache Storage (service worker public/sw.js) : aucun cache créé — le
//     service worker est un passe-plat pour l'installation PWA et le push.
//   - Cookies : aucun cookie de session posé par l'application (le jeton
//     voyage dans l'en-tête Authorization) ; Supabase Auth n'en pose pas
//     non plus avec ce client.
// Ce qui est volontairement CONSERVÉ : thème et langue (préférences
// d'affichage, pas des données), et l'email mémorisé du formulaire de
// connexion si l'utilisateur a coché « se souvenir de moi ».
export function clearExplicitLogin() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(EXPLICIT_LOGIN_DATE_FLAG);
  } catch (err) {}
  clearAppStorageOnLogout();
}

const KEEP_ON_LOGOUT = new Set(['aaron-remembered-email', REMEMBER_ME_FLAG]);
const KEEP_PREFIXES_ON_LOGOUT = ['meetaaron_theme', 'aaron_locale'];

export function clearAppStorageOnLogout() {
  if (typeof window === 'undefined') return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        if (KEEP_ON_LOGOUT.has(k)) continue;
        if (KEEP_PREFIXES_ON_LOGOUT.some((p) => k === p || k.startsWith(p))) continue;
        // « meetaaron » sans séparateur : couvre aussi les clés « meetaaron: »
        // laissées par l'ancien prototype (23/10/2026, trouvées à
        // l'inventaire d'un navigateur réel).
        const ours = k.startsWith('meetaaron') || k.startsWith('aaron_') || k.startsWith('aaron-') || k.startsWith('sb-') || k.startsWith('supabase');
        if (ours) store.removeItem(k);
      }
    } catch (err) {}
  }
  // IndexedDB : rien n'y est écrit par l'app ; on supprime quand même toute
  // base présente sur cette origine (best-effort, asynchrone).
  try {
    const idb: any = (window as any).indexedDB;
    if (idb && typeof idb.databases === 'function') {
      idb.databases().then((dbs: { name?: string }[]) => {
        for (const db of dbs || []) if (db.name) idb.deleteDatabase(db.name);
      }).catch(() => {});
    }
  } catch (err) {}
  // Cache Storage : aucun cache créé par public/sw.js ; vidé par précaution.
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then((names) => names.forEach((n) => caches.delete(n))).catch(() => {});
    }
  } catch (err) {}
}

// Retour à la page demandée après connexion (31/08/2026) : quand la porte
// d'entrée de /app (AuthFetchInterceptor) renvoie vers /login, elle passe la
// page d'origine en ?next=… ; /login la mémorise ici et /onboarding (point
// de passage unique après connexion, mot de passe comme OAuth) y renvoie au
// lieu du dashboard. Cas d'usage principal : le QR code « active les
// notifications sur ton téléphone » de la checklist Mise en route
// (Mon compte > Connexion) — le téléphone scanne, se connecte, et retombe
// directement sur la bonne ligne au lieu de devoir retrouver l'onglet.
// Seules les pages de l'app (/app/…) sont acceptées : jamais une URL
// externe (pas de redirection ouverte exploitable par un lien piégé).
const POST_LOGIN_NEXT_KEY = 'aaron-post-login-next';

export function isSafePostLoginNext(next: string | null | undefined): next is string {
  return typeof next === 'string' && next.startsWith('/app/') && !next.startsWith('/app//') && !next.includes('://');
}

export function rememberPostLoginNext(next: string | null | undefined) {
  if (typeof window === 'undefined' || !isSafePostLoginNext(next)) return;
  try {
    window.localStorage.setItem(POST_LOGIN_NEXT_KEY, next);
  } catch (err) {}
}

export function consumePostLoginNext(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const next = window.localStorage.getItem(POST_LOGIN_NEXT_KEY);
    window.localStorage.removeItem(POST_LOGIN_NEXT_KEY);
    return isSafePostLoginNext(next) ? next : null;
  } catch (err) {
    return null;
  }
}

// Identifiant d'appareil (docx Modifs Aaron 30/08/2026, item 3bis : "si
// connexion via un autre PC, demander email de sécurité") : un UUID aléatoire
// propre à ce navigateur, conservé dans localStorage. Envoyé une fois par
// jour à /api/auth/link (voir AuthFetchInterceptor) qui prévient le
// commercial par email quand un appareil jamais vu se connecte à son compte.
// Aucune donnée personnelle : juste un jeton opaque, jamais réutilisé
// ailleurs.
const DEVICE_ID_KEY = 'aaron-device-id';
const DEVICE_CHECK_KEY = 'aaron-device-checked';

export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      // Générateur cryptographique du navigateur uniquement (CASA 4.1.3,
      // 23/10/2026) : plus de repli sur Math.random.
      if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        id = crypto.randomUUID();
      } else {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (err) {
    return null;
  }
}

// true une seule fois par jour (heure locale) : suffisant pour détecter un
// nouvel appareil sans refaire la vérification à chaque chargement de page.
export function shouldCheckDeviceToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stamp = todayLocalDateString();
    if (window.localStorage.getItem(DEVICE_CHECK_KEY) === stamp) return false;
    window.localStorage.setItem(DEVICE_CHECK_KEY, stamp);
    return true;
  } catch (err) {
    return false;
  }
}

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: dynamicStorage,
  },
});

// SESSION RÉSIDUELLE À L'ARRIVÉE SUR /login (CASA 2.2.1 / 6.6.1, 23/10/2026).
// La porte d'entrée de /app exige une connexion explicite chaque jour : le
// lendemain, l'utilisateur est renvoyé vers /login alors que la session de la
// veille (jeton de rafraîchissement compris) dort encore dans le stockage du
// navigateur. On la révoque ici CÔTÉ SERVEUR (signOut scope 'local' : seule
// cette session, les autres appareils ne sont pas touchés), puis on vide le
// stockage de l'app — y compris IndexedDB et Cache Storage, dont la
// suppression asynchrone a ici le temps d'aboutir (pas de navigation
// immédiate comme au clic sur « Déconnexion »). La page à rouvrir après
// connexion (?next=) est préservée.
export async function revokeStaleSessionOnLoginPage(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (isExplicitlyLoggedInToday()) return;
  let next: string | null = null;
  try { next = window.localStorage.getItem(POST_LOGIN_NEXT_KEY); } catch (err) {}
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    if (data?.session) {
      try { await supabaseBrowser.auth.signOut({ scope: 'local' }); } catch (err) {}
    }
  } catch (err) {}
  clearAppStorageOnLogout();
  if (next) {
    try { window.localStorage.setItem(POST_LOGIN_NEXT_KEY, next); } catch (err) {}
  }
}
