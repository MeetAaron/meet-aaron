// app/app/dashboard/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

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

const STATUS_META = {
  vert: { label: 'En bonne voie', color: '#3DD68C' },
  jaune: { label: 'En cours', color: '#8B90A8' },
  orange: { label: 'Risque de perdre', color: '#F0914E' },
  rouge: { label: 'Perdu', color: '#E5484D' },
  bleu: { label: 'RDV obtenu', color: '#4B9EF0' },
};

const PERSONALITY_LABELS = {
  dominant: 'Dominant',
  influent: 'Influent',
  stable: 'Stable',
  consciencieux: 'Consciencieux',
};

const TYPE_LABELS = {
  telephonique: 'Téléphonique',
  physique: 'Physique',
  visio: 'Visio',
};

export default function DashboardPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(true);
 const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedRescue, setSelectedRescue] = useState(null);

  async function loadAll() {
    setLoading(true);
    const [pRes, cRes, aRes] = await Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
    ]);
    setProspects(pRes.prospects || []);
    setCampaigns(cRes.campaigns || []);
    setAppointments(aRes.appointments || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  const statusCounts = Object.keys(STATUS_META).reduce((acc, key) => {
    acc[key] = prospects.filter((p) => p.status === key).length;
    return acc;
  }, {});

  const activeCampaigns = campaigns.filter((c) => c.status === 'en_cours' || c.status === 'en_attente');
  const upcomingAppointments = appointments
    .filter((a) => a.status === 'validé' && new Date(a.proposed_at) > new Date())
    .slice(0, 5);
  const pendingAppointments = appointments.filter((a) => a.status === 'proposé');
const cancelledByClient = appointments.filter(
    (a) => a.status === 'annulé' && a.cancelled_by === 'client' && !a.client_cancel_acknowledged
  );
  const rescueProspects = prospects.filter((p) => p.rescue_proposal_pending);
  const totalActions = pendingAppointments.length + cancelledByClient.length + rescueProspects.length;

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
    <Shell active="Tableau de bord" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Tableau de bord</p>
          <h1>Ce qu'Aaron a fait pendant votre absence</h1>
        </div>
        <AaronPulse active={activeCampaigns.length > 0} />
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
         <section className="actions-panel">
            <button className="actions-toggle" onClick={() => setActionsOpen(!actionsOpen)}>
              <span>
                Actions requises {totalActions > 0 && <span className="badge">{totalActions}</span>}
              </span>
              <span className="chevron">{actionsOpen ? '▲' : '▼'}</span>
            </button>
            {actionsOpen && (
              <div className="actions-list">
                {totalActions === 0 ? (
                  <p className="empty-actions">Rien à traiter pour le moment.</p>
                ) : (
                  <>
                    {pendingAppointments.map((a) => (
                      <button key={a.id} className="action-row" onClick={() => setSelectedAppointment({ ...a, actionType: 'valider' })}>
                        <span className="dot" style={{ background: '#F0914E' }} />
                        <span className="action-label">RDV à valider — {a.prospects?.full_name}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
{cancelledByClient.map((a) => (
                      <button key={a.id} className="action-row" onClick={() => setSelectedAppointment({ ...a, actionType: 'annule' })}>
                        <span className="dot" style={{ background: '#E5484D' }} />
                        <span className="action-label">RDV annulé par le client — {a.prospects?.full_name}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
                    {rescueProspects.map((p) => (
                      <button key={p.id} className="action-row" onClick={() => setSelectedRescue(p)}>
                        <span className="dot" style={{ background: '#8B90A8' }} />
                        <span className="action-label">Prospect perdu — tentative de sauvetage pour {p.full_name}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </section>

          <section className="stat-row">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <div className="stat-card" key={key}>
                <span className="dot" style={{ background: meta.color }} />
                <span className="stat-number">{statusCounts[key] || 0}</span>
                <span className="stat-label">{meta.label}</span>
              </div>
            ))}
          </section>

          <section className="grid-two">
            <div className="panel">
              <h2>Prochains rendez-vous</h2>
              {upcomingAppointments.length === 0 ? (
                <EmptyState title="Rien de prévu" body="Aaron n'a pas encore décroché de rendez-vous confirmé." compact />
              ) : (
                <ul className="list">
                  {upcomingAppointments.map((a) => (
                    <li key={a.id} className="list-item">
                      <div>
                        <strong>{a.prospects?.full_name}</strong>
                        <span className="muted"> — {a.prospects?.prospect_companies?.name || 'société inconnue'}</span>
                      </div>
                      <span className="pill">{new Date(a.proposed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel">
              <h2>Campagnes en cours</h2>
              {activeCampaigns.length === 0 ? (
                <EmptyState title="Aucune campagne active" body="Lancez une campagne pour qu'Aaron commence à prospecter." compact />
              ) : (
                <ul className="list">
                  {activeCampaigns.map((c) => (
                    <li key={c.id} className="list-item">
                      <div>
                        <strong>{c.zone_label}</strong>
                        <span className="muted"> — {c.sector_keywords?.join(', ')}</span>
                      </div>
                      <span className="pill">{c.contacts_found}/{c.target_count} contacts</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

{selectedAppointment && (
        <ActionCardModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onDone={() => {
            setSelectedAppointment(null);
            loadAll();
          }}
        />
      )}

      {selectedRescue && (
        <RescueModal
          prospect={selectedRescue}
          onClose={() => setSelectedRescue(null)}
          onDone={() => {
            setSelectedRescue(null);
            loadAll();
          }}
        />
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
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
          max-width: 26ch;
          line-height: 1.2;
        }
        .actions-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          margin-bottom: 1.5rem;
          overflow: hidden;
        }
        .actions-toggle {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: none;
          border: none;
          color: var(--text);
          font-size: 0.92rem;
          font-weight: 600;
          padding: 1rem 1.3rem;
          cursor: pointer;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #f0914e;
          color: #1b0d02;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.1rem 0.5rem;
          margin-left: 0.5rem;
        }
        .chevron {
          color: var(--muted);
          font-size: 0.7rem;
        }
        .actions-list {
          border-top: 1px solid var(--border);
        }
        .empty-actions {
          padding: 1.2rem 1.3rem;
          color: var(--muted);
          font-size: 0.86rem;
          margin: 0;
        }
        .action-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.7rem;
          background: none;
          border: none;
          border-bottom: 1px solid var(--border);
          color: var(--text);
          padding: 0.9rem 1.3rem;
          font-size: 0.88rem;
          cursor: pointer;
          text-align: left;
        }
        .action-row:last-child {
          border-bottom: none;
        }
        .action-row:hover {
          background: rgba(75, 57, 239, 0.08);
        }
        .action-label {
          flex: 1;
        }
        .action-arrow {
          color: var(--muted);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .stat-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0.75rem;
          margin-bottom: 2rem;
        }
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.6rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .grid-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.4rem;
        }
        .panel h2 {
          font-size: 1rem;
          margin: 0 0 1rem;
          font-family: var(--font-display);
        }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .list-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.9rem;
        }
        .list-item:last-child {
          border-bottom: none;
        }
        .pill {
          font-family: var(--font-mono);
          font-size: 0.76rem;
          color: var(--muted);
          white-space: nowrap;
        }
        .muted {
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .stat-row {
            grid-template-columns: repeat(2, 1fr);
          }
          .grid-two {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 480px) {
          .stat-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function ActionCardModal({ appointment, onClose, onDone }) {
  const [view, setView] = useState('main'); // 'main' | 'historique' | 'fiche'
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch(`/api/prospects/${appointment.prospect_id}`)
      .then((r) => r.json())
      .then((res) => {
        setDetail(res);
        setLoading(false);
      });
  }, [appointment.prospect_id]);

  async function handleAction(action) {
    setActing(true);
    await fetch(`/api/appointments/${appointment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActing(false);
    onDone();
  }

  const prospect = detail?.prospect;
  const meta = prospect ? (STATUS_META[prospect.status] || STATUS_META.jaune) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>

        {loading ? (
          <p className="muted center">Chargement…</p>
        ) : (
          <>
            <div className="prospect-center">
              <div className="avatar">{prospect?.full_name?.[0] || '?'}</div>
              <h2>{prospect?.full_name}</h2>
              <p className="company muted">{prospect?.prospect_companies?.name || 'société inconnue'}</p>
              {meta && (
                <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                  {meta.label}
                </span>
              )}
            </div>

            {view === 'main' && (
              <div className="rdv-info">
                {appointment.actionType === 'annule' && (
                  <p className="cancel-label">RDV annulé par le client</p>
                )}
                <p><strong>{TYPE_LABELS[appointment.type]}</strong></p>
                <p className="muted">{new Date(appointment.proposed_at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</p>
              </div>
            )}

            {view === 'historique' && (
              <div className="scroll-section">
                {(detail.messages || []).length === 0 ? (
                  <p className="muted center">Aucun échange pour le moment.</p>
                ) : (
                  detail.messages.map((m, i) => (
                    <div key={i} className={`msg ${m.direction}`}>
                      <p>{m.body}</p>
                      <span className="msg-date">{new Date(m.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {view === 'fiche' && (
              <div className="scroll-section fiche">
                <div className="fiche-row">
                  <span className="fiche-label">Email</span>
                  <span>{prospect?.email}</span>
                </div>
                {prospect?.phone && (
                  <div className="fiche-row">
                    <span className="fiche-label">Téléphone</span>
                    <span>{prospect.phone}</span>
                  </div>
                )}
                <div className="fiche-row">
                  <span className="fiche-label">Personnalité</span>
                  <span>{prospect?.personality_type ? PERSONALITY_LABELS[prospect.personality_type] : 'Pas encore détectée'}</span>
                </div>
                {prospect?.personality_notes && (
                  <div className="fiche-row">
                    <span className="fiche-label">Notes</span>
                    <span>{prospect.personality_notes}</span>
                  </div>
                )}
                <div className="fiche-row">
                  <span className="fiche-label">Conseil d'Aaron</span>
                  <span>{prospect?.aaron_advice || '—'}</span>
                </div>
              </div>
            )}

            <div className="toggle-row">
              <button className={view === 'historique' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setView(view === 'historique' ? 'main' : 'historique')}>
                Historique des échanges
              </button>
              <button className={view === 'fiche' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setView(view === 'fiche' ? 'main' : 'fiche')}>
                Fiche client
              </button>
            </div>

            <div className="actions-row">
              {appointment.actionType === 'annule' ? (
                <>
                  <button className="btn-valid" disabled={acting} onClick={() => handleAction('relancer')}>Relancer le prospect</button>
                  <button className="btn-neutral" disabled={acting} onClick={() => handleAction('traiter')}>Marquer comme traité</button>
                </>
              ) : (
                <>
                  <button className="btn-valid" disabled={acting} onClick={() => handleAction('valider')}>Valider</button>
                  <button className="btn-neutral" disabled={acting} onClick={() => handleAction('reporter')}>Reporter</button>
                  <button className="btn-danger" disabled={acting} onClick={() => handleAction('annuler')}>Annuler</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 2rem;
          width: 420px;
          max-width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          position: relative;
        }
        .close-btn {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .prospect-center {
          text-align: center;
          margin-bottom: 1.4rem;
        }
        .avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: white;
          font-family: var(--font-display);
          font-size: 1.4rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 0.8rem;
        }
        .prospect-center h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 0.2rem;
        }
        .company {
          font-size: 0.86rem;
          margin: 0 0 0.6rem;
        }
        .status-pill {
          display: inline-block;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.7rem;
          font-size: 0.76rem;
        }
        .rdv-info {
          text-align: center;
          background: var(--bg);
          border-radius: 12px;
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .rdv-info p {
          margin: 0.2rem 0;
        }
        .cancel-label {
          color: #e5484d;
          font-weight: 600;
          font-size: 0.82rem;
        }
        .scroll-section {
          max-height: 220px;
          overflow-y: auto;
          margin-bottom: 1.2rem;
          background: var(--bg);
          border-radius: 12px;
          padding: 1rem;
        }
        .msg {
          margin-bottom: 0.9rem;
          font-size: 0.84rem;
        }
        .msg p {
          margin: 0 0 0.2rem;
          white-space: pre-wrap;
        }
        .msg.inbound p {
          color: var(--text);
        }
        .msg.outbound p {
          color: var(--muted);
        }
        .msg-date {
          font-size: 0.7rem;
          color: var(--muted);
        }
        .fiche-row {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          margin-bottom: 0.8rem;
          font-size: 0.86rem;
        }
        .fiche-row:last-child {
          margin-bottom: 0;
        }
        .fiche-label {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted);
        }
        .toggle-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.2rem;
        }
        .toggle-btn {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.5rem;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .toggle-btn.active {
          border-color: var(--accent);
          color: var(--text);
        }
        .actions-row {
          display: flex;
          gap: 0.6rem;
        }
        .btn-valid, .btn-neutral, .btn-danger {
          flex: 1;
          border: none;
          border-radius: 10px;
          padding: 0.7rem;
          font-size: 0.86rem;
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
        .muted {
          color: var(--muted);
        }
        .center {
          text-align: center;
        }
      `}</style>
    </div>
  );
}

function RescueModal({ prospect, onClose, onDone }) {
  const [acting, setActing] = useState(false);

  async function handleAction(action) {
    setActing(true);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActing(false);
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>

        <div className="prospect-center">
          <div className="avatar">{prospect.full_name?.[0] || '?'}</div>
          <h2>{prospect.full_name}</h2>
          <p className="company muted">{prospect.prospect_companies?.name || 'société inconnue'}</p>
          <span className="status-pill" style={{ color: '#8B90A8', borderColor: '#8B90A8' }}>
            Sur le point d'être perdu
          </span>
        </div>

        <div className="scroll-section">
          <p className="rescue-subject"><strong>{prospect.rescue_proposal_subject}</strong></p>
          <p className="rescue-body">{prospect.rescue_proposal_body}</p>
        </div>

        <div className="actions-row">
          <button className="btn-valid" disabled={acting} onClick={() => handleAction('approuver_sauvetage')}>
            Envoyer cette tentative
          </button>
          <button className="btn-danger" disabled={acting} onClick={() => handleAction('rejeter_sauvetage')}>
            Abandonner ce prospect
          </button>
        </div>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 2rem;
          width: 420px;
          max-width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          position: relative;
        }
        .close-btn {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .prospect-center {
          text-align: center;
          margin-bottom: 1.4rem;
        }
        .avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: white;
          font-family: var(--font-display);
          font-size: 1.4rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 0.8rem;
        }
        .prospect-center h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 0.2rem;
        }
        .company {
          font-size: 0.86rem;
          margin: 0 0 0.6rem;
        }
        .status-pill {
          display: inline-block;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.7rem;
          font-size: 0.76rem;
        }
        .scroll-section {
          max-height: 260px;
          overflow-y: auto;
          margin-bottom: 1.2rem;
          background: var(--bg);
          border-radius: 12px;
          padding: 1rem;
        }
        .rescue-subject {
          margin: 0 0 0.6rem;
          font-size: 0.9rem;
        }
        .rescue-body {
          margin: 0;
          font-size: 0.86rem;
          white-space: pre-wrap;
          color: var(--muted);
        }
        .actions-row {
          display: flex;
          gap: 0.6rem;
        }
        .btn-valid, .btn-danger {
          flex: 1;
          border: none;
          border-radius: 10px;
          padding: 0.7rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid #e5484d;
          color: #e5484d;
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}

function AaronPulse({ active }) {
  return (
    <div className="pulse-wrap" title={active ? 'Aaron prospecte activement' : 'Aaron est en veille'}>
      <span className={`pulse-dot ${active ? 'is-active' : ''}`} />
      <span className="pulse-label">{active ? 'Aaron travaille' : 'En veille'}</span>
      <style jsx>{`
        .pulse-wrap {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.5rem 0.9rem;
        }
        .pulse-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--muted);
          position: relative;
        }
        .pulse-dot.is-active {
          background: var(--accent-green);
        }
        .pulse-dot.is-active::after {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 1px solid var(--accent-green);
          animation: ping 2s ease-out infinite;
        }
        .pulse-label {
          font-size: 0.8rem;
          color: var(--muted);
        }
        @keyframes ping {
          0% { transform: scale(0.6); opacity: 0.8; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pulse-dot.is-active::after { animation: none; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ title, body, compact }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: ${compact ? '1.5rem 1rem' : '4rem 1rem'};
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
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // Un module (Aaron Opportunité / Aaron Client) est grisé dans la navigation tant
  // que l'offre souscrite par la société (companies.offer, voir Préférences)
  // ne correspond pas à ce module. Aaron Prospect (Campagnes/Prospects) reste
  // toujours accessible : c'est l'offre de base incluse à la souscription.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offer = body.preferences?.offer || 'AP';
        setLockedModules({ sales: offer !== 'AS', customer: offer !== 'AC' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯' },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀' },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.preferences', locale), slug: 'preferences', icon: '⚙️' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
    { label: t('nav.suggestions', locale), slug: 'suggestions', icon: '💡' },
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
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel">🔒</span>}</li>
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
        .lang-switcher {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.4rem 0.5rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.2rem;
          cursor: pointer;
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
        .nav-list li.locked {
          opacity: 0.45;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
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
