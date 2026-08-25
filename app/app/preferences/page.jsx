// app/app/preferences/page.jsx
// Fusion "Mon compte" (demande Alex 2026-08-25 : "on va fusionner préférences
// et abonnements dans compte, ça me paraît bien plus logique") : cette page
// autonome a été absorbée par app/app/connexions/page.jsx (onglets Préférences
// et Abonnement, en plus des anciens Mon profil/Connexion/CRM). On la
// transforme en simple redirection plutôt que de la supprimer, pour ne pas
// avoir à traquer et corriger tous les liens externes/internes existants qui
// pointent encore vers /app/preferences (liens "module verrouillé" dupliqués
// dans les 14 pages, retours Stripe (billing-portal, réactivation
// d'abonnement), page de désabonnement, politique de confidentialité...).
//
// La query string est transmise telle quelle : ?user_id=... reste lu de la
// même façon par connexions/page.jsx, et ?tab=subscription (utilisé par tous
// les liens "module verrouillé" existants) est maintenant reconnu par
// connexions/page.jsx pour ouvrir directement le bon onglet.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PreferencesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    const target = `/app/connexions${window.location.search}`;
    router.replace(target);
  }, [router]);

  return (
    <div className="redirect-loading">
      <p>Redirection…</p>
      <style jsx>{`
        .redirect-loading {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
        }
      `}</style>
    </div>
  );
}
