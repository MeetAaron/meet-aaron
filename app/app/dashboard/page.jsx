// app/app/dashboard/page.jsx
//
// LE TABLEAU DE BORD N'EXISTE PLUS (06/11/2026).
//
// Décision d'Alex (docx du 05/11, confirmée le 06/11 : « rappelle-toi, le
// tableau de bord disparaît et à la place c'est Campagnes en cours avec les
// notifs en haut ») : la campagne est l'unité de travail d'Aaron, le tableau
// de bord n'en était que la sortie. Campagnes est désormais l'accueil : le
// bandeau des actions requises en haut (rendu par le Shell), la checklist de
// mise en route pour un compte neuf (components/SetupChecklist.jsx), le
// journal « pendant ton absence » (components/ActivityFeed.jsx), puis les
// cartes de campagne. Les rapports globaux restent dans Résultats, rangé
// dans « Plus ».
//
// Cette route reste pour les anciens liens (favoris, notifications déjà
// envoyées, raccourci d'écran d'accueil) : elle renvoie vers Campagnes en
// conservant user_id.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    const userId = new URLSearchParams(window.location.search).get('user_id');
    router.replace(userId ? `/app/campaigns?user_id=${userId}` : '/app/campaigns');
  }, [router]);

  return null;
}
