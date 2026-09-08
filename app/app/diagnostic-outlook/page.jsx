// app/app/diagnostic-outlook/page.jsx
// Page technique (08/09/2026) : affiche le rapport de /api/diagnostics/outlook
// pour la boîte Outlook du commercial connecté, avec un bouton « Réparer »
// (fix=1). Volontairement brute (JSON lisible, en français dans les clés) :
// c'est un outil de support, pas une page produit — non traduite, non listée
// dans la navigation. On y accède par l'URL /app/diagnostic-outlook.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

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
        router.push('/login');
        return;
      }
      setUserId(body.user.id);
    }
    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return userId;
}

export default function DiagnosticOutlookPage() {
  const userId = useAuthedUser();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Patron : peut viser la boîte d'un membre de son entreprise (liste
  // renvoyée par list=1 ; 403 silencieux pour un commercial).
  const [members, setMembers] = useState([]);
  const [target, setTarget] = useState('');

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/diagnostics/outlook?user_id=${userId}&list=1`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((body) => setMembers(body.members || []))
      .catch(() => setMembers([]));
  }, [userId]);

  async function run(fix) {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const t = target && target !== userId ? `&target=${target}` : '';
      const res = await fetch(`/api/diagnostics/outlook?user_id=${userId}${t}${fix ? '&fix=1' : ''}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReport(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (userId) run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <main className="diag">
      <h1>Diagnostic Outlook</h1>
      <p className="hint">
        Rejoue chaque étape de l'intégration Outlook avec les droits réellement accordés et affiche les réponses brutes
        de Microsoft. « Réparer » crée la catégorie et le dossier s'ils manquent, puis range les derniers envois d'Aaron.
      </p>
      {members.length > 1 && (
        <p className="target">
          Boîte à diagnostiquer :{' '}
          <select value={target || userId || ''} onChange={(e) => setTarget(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.email}
                {m.connections.length ? ` — ${m.connections.map((c) => `${c.provider}: ${c.email}`).join(', ')}` : ' — aucune boîte'}
              </option>
            ))}
          </select>
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={() => run(false)} disabled={!userId || loading}>
          {loading ? 'Analyse…' : 'Relancer le diagnostic'}
        </button>
        <button type="button" className="primary" onClick={() => run(true)} disabled={!userId || loading}>
          Réparer (créer catégorie + dossier, ranger les derniers envois)
        </button>
        <button
          type="button"
          onClick={() => report && navigator.clipboard.writeText(JSON.stringify(report, null, 2))}
          disabled={!report}
        >
          Copier le rapport
        </button>
      </div>
      {error && <p className="error">Erreur : {error}</p>}
      {report && (
        <>
          <p className={report.steps.every((s) => s.ok) ? 'ok' : 'error'}>{report.summary}</p>
          {report.steps.map((s) => (
            <details key={s.step} open={!s.ok}>
              <summary>
                <span className={s.ok ? 'badge ok' : 'badge ko'}>{s.ok ? 'OK' : 'ÉCHEC'}</span> {s.step}
                {s.status ? <span className="status"> · HTTP {s.status}</span> : null}
              </summary>
              {s.error && <p className="error">{s.error}</p>}
              <pre>{JSON.stringify(s.detail ?? null, null, 2)}</pre>
            </details>
          ))}
        </>
      )}
      <style jsx>{`
        .diag { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; font-family: system-ui, sans-serif; color: var(--text, #111); }
        h1 { font-size: 22px; margin: 0 0 8px; }
        .hint { color: var(--text-muted, #666); font-size: 14px; }
        .target select { max-width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: inherit; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
        button { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: inherit; cursor: pointer; }
        button.primary { background: #3b5bdb; color: #fff; border-color: #3b5bdb; }
        button:disabled { opacity: 0.5; cursor: default; }
        details { border: 1px solid var(--border, #ddd); border-radius: 8px; padding: 8px 12px; margin: 8px 0; background: var(--surface, #fff); }
        summary { cursor: pointer; font-weight: 600; }
        .badge { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 6px; margin-right: 6px; }
        .badge.ok { background: #d3f9d8; color: #2b8a3e; }
        .badge.ko { background: #ffe3e3; color: #c92a2a; }
        .status { font-weight: 400; color: var(--text-muted, #666); }
        .ok { color: #2b8a3e; }
        .error { color: #c92a2a; }
        pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--surface-2, #f6f6f6); padding: 8px; border-radius: 6px; overflow-x: auto; }
      `}</style>
    </main>
  );
}
