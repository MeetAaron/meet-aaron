// app/unsubscribe/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function UnsubscribePage() {
  const [userId, setUserId] = useState(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (session) setUserId(session.user.id);
    });
  }, []);

  async function handleConfirm() {
    setSending(true);
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) {
      setSending(false);
      return;
    }
    const linkRes = await fetch('/api/auth/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
    });
    const linkBody = await linkRes.json();
    if (!linkRes.ok) {
      setSending(false);
      return;
    }

    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: linkBody.user.id, reason }),
    });

    setSending(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="wrap">
        <div className="card">
          <img src="/icon.png" alt="Meet Aaron" className="logo" />
          <h1>Votre demande a été transmise</h1>
          <p className="subtitle">Notre équipe va traiter votre résiliation et revient vers vous rapidement. Merci d'avoir testé Meet Aaron.</p>
          <a href="/app/preferences" className="btn-secondary">Retour aux préférences</a>
        </div>
        <style jsx>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
          .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; font-family: 'Inter', sans-serif; padding: 1rem; }
          .card { background: #131629; border: 1px solid #232744; border-radius: 16px; padding: 2.5rem; width: 420px; max-width: 100%; text-align: center; }
          .logo { width: 44px; height: 44px; border-radius: 11px; margin-bottom: 1rem; }
          h1 { font-family: 'Space Grotesk', sans-serif; color: #f4f1ea; font-size: 1.25rem; margin: 0 0 0.6rem; }
          .subtitle { color: #8b90a8; font-size: 0.88rem; margin: 0 0 1.6rem; line-height: 1.5; }
          .btn-secondary { display: inline-block; color: #4b39ef; text-decoration: none; font-size: 0.86rem; font-weight: 600; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="card">
        <img src="/icon.png" alt="Meet Aaron" className="logo" />
        <h1>Voulez-vous vraiment nous quitter ?</h1>
        <p className="subtitle">
          Avant de partir, dites-nous ce qui ne va pas — on pourra peut-être arranger ça ensemble.
          Si vous préférez tout de même résilier, dites-le-nous ci-dessous.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Qu'est-ce qui vous ferait changer d'avis ? (optionnel)"
          rows={4}
        />

        <div className="actions">
          <a href="/app/preferences" className="btn-primary">Rester abonné</a>
          <button className="btn-danger" onClick={handleConfirm} disabled={sending}>
            {sending ? 'Envoi…' : 'Confirmer la résiliation'}
          </button>
        </div>
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0e1a;
          font-family: 'Inter', sans-serif;
          padding: 1rem;
        }
        .card {
          background: #131629;
          border: 1px solid #232744;
          border-radius: 16px;
          padding: 2.5rem;
          width: 420px;
          max-width: 100%;
          text-align: center;
        }
        .logo {
          width: 44px;
          height: 44px;
          border-radius: 11px;
          margin-bottom: 1rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          color: #f4f1ea;
          font-size: 1.3rem;
          margin: 0 0 0.6rem;
        }
        .subtitle {
          color: #8b90a8;
          font-size: 0.86rem;
          margin: 0 0 1.4rem;
          line-height: 1.5;
        }
        textarea {
          width: 100%;
          background: #0b0e1a;
          border: 1px solid #232744;
          border-radius: 8px;
          padding: 0.7rem;
          color: #f4f1ea;
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
          margin-bottom: 1.4rem;
        }
        .actions {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .btn-primary {
          background: #4b39ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          font-weight: 600;
          font-size: 0.9rem;
          text-decoration: none;
          display: block;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid #e5484d;
          color: #e5484d;
          border-radius: 10px;
          padding: 0.7rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
