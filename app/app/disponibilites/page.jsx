// app/app/disponibilites/page.jsx
// CHANGEMENTS A FAIRE #86 : Disponibilités n'est plus une page séparée —
// ses réglages (créneaux hebdo récurrents + indisponibilités ponctuelles)
// vivent désormais dans deux sections tout en bas de app/app/agenda/page.jsx,
// sous le nouveau calendrier mensuel (#87). Cette page redirige simplement
// vers Agenda pour ne pas casser d'éventuels liens/marque-pages existants.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DisponibilitesRedirect() {
  const router = useRouter();

  useEffect(() => {
    const userId = new URLSearchParams(window.location.search).get('user_id');
    router.replace(`/app/agenda${userId ? `?user_id=${userId}` : ''}`);
  }, [router]);

  return null;
}
