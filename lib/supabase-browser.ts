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

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: dynamicStorage,
  },
});
