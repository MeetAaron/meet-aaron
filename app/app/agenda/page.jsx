// app/app/agenda/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

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

const TYPE_LABELS = {
  telephonique: 'Téléphonique',
  physique: 'Physique',
  visio: 'Visio',
};

const TYPE_ICONS = {
  telephonique: '📞',
  physique: '🤝',
  visio: '💻',
};

const STATUS_META = {
  'proposé': { label: 'À valider', color: '#F0914E' },
  'validé': { label: 'Validé', color: '#3DD68C' },
  'reporté': { label: 'Reporté', color: '#8B90A8' },
  'annulé': { label: 'Annulé', color: '#E5484D' },
  'terminé': { label: 'Terminé', color: '#4B9EF0' },
};

export default function AgendaPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState(null);
  const [conflict, setConflict] = useState(null); // { appointmentId, reasons }
  const [showAddModal, setShowAddModal] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json());
    setAppointments(res.appointments || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  async function handleAction(appointmentId, action, force = false) {
    setActingOn(appointmentId);
    const res = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, force }),
    });
    setActingOn(null);

    if (res.status === 409) {
      const body = await res.json();
      setConflict({ appointmentId, action, reasons: body.reasons || [] });
      return;
    }

    setConflict(null);
    load();
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
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

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0b0e1a;
            color: #e5484d;
            font-family: 'Inter', sans-serif;
            text-align: center;
            padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  const pending = appointments.filter((a) => a.status === 'proposé');
  const rest = appointments.filter((a) => a.status !== 'proposé');

  return (
    <Shell active="Agenda" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Rendez-vous</p>
          <h1>Votre agenda</h1>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowAddModal(true)}>
          + Ajouter
        </button>
      </header>

      {showAddModal && (
        <AddEntryModal
          userId={userId}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            load();
          }}
        />
      )}

      {conflict && (
        <div className="conflict-overlay" onClick={() => setConflict(null)}>
          <div className="conflict-box" onClick={(e) => e.stopPropagation()}>
            <p className="conflict-title">Ce créneau semble poser problème</p>
            <ul className="conflict-reasons">
              {conflict.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="conflict-hint">Voulez-vous confirmer ce rendez-vous malgré tout ?</p>
            <div className="conflict-actions">
              <button className="btn-neutral" onClick={() => setConflict(null)}>Annuler</button>
              <button
                className="btn-valid"
                onClick={() => handleAction(conflict.appointmentId, conflict.action, true)}
              >
                Confirmer quand même
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : appointments.length === 0 ? (
        <EmptyState title="Aucun rendez-vous" body="Aaron n'a pas encore proposé de créneau." />
      ) : (
        <>
          {pending.length > 0 && (
            <section className="block">
              <h2>À valider ({pending.length})</h2>
              <div className="list">
                {pending.map((a) => (
                  <div className="row" key={a.id}>
                    <div className="row-info">
                      <strong>{a.prospects?.full_name}</strong>
                      <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      <div className="meta">
                        <span className={`type-badge type-${a.type}`}>{TYPE_ICONS[a.type] || ''} {TYPE_LABELS[a.type]}</span>
                        {' · '}{new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        className="btn-valid"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'valider')}
                      >
                        Valider
                      </button>
                      <button
                        className="btn-neutral"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'reporter')}
                      >
                        Reporter
                      </button>
                      <button
                        className="btn-danger"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'annuler')}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="block">
            <h2>Tous les rendez-vous</h2>
            <div className="list">
              {rest.map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META['proposé'];
                return (
                  <div className="row" key={a.id}>
                    <div className="row-info">
                      <strong>{a.prospects?.full_name || a.contact_name}</strong>
                      {a.prospects ? (
                        <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      ) : (
                        <span className="muted"> — contact personnel</span>
                      )}
                      <div className="meta">
                        <span className={`type-badge type-${a.type}`}>{TYPE_ICONS[a.type] || ''} {TYPE_LABELS[a.type]}</span>
                        {' · '}{new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                        {a.source === 'manuel' && ' · ajouté manuellement'}
                      </div>
                      {a.meet_link && (
                        <a href={a.meet_link} target="_blank" rel="noreferrer" className="meet-link">
                          🎥 Lien Google Meet
                        </a>
                      )}
                    </div>
                    <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.8rem;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.7rem 1.1rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
          flex-shrink: 0;
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
        .block {
          margin-bottom: 2rem;
        }
        .block h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.9rem;
        }
        .list {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          overflow: hidden;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.2rem;
          border-bottom: 1px solid var(--border);
          gap: 1rem;
        }
        .row:last-child {
          border-bottom: none;
        }
        .row-info {
          font-size: 0.9rem;
        }
        .meta {
          font-size: 0.78rem;
          color: var(--muted);
          margin-top: 0.25rem;
        }
        .type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.1rem 0.55rem;
          font-weight: 600;
          color: var(--text);
        }
        .type-badge.type-visio {
          border-color: #4b9ef0;
          color: #4b9ef0;
        }
        .type-badge.type-physique {
          border-color: #3dd68c;
          color: #3dd68c;
        }
        .type-badge.type-telephonique {
          border-color: #f0914e;
          color: #f0914e;
        }
        .meet-link {
          display: inline-block;
          font-size: 0.78rem;
          color: var(--accent);
          text-decoration: none;
          margin-top: 0.3rem;
        }
        .muted {
          color: var(--muted);
        }
        .row-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        .btn-valid, .btn-neutral, .btn-danger {
          border: none;
          border-radius: 8px;
          padding: 0.5rem 0.9rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
        }
        .btn-neutral {
          background: var(--border);
          color: var(--text);
        }
        .btn-danger {
          background: transparent;
          border: 1px solid #e5484d;
          color: #e5484d;
        }
        .status-pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.25rem 0.7rem;
          font-size: 0.76rem;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .conflict-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .conflict-box {
          background: var(--surface);
          border: 1px solid #e5484d;
          border-radius: 14px;
          padding: 1.6rem;
          max-width: 420px;
          width: 100%;
        }
        .conflict-title {
          font-weight: 600;
          margin: 0 0 0.8rem;
          color: #e5484d;
        }
        .conflict-reasons {
          margin: 0 0 1rem;
          padding-left: 1.2rem;
          font-size: 0.86rem;
          color: var(--text);
        }
        .conflict-hint {
          font-size: 0.84rem;
          color: var(--muted);
          margin: 0 0 1.2rem;
        }
        .conflict-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
      `}</style>
    </Shell>
  );
}

const ENTRY_KINDS = [
  { key: 'indisponibilite', label: 'Indisponibilité', icon: '🚫' },
  { key: 'telephonique', label: 'RDV téléphonique', icon: '📞' },
  { key: 'visio', label: 'RDV visio', icon: '💻' },
  { key: 'physique', label: 'RDV physique', icon: '🤝' },
];

function AddEntryModal({ userId, onClose, onCreated }) {
  const [kind, setKind] = useState(null);
  const [prospectSource, setProspectSource] = useState('aaron'); // 'aaron' | 'perso'
  const [prospects, setProspects] = useState([]);
  const [prospectId, setProspectId] = useState('');
  const [contactName, setContactName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (kind && kind !== 'indisponibilite' && prospectSource === 'aaron' && prospects.length === 0) {
      fetch(`/api/prospects?user_id=${userId}`)
        .then((r) => r.json())
        .then((res) => setProspects(res.prospects || []));
    }
  }, [kind, prospectSource, userId, prospects.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (kind === 'indisponibilite') {
      if (!date || !time || !endDate || !endTime) {
        setError('Merci de renseigner le début et la fin de l\'indisponibilité.');
        return;
      }
      setSubmitting(true);
      const res = await fetch('/api/availability/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          start_at: new Date(`${date}T${time}`).toISOString(),
          end_at: new Date(`${endDate}T${endTime}`).toISOString(),
          reason: reason || null,
        }),
      });
      setSubmitting(false);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Erreur lors de la création');
        return;
      }
      onCreated();
      return;
    }

    if (!date || !time) {
      setError('Merci de renseigner la date et l\'heure du rendez-vous.');
      return;
    }
    if (prospectSource === 'aaron' && !prospectId) {
      setError('Choisissez un prospect suivi par Aaron.');
      return;
    }
    if (prospectSource === 'perso' && !contactName.trim()) {
      setError('Indiquez le nom du contact.');
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        type: kind,
        proposed_at: new Date(`${date}T${time}`).toISOString(),
        prospect_id: prospectSource === 'aaron' ? prospectId : null,
        contact_name: prospectSource === 'perso' ? contactName.trim() : null,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Erreur lors de la création');
      return;
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Ajouter dans l'agenda</h2>

        {!kind ? (
          <div className="kind-grid">
            {ENTRY_KINDS.map((k) => (
              <button type="button" key={k.key} className="kind-btn" onClick={() => setKind(k.key)}>
                <span className="kind-icon">{k.icon}</span>
                {k.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="hint">{ENTRY_KINDS.find((k) => k.key === kind)?.label}</p>

            {kind !== 'indisponibilite' && (
              <div className="source-row">
                <button
                  type="button"
                  className={prospectSource === 'aaron' ? 'chip active' : 'chip'}
                  onClick={() => setProspectSource('aaron')}
                >
                  Prospect d'Aaron
                </button>
                <button
                  type="button"
                  className={prospectSource === 'perso' ? 'chip active' : 'chip'}
                  onClick={() => setProspectSource('perso')}
                >
                  Mon propre prospect
                </button>
              </div>
            )}

            {kind !== 'indisponibilite' && prospectSource === 'aaron' && (
              <label>
                Prospect
                <select value={prospectId} onChange={(e) => setProspectId(e.target.value)} required>
                  <option value="">— Sélectionner —</option>
                  {prospects.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}{p.prospect_companies?.name ? ` — ${p.prospect_companies.name}` : ''}</option>
                  ))}
                </select>
              </label>
            )}

            {kind !== 'indisponibilite' && prospectSource === 'perso' && (
              <label>
                Nom du contact
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="ex: Jean Martin" required />
              </label>
            )}

            <div className="date-row">
              <label>
                {kind === 'indisponibilite' ? 'Début' : 'Date'}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label>
                Heure
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </label>
            </div>

            {kind === 'indisponibilite' && (
              <div className="date-row">
                <label>
                  Fin
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
                </label>
                <label>
                  Heure
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                </label>
              </div>
            )}

            {kind === 'indisponibilite' && (
              <label>
                Motif (optionnel)
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex: congés, RDV personnel…" />
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => setKind(null)}>Retour</button>
              <button type="submit" className="btn-valid" disabled={submitting}>
                {submitting ? 'Enregistrement…' : 'Ajouter'}
              </button>
            </div>
          </>
        )}

        {!kind && (
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          </div>
        )}
      </form>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 1rem;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.8rem;
          width: 440px;
          max-width: 100%;
          max-height: 90vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 1rem;
        }
        .hint {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0 0 1rem;
        }
        .kind-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
          margin-bottom: 1rem;
        }
        .kind-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 1rem 0.6rem;
          color: var(--text);
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
        }
        .kind-icon {
          font-size: 1.3rem;
        }
        .source-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .chip {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.4rem 0.85rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .chip.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 0.9rem;
        }
        .date-row {
          display: flex;
          gap: 0.7rem;
        }
        .date-row label {
          flex: 1;
        }
        input, select {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.6rem 0.7rem;
          color: var(--text);
          font-size: 0.88rem;
          font-family: inherit;
        }
        .error {
          color: #e5484d;
          font-size: 0.82rem;
          margin: 0 0 0.8rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 0.4rem;
        }
        .btn-secondary {
          background: var(--border);
          color: var(--text);
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: 4rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
        }
        .empty-title {
          font-weight: 600;
          margin: 0 0 0.35rem;
        }
        .empty-body {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard', icon: '📊' },
    { label: 'Prospects', slug: 'prospects', icon: '🎯' },
    { label: 'Campagnes', slug: 'campaigns', icon: '🚀' },
    { label: 'Agenda', slug: 'agenda', icon: '📅' },
    { label: 'Résultats', slug: 'resultats', icon: '📈' },
    { label: 'Clients gagnés', slug: 'clients-gagnes', icon: '🏆' },
    { label: 'Mes documents', slug: 'documents', icon: '📁' },
    { label: 'Chat avec Aaron', slug: 'chat', icon: '💬' },
    { label: 'Connexions', slug: 'connexions', icon: '🔗' },
    { label: 'Disponibilités', slug: 'disponibilites', icon: '🕒' },
    { label: 'Préférences', slug: 'preferences', icon: '⚙️' },
    { label: 'Mon équipe', slug: 'team', icon: '👥' },
    { label: 'Suggestions', slug: 'suggestions', icon: '💡' },
  ];
  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Ouvrir le menu"
        onClick={() => setMobileOpen(true)}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={item.label === active ? 'active' : ''}><span className="nav-icon">{item.icon}</span>{item.label}</li>
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
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .nav-icon {
          font-size: 0.95rem;
          width: 1.1em;
          text-align: center;
          flex-shrink: 0;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .content {
          padding: 2.5rem 3rem;
        }
        .mobile-menu-btn {
          display: none;
        }
        .sidebar-overlay {
          display: none;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .mobile-menu-btn {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 60;
            width: 38px;
            height: 38px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            padding: 0;
          }
          .mobile-menu-btn .bar {
            display: block;
            width: 18px;
            height: 2px;
            margin: 0 auto;
            background: var(--text);
            border-radius: 1px;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 240px;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 65;
          }
          .content {
            padding: 1.5rem;
            padding-top: 4.5rem;
          }
        }
      `}</style>
    </div>
  );
}
