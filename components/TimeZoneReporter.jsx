// components/TimeZoneReporter.jsx
// Remonte discrètement le fuseau horaire du navigateur vers users.timezone
// (PATCH /api/user/timezone), pour que le rapport de résultats parte à minuit
// CHEZ le commercial et pas à minuit UTC — demande d'Alex du 12/09/2026
// (« je suis en Australie, donc le rapport doit être envoyé à minuit une, et
// ce pour chaque pays selon le fuseau horaire »).
//
// Pourquoi côté navigateur : le pays de facturation ne suffit pas dès qu'un
// pays a plusieurs fuseaux (Australie, États-Unis, Canada, Brésil, Russie) —
// voir lib/user-timezone.ts. Le navigateur, lui, connaît la réponse exacte.
//
// Aucune interface, aucun blocage : monté dans app/layout.jsx, il ne fait
// rien tant qu'il n'y a pas de session Supabase, et un échec réseau est
// ignoré (la valeur repartira au prochain chargement).
//
// Un seul appel par navigateur et par jour, et uniquement si le fuseau a
// changé depuis la dernière fois : sans cette garde, chaque navigation dans
// l'app déclencherait un écriture inutile en base.

'use client';

import { useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

const STORAGE_KEY = 'aaron_timezone_sent';

export default function TimeZoneReporter() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timezone = null;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (e) {
      timezone = null;
    }
    if (!timezone) return;

    const today = new Date().toISOString().slice(0, 10);
    const marker = `${timezone}|${today}`;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === marker) return;
    } catch (e) {
      // localStorage indisponible (navigation privée stricte) : on envoie,
      // ça ne coûte qu'un appel de plus.
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        if (cancelled || !data?.session) return;
        // Le token est attaché automatiquement par AuthFetchInterceptor.
        const res = await fetch('/api/user/timezone', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        });
        if (!res.ok) return;
        try {
          window.localStorage.setItem(STORAGE_KEY, marker);
        } catch (e) {
          /* ignoré */
        }
      } catch (e) {
        /* silencieux : ce n'est pas critique pour l'utilisateur */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
