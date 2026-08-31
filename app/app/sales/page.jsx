// app/app/sales/page.jsx
// Fusion Prospects + Opportunités (docx « mon avis » d'Alex, 31/08/2026) :
// l'ancienne page Opportunités (Kanban RDV fait → devis envoyé → négociation
// → signé/perdu) est remplacée par la ligne de progression unique du
// tableau Prospects (app/app/prospects/page.jsx + components/ContactCard.jsx
// qui reprend brief, bilan, devis et signature via components/DealTools.jsx).
// Cette route ne sert plus qu'à rediriger les anciens liens (notifications
// push déjà envoyées, favoris) vers le tableau fusionné.
'use client';

import { useEffect } from 'react';

export default function SalesRedirectPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user_id');
    window.location.replace(`/app/prospects${userId ? `?user_id=${userId}` : ''}`);
  }, []);
  return null;
}
