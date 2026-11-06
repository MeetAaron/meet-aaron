// app/app/page.jsx
// Route "racine" de l'app (/app) : aucun lien de la navigation ne pointe
// ici (tous les liens du menu pointent vers /app/<section>), mais elle reste
// accessible si quelqu'un tape ou a en favori cette URL directement.
//
// Avant : ce fichier était une copie collée de app/app/resultats/page.jsx
// (probablement un reliquat d'un stade antérieur du développement où /app
// affichait directement les résultats), avec les mêmes bugs qu'on vient de
// corriger sur Résultats (accès `.status.replace()` sans garde) — et sans
// nav mobile fonctionnelle du tout : le Shell de cette copie n'avait ni état
// d'ouverture ni bouton hamburger, donc à ≤900px le menu latéral disparaissait
// sans aucun moyen de le rouvrir. Remplacé par une simple redirection vers le
// page Campagnes, l'accueil de l'app depuis le 06/11/2026 (décision Alex :
// le tableau de bord disparaît, Campagnes le remplace).
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AppRootPage() {
  const router = useRouter();

  useEffect(() => {
    const userId = new URLSearchParams(window.location.search).get('user_id');
    router.replace(userId ? `/app/campaigns?user_id=${userId}` : '/app/campaigns');
  }, [router]);

  return null;
}
