// app/app/tour/page.jsx
// Visite guidée depuis le menu Aide (et le chat) : le scénario validé par
// Alex le 08/11/2026 (components/GuidedTour.jsx), le même que dans le
// parcours Bienvenue. L'ancienne visite « une diapositive par page » est
// remplacée : la description de chaque page vit dans l'Aide.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useLocale } from '@/lib/i18n';
import GuidedTour from '@/components/GuidedTour';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      const body = await res.json();

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }

      setUserId(body.user.id);
      setRole(body.user.role);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, role, authLoading, authError };
}

export default function TourPage() {
  const router = useRouter();
  const [locale] = useLocale();
  const { userId, role, authLoading, authError } = useAuthedUser();
  const [markedSeen, setMarkedSeen] = useState(false);

  function finish() {
    if (userId && !markedSeen) {
      setMarkedSeen(true);
      fetch('/api/tour-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) }).catch(() => {});
    }
    router.push(`/app/campaigns${userId ? `?user_id=${userId}` : ''}`);
  }

  if (authLoading) return <div className="loading">…</div>;
  if (authError) return <div className="loading error">{authError}</div>;

  return (
    <div className="tour-wrap">
      <div className="tour-card">
        <GuidedTour locale={locale} invited={role === 'commercial'} onDone={finish} onSkip={finish} />
      </div>
      <style jsx>{`
        .tour-wrap { min-height: 100vh; background: var(--bg); color: var(--text); padding: 1.25rem 1rem 3rem; box-sizing: border-box; }
        .tour-card { max-width: 860px; margin: 0 auto; }
        .loading { padding: 3rem; text-align: center; color: var(--muted); }
        .loading.error { color: var(--danger, #c0392b); }
      `}</style>
    </div>
  );
}
