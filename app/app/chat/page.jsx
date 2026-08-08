// app/app/chat/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
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
        setAuthError(body.error || 'Accès refusé');
        setAuthLoading(false);
        return;
      }

      setUserId(body.user.id);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, authLoading, authError };
}

export default function ChatPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        message: userMessage.content,
        history: messages,
      }),
    });

    const data = await res.json();
    setSending(false);

    if (data.reply) {
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    }
  }

  async function handleSendFeedback(e) {
    e.preventDefault();
    if (!feedbackText.trim() || feedbackSending) return;
    setFeedbackSending(true);

    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, message: feedbackText }),
    });

    setFeedbackSending(false);
    setFeedbackText('');
    setShowFeedback(false);
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif;
          }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active="Chat avec Aaron" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Discussion</p>
          <h1>Chat avec Aaron</h1>
        </div>
        <button className="btn-feedback" onClick={() => setShowFeedback(!showFeedback)}>
          🚩 Signaler à l'équipe
        </button>
      </header>

      {feedbackSent && <p className="feedback-sent">Merci, ton message a été transmis à l'équipe !</p>}

      {showFeedback && (
        <form className="feedback-form" onSubmit={handleSendFeedback}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Une idée, un bug, une suggestion ? Décris-le ici, ça sera transmis directement à l'équipe Meet Aaron."
            rows={3}
          />
          <div className="feedback-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowFeedback(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={feedbackSending || !feedbackText.trim()}>
              {feedbackSending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}

      <div className="chat-box">
        <div className="messages">
          {messages.length === 0 && (
            <div className="intro">
              <p>Salut ! Pose-moi une question sur tes prospects, tes campagnes, ou demande-moi un conseil commercial.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="bubble assistant typing">Aaron réfléchit…</div>}
          <div ref={bottomRef} />
        </div>

        <form className="input-row" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écris ton message…"
            disabled={sending}
          />
          <button type="submit" className="btn-send" disabled={sending || !input.trim()}>
            Envoyer
          </button>
        </form>
      </div>

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0;
        }
        .btn-feedback {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 10px;
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .feedback-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: #3dd68c;
          padding: 0.7rem 1rem;
          border-radius: 10px;
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
        .feedback-form {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .feedback-form textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .feedback-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.7rem;
        }
        .btn-primary, .btn-secondary {
          border-radius: 8px;
          padding: 0.5rem 1rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          font-weight: 600;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .chat-box {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          height: 60vh;
          overflow: hidden;
        }
        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.4rem;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }
        .intro {
          color: var(--muted);
          font-size: 0.9rem;
          text-align: center;
          margin-top: 2rem;
        }
        .bubble {
          max-width: 70%;
          padding: 0.7rem 1rem;
          border-radius: 14px;
          font-size: 0.9rem;
          line-height: 1.45;
          white-space: pre-wrap;
        }
        .bubble.user {
          align-self: flex-end;
          background: var(--accent);
          color: white;
          border-bottom-right-radius: 4px;
        }
        .bubble.assistant {
          align-self: flex-start;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-bottom-left-radius: 4px;
        }
        .bubble.typing {
          color: var(--muted);
          font-style: italic;
        }
        .input-row {
          display: flex;
          gap: 0.6rem;
          padding: 1rem;
          border-top: 1px solid var(--border);
        }
        .input-row input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.7rem 1rem;
          color: var(--text);
          font-size: 0.9rem;
        }
        .btn-send {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.7rem 1.2rem;
          font-weight: 600;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard' },
    { label: 'Prospects', slug: 'prospects' },
    { label: 'Campagnes', slug: 'campaigns' },
    { label: 'Agenda', slug: 'agenda' },
    { label: 'Résultats', slug: 'resultats' },
    { label: 'Clients gagnés', slug: 'clients-gagnes' },
    { label: 'Mes documents', slug: 'documents' },
    { label: 'Chat avec Aaron', slug: 'chat' },
    { label: 'Connexions', slug: 'connexions' },
    { label: 'Préférences', slug: 'preferences' },
    { label: 'Mon équipe', slug: 'team' },
  ];
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link key={item.label} href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`} className="nav-link">
              <li className={item.label === active ? 'active' : ''}>{item.label}</li>
            </Link>
          ))}
        </ul>
      </nav>
      <main className="content">{children}</main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0b0e1a;
          --surface: #131629;
          --border: #232744;
          --accent: #4b39ef;
          --accent-green: #3dd68c;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 240px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 1.5rem 1.2rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: var(--font-display);
          font-weight: 600;
          margin-bottom: 2rem;
        }
        .brand-mark {
          width: 30px;
          height: 30px;
          border-radius: 8px;
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          padding: 0.6rem 0.7rem;
          border-radius: 8px;
          font-size: 0.88rem;
          color: var(--muted);
          cursor: pointer;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .content {
          padding: 2.5rem 3rem;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .sidebar {
            display: none;
          }
          .content {
            padding: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}
