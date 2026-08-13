// app/app/clients-gagnes/page.jsx
// Redirection : "Clients gagnés" a été fusionné dans "Résultats" (13/08).
// On garde cette route pour ne pas casser les anciens liens/marque-pages.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ClientsGagnesRedirect() {
  const router = useRouter();

  useEffect(() => {
    const userId = new URLSearchParams(window.location.search).get('user_id');
    router.replace(`/app/resultats${userId ? `?user_id=${userId}` : ''}`);
  }, [router]);

  return (
    <div className="redirect-loading">
      <p>Redirection vers Résultats…</p>
      <style jsx>{`
        .redirect-loading {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          color: #8b90a8;
          font-family: 'Inter', sans-serif;
        }
      `}</style>
    </div>
  );
}
