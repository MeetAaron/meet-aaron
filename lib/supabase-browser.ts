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

export function clearExplicitLogin() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(EXPLICIT_LOGIN_DATE_FLAG);
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
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
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
