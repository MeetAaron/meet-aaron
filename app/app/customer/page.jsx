// app/app/customer/page.jsx
// Aaron Customer — suivi des clients gagnés : onboarding (plan généré par
// Aaron + email de bienvenue), score de santé, historique des check-ins
// satisfaction/NPS. Voir lib/aaron-customer.ts, lib/customer-health.ts,
// app/api/customers/pipeline, app/api/customers/[id]/onboarding.

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

const ONBOARDING_ORDER = ['a_demarrer', 'en_cours', 'termine'];
const ONBOARDING_META = {
  a_demarrer: { label: 'À démarrer', color: '#F0914E' },
  en_cours: { label: 'En cours', color: '#F0C94E' },
  termine: { label: 'Terminé', color: '#3DD68C' },
};

const HEALTH_META = {
  saine: { label: 'Santé saine', color: '#3DD68C' },
  a_surveiller: { label: 'À surveiller', color: '#F0C94E' },
  a_risque: { label: 'À risque', color: '#E5484D' },
};

const CHECKIN_TYPE_LABELS = { nps: 'NPS', satisfaction: 'Satisfaction' };

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export default function CustomerPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [changingStatus, setChangingStatus] = useState(false);

  const [onboarding, setOnboarding] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);

  const [renewalDateInput, setRenewalDateInput] = useState('');
  const [renewalSaving, setRenewalSaving] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalError, setRenewalError] = useState(null);
  const [sendingRenewal, setSendingRenewal] = useState(false);

  const [testimonialLoading, setTestimonialLoading] = useState(false);
  const [testimonialError, setTestimonialError] = useState(null);
  const [sendingTestimonial, setSendingTestimonial] = useState(false);

  const [supportDrafts, setSupportDrafts] = useState([]);
  const [supportDraftsLoading, setSupportDraftsLoading] = useState(true);
  const [supportActionId, setSupportActionId] = useState(null);

  async function load() {
    const res = await fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json());
    setCustomers(res.customers || []);
    setLoading(false);
  }

  async function loadSupportDrafts() {
    setSupportDraftsLoading(true);
    const res = await fetch(`/api/support-drafts?user_id=${userId}`).then((r) => r.json());
    setSupportDrafts(res.drafts || []);
    setSupportDraftsLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();
    loadSupportDrafts();
  }, [userId]);

  useEffect(() => {
    setOnboarding(null);
    setOnboardingError(null);
    setRenewalError(null);
    setTestimonialError(null);
    const customer = customers.find((c) => c.id === selectedId);
    setRenewalDateInput(customer?.contract_renewal_date || '');
  }, [selectedId]);

  const selectedCustomer = customers.find((c) => c.id === selectedId) || null;

  async function handleStatusChange(customerId, status) {
    setChangingStatus(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_onboarding_status', onboarding_status: status }),
    });
    await load();
    setChangingStatus(false);
  }

  async function handleLoadOnboarding(customerId) {
    setOnboardingLoading(true);
    setOnboardingError(null);
    const res = await fetch(`/api/customers/${customerId}/onboarding`);
    const body = await res.json();
    setOnboardingLoading(false);
    if (!res.ok) {
      setOnboardingError(body.error || "Impossible de générer le plan d'onboarding.");
      return;
    }
    setOnboarding(body);
  }

  async function handleSendWelcome(customerId) {
    setSendingWelcome(true);
    const res = await fetch(`/api/customers/${customerId}/onboarding`, { method: 'POST' });
    const body = await res.json();
    setSendingWelcome(false);
    if (!res.ok) {
      setOnboardingError(body.error || "Impossible d'envoyer l'email.");
      return;
    }
    await load();
  }

  async function handleSetRenewalDate(customerId) {
    setRenewalSaving(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_renewal_date', contract_renewal_date: renewalDateInput || null }),
    });
    setRenewalSaving(false);
    await load();
  }

  async function handleGenerateRenewal(customerId, regenerate) {
    setRenewalLoading(true);
    setRenewalError(null);
    const res = await fetch(`/api/prospects/${customerId}/renewal${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setRenewalLoading(false);
    if (!res.ok) {
      setRenewalError(body.error || "Impossible de générer l'email de renouvellement.");
      return;
    }
    await load();
  }

  async function handleSendRenewal(customerId) {
    setSendingRenewal(true);
    setRenewalError(null);
    const res = await fetch(`/api/prospects/${customerId}/renewal`, { method: 'POST' });
    const body = await res.json();
    setSendingRenewal(false);
    if (!res.ok) {
      setRenewalError(body.error || "Impossible d'envoyer l'email.");
      return;
    }
    await load();
  }

  async function handleDismissUpsell(customerId) {
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss_upsell' }),
    });
    await load();
  }

  async function handleGenerateTestimonial(customerId, regenerate) {
    setTestimonialLoading(true);
    setTestimonialError(null);
    const res = await fetch(`/api/prospects/${customerId}/testimonial${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setTestimonialLoading(false);
    if (!res.ok) {
      setTestimonialError(body.error || 'Impossible de générer la demande.');
      return;
    }
    await load();
  }

  async function handleSendTestimonial(customerId) {
    setSendingTestimonial(true);
    setTestimonialError(null);
    const res = await fetch(`/api/prospects/${customerId}/testimonial`, { method: 'POST' });
    const body = await res.json();
    setSendingTestimonial(false);
    if (!res.ok) {
      setTestimonialError(body.error || "Impossible d'envoyer la demande.");
      return;
    }
    await load();
  }

  async function handleSupportDraftAction(draftId, action) {
    setSupportActionId(draftId);
    await fetch(`/api/support-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setSupportActionId(null);
    await loadSupportDrafts();
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
    <Shell active="Aaron Customer" userId={userId}>
      <header className="header">
        <p className="eyebrow">Après la signature</p>
        <h1>Aaron Customer</h1>
        <p className="subtitle">
          Dès qu'un client est gagné, Aaron prépare l'onboarding (plan + email de bienvenue), sollicite régulièrement
          son avis (check-ins satisfaction/NPS) et calcule un score de santé pour repérer tôt un risque de désabonnement.
        </p>
      </header>

      {!supportDraftsLoading && supportDrafts.length > 0 && (
        <section className="support-inbox">
          <h3>Suggestions de réponse support ({supportDrafts.length})</h3>
          <p className="muted">Aaron a repéré ces messages clients comme nécessitant une réponse — relis et valide avant envoi.</p>
          <div className="support-list">
            {supportDrafts.map((draft) => (
              <div className="support-card" key={draft.id}>
                <p className="support-from"><strong>{draft.prospect_full_name}</strong></p>
                {draft.inbound_excerpt && <p className="support-excerpt">« {draft.inbound_excerpt} »</p>}
                <div className="email-preview">
                  <p className="email-subject">{draft.suggested_subject}</p>
                  <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{draft.suggested_body}</p>
                </div>
                <div className="support-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => handleSupportDraftAction(draft.id, 'ecarter')}
                    disabled={supportActionId === draft.id}
                  >
                    Écarter
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => handleSupportDraftAction(draft.id, 'envoyer')}
                    disabled={supportActionId === draft.id}
                  >
                    {supportActionId === draft.id ? 'Envoi…' : 'Envoyer'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : customers.length === 0 ? (
        <p className="muted">
          Aucun client gagné pour le moment — dès qu'une affaire du pipeline Aaron Sales sera signée, elle apparaîtra ici.
        </p>
      ) : (
        <div className="board-layout">
          <div className="list">
            {customers.map((customer) => {
              const health = customer.customer_health_label ? HEALTH_META[customer.customer_health_label] : null;
              return (
                <button
                  key={customer.id}
                  type="button"
                  className={`customer-card ${selectedId === customer.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(customer.id)}
                >
                  <div className="customer-card-top">
                    <span className="customer-name">{customer.full_name}</span>
                    {health && (
                      <span className="health-badge" style={{ color: health.color, borderColor: health.color }}>
                        {health.label}
                      </span>
                    )}
                  </div>
                  {customer.prospect_companies?.name && <span className="customer-company">{customer.prospect_companies.name}</span>}
                  <span className="customer-meta">
                    Client depuis {daysSince(customer.won_at)} j
                    {customer.onboarding_status && (
                      <span className="onboarding-dot" style={{ background: ONBOARDING_META[customer.onboarding_status].color }}>
                        {ONBOARDING_META[customer.onboarding_status].label}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="detail">
            {!selectedCustomer ? (
              <p className="muted">Sélectionne un client pour voir son onboarding et son suivi.</p>
            ) : (
              <>
                <h2>{selectedCustomer.full_name}</h2>
                {selectedCustomer.prospect_companies?.name && (
                  <p className="muted">{selectedCustomer.prospect_companies.name}{selectedCustomer.job_title ? ` — ${selectedCustomer.job_title}` : ''}</p>
                )}

                {selectedCustomer.customer_health_label && (
                  <div className="health-row">
                    <span
                      className="health-badge large"
                      style={{ color: HEALTH_META[selectedCustomer.customer_health_label].color, borderColor: HEALTH_META[selectedCustomer.customer_health_label].color }}
                    >
                      {HEALTH_META[selectedCustomer.customer_health_label].label} — {selectedCustomer.customer_health_score}/100
                    </span>
                  </div>
                )}

                <div className="stage-row">
                  <label htmlFor="onboarding-select">Onboarding :</label>
                  <select
                    id="onboarding-select"
                    value={selectedCustomer.onboarding_status || 'a_demarrer'}
                    disabled={changingStatus}
                    onChange={(e) => handleStatusChange(selectedCustomer.id, e.target.value)}
                  >
                    {ONBOARDING_ORDER.map((s) => (
                      <option key={s} value={s}>{ONBOARDING_META[s].label}</option>
                    ))}
                  </select>
                </div>

                <section className="block">
                  <h3>Plan d'onboarding & email de bienvenue</h3>

                  {!onboarding && !selectedCustomer.onboarding_plan && (
                    <button className="btn-secondary" onClick={() => handleLoadOnboarding(selectedCustomer.id)} disabled={onboardingLoading}>
                      {onboardingLoading ? 'Génération…' : "Générer le plan d'onboarding"}
                    </button>
                  )}
                  {!onboarding && selectedCustomer.onboarding_plan && (
                    <button className="btn-secondary" onClick={() => handleLoadOnboarding(selectedCustomer.id)} disabled={onboardingLoading}>
                      {onboardingLoading ? 'Chargement…' : 'Voir le plan'}
                    </button>
                  )}
                  {onboardingError && <p className="error">{onboardingError}</p>}

                  {onboarding && (
                    <div className="brief-box">
                      <ul>
                        {onboarding.plan.map((step, i) => (
                          <li key={i}><strong>{step.titre}</strong> — {step.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {onboarding?.welcome_email && (
                    <div className="email-preview">
                      <p className="email-subject">{onboarding.welcome_email.subject}</p>
                      <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{onboarding.welcome_email.body}</p>
                      {selectedCustomer.welcome_email_sent_at ? (
                        <p className="sent-note">✓ Envoyé le {new Date(selectedCustomer.welcome_email_sent_at).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}</p>
                      ) : (
                        <button className="btn-primary" onClick={() => handleSendWelcome(selectedCustomer.id)} disabled={sendingWelcome}>
                          {sendingWelcome ? 'Envoi…' : "Envoyer l'email de bienvenue au client"}
                        </button>
                      )}
                    </div>
                  )}
                </section>

                <section className="block">
                  <h3>Dernier check-in</h3>
                  {!selectedCustomer.latest_checkin ? (
                    <p className="muted">Aucun check-in envoyé pour le moment — le premier part automatiquement ~3 semaines après la signature.</p>
                  ) : (
                    <div className="brief-box">
                      <p>
                        <strong>{CHECKIN_TYPE_LABELS[selectedCustomer.latest_checkin.type] || selectedCustomer.latest_checkin.type}</strong>
                        {' — envoyé le '}
                        {new Date(selectedCustomer.latest_checkin.sent_at).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                      </p>
                      {selectedCustomer.latest_checkin.responded_at ? (
                        <>
                          <p><strong>Note :</strong> {selectedCustomer.latest_checkin.response_score != null ? `${selectedCustomer.latest_checkin.response_score}/10` : 'non fournie'}</p>
                          {selectedCustomer.latest_checkin.response_comment && (
                            <p><strong>Commentaire :</strong> {selectedCustomer.latest_checkin.response_comment}</p>
                          )}
                        </>
                      ) : (
                        <p className="muted">En attente de réponse.</p>
                      )}
                    </div>
                  )}
                </section>

                {selectedCustomer.upsell_suggestion && !selectedCustomer.upsell_dismissed_at && (
                  <section className="block">
                    <h3>Piste d'upsell</h3>
                    <div className="brief-box">
                      <p>{selectedCustomer.upsell_suggestion}</p>
                    </div>
                    <button className="btn-secondary" onClick={() => handleDismissUpsell(selectedCustomer.id)}>
                      Écarter
                    </button>
                  </section>
                )}

                <section className="block">
                  <h3>Renouvellement</h3>
                  <div className="stage-row">
                    <label htmlFor="renewal-date">Date de renouvellement :</label>
                    <input
                      id="renewal-date"
                      type="date"
                      value={renewalDateInput || ''}
                      onChange={(e) => setRenewalDateInput(e.target.value)}
                      className="date-input"
                    />
                    <button className="btn-secondary" onClick={() => handleSetRenewalDate(selectedCustomer.id)} disabled={renewalSaving}>
                      {renewalSaving ? '…' : 'Enregistrer'}
                    </button>
                  </div>

                  {selectedCustomer.contract_renewal_date && (
                    <>
                      {selectedCustomer.renewal_email_sent_at ? (
                        <p className="sent-note">✓ Email de renouvellement envoyé</p>
                      ) : selectedCustomer.renewal_email_subject ? (
                        <div className="email-preview">
                          <p className="email-subject">{selectedCustomer.renewal_email_subject}</p>
                          <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{selectedCustomer.renewal_email_body}</p>
                          {renewalError && <p className="error">{renewalError}</p>}
                          <button className="btn-secondary" onClick={() => handleGenerateRenewal(selectedCustomer.id, true)} disabled={renewalLoading}>
                            {renewalLoading ? 'Régénération…' : 'Régénérer'}
                          </button>
                          <button className="btn-primary" onClick={() => handleSendRenewal(selectedCustomer.id)} disabled={sendingRenewal}>
                            {sendingRenewal ? 'Envoi…' : "Envoyer au client"}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button className="btn-secondary" onClick={() => handleGenerateRenewal(selectedCustomer.id, false)} disabled={renewalLoading}>
                            {renewalLoading ? 'Génération…' : "Générer l'email de relance"}
                          </button>
                          {renewalError && <p className="error">{renewalError}</p>}
                        </>
                      )}
                    </>
                  )}
                </section>

                <section className="block">
                  <h3>Demande de témoignage</h3>
                  {selectedCustomer.testimonial_email_sent_at ? (
                    <p className="sent-note">✓ Demande envoyée</p>
                  ) : selectedCustomer.testimonial_email_subject ? (
                    <div className="email-preview">
                      <p className="email-subject">{selectedCustomer.testimonial_email_subject}</p>
                      <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{selectedCustomer.testimonial_email_body}</p>
                      {testimonialError && <p className="error">{testimonialError}</p>}
                      <button className="btn-secondary" onClick={() => handleGenerateTestimonial(selectedCustomer.id, true)} disabled={testimonialLoading}>
                        {testimonialLoading ? 'Régénération…' : 'Régénérer'}
                      </button>
                      <button className="btn-primary" onClick={() => handleSendTestimonial(selectedCustomer.id)} disabled={sendingTestimonial}>
                        {sendingTestimonial ? 'Envoi…' : 'Envoyer au client'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="muted">Générée automatiquement quand un client répond très positivement à un check-in — ou génère-la ici manuellement.</p>
                      <button className="btn-secondary" onClick={() => handleGenerateTestimonial(selectedCustomer.id, false)} disabled={testimonialLoading}>
                        {testimonialLoading ? 'Génération…' : 'Générer la demande'}
                      </button>
                      {testimonialError && <p className="error">{testimonialError}</p>}
                    </>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.8rem;
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
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.88rem;
          max-width: 720px;
          margin: 0;
        }
        .muted {
          color: var(--muted);
        }
        .board-layout {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 1.5rem;
          align-items: start;
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .customer-card {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          text-align: left;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.8rem 1rem;
          cursor: pointer;
          color: var(--text);
          font-family: inherit;
        }
        .customer-card.selected {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.12);
        }
        .customer-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
        }
        .customer-name {
          font-size: 0.92rem;
          font-weight: 600;
        }
        .customer-company {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .customer-meta {
          font-size: 0.74rem;
          color: var(--muted);
          margin-top: 0.2rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .onboarding-dot {
          font-size: 0.68rem;
          padding: 0.1rem 0.45rem;
          border-radius: 999px;
          color: #0b0e1a;
          font-weight: 600;
        }
        .health-badge {
          font-size: 0.68rem;
          font-weight: 600;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.15rem 0.5rem;
          white-space: nowrap;
        }
        .health-badge.large {
          font-size: 0.8rem;
          padding: 0.3rem 0.7rem;
        }
        .health-row {
          margin: 0.8rem 0;
        }
        .detail {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.2rem;
          position: sticky;
          top: 1.5rem;
          max-height: calc(100vh - 3rem);
          overflow-y: auto;
        }
        .detail h2 {
          font-family: var(--font-display);
          font-size: 1.15rem;
          margin: 0 0 0.2rem;
        }
        .stage-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 1rem 0;
        }
        .stage-row label {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .stage-row select {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 8px;
          padding: 0.4rem 0.6rem;
          font-size: 0.84rem;
        }
        .block {
          margin-top: 1.4rem;
          padding-top: 1.2rem;
          border-top: 1px solid var(--border);
        }
        .block h3 {
          font-size: 0.9rem;
          margin: 0 0 0.6rem;
        }
        .btn-secondary, .btn-primary {
          border-radius: 10px;
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          border: 1px solid var(--border);
        }
        .btn-secondary {
          background: var(--bg);
          color: var(--text);
        }
        .btn-primary {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
          margin-top: 0.6rem;
        }
        .btn-secondary:disabled, .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          color: #e5484d;
          font-size: 0.8rem;
          margin-top: 0.5rem;
        }
        .brief-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.9rem;
          margin-top: 0.8rem;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .brief-box p {
          margin: 0 0 0.5rem;
        }
        .brief-box ul {
          margin: 0;
          padding-left: 1.1rem;
        }
        .brief-box li {
          margin-bottom: 0.4rem;
        }
        .email-preview {
          margin-top: 0.8rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.9rem;
        }
        .email-subject {
          font-weight: 600;
          font-size: 0.84rem;
          margin: 0 0 0.5rem;
        }
        .email-body {
          font-size: 0.82rem;
          color: var(--muted);
          margin: 0;
        }
        .sent-note {
          color: #3dd68c;
          font-size: 0.8rem;
          margin: 0.6rem 0 0;
        }
        .date-input {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 8px;
          padding: 0.4rem 0.6rem;
          font-size: 0.82rem;
          font-family: inherit;
        }
        .support-inbox {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.2rem 1.4rem;
          margin-bottom: 1.8rem;
        }
        .support-inbox h3 {
          font-size: 0.95rem;
          margin: 0 0 0.3rem;
        }
        .support-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.8rem;
          margin-top: 0.9rem;
        }
        .support-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.9rem;
        }
        .support-from {
          font-size: 0.84rem;
          margin: 0 0 0.4rem;
        }
        .support-excerpt {
          font-size: 0.78rem;
          color: var(--muted);
          font-style: italic;
          margin: 0 0 0.6rem;
        }
        .support-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.8rem;
        }
        @media (max-width: 1100px) {
          .board-layout {
            grid-template-columns: 1fr;
          }
          .detail {
            position: static;
            max-height: none;
          }
          .support-list {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard', icon: '📊' },
    { label: 'Prospects', slug: 'prospects', icon: '🎯' },
    { label: 'Campagnes', slug: 'campaigns', icon: '🚀' },
    { label: 'Agenda', slug: 'agenda', icon: '📅' },
    { label: 'Aaron Sales', slug: 'sales', icon: '🤝' },
    { label: 'Aaron Customer', slug: 'customer', icon: '🌟' },
    { label: 'Résultats', slug: 'resultats', icon: '📈' },
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
