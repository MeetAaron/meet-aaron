// app/app/agenda/page.jsx
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
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
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

const TYPE_ICONS = {
  telephonique: '📞',
  physique: '🤝',
  visio: '💻',
};

function typeLabelsFor(locale) {
  return {
    telephonique: t('apptType.telephonique', locale),
    physique: t('apptType.physique', locale),
    visio: t('apptType.visio', locale),
  };
}

const STATUS_COLORS = {
  'proposé': '#F0914E',
  'validé': '#3DD68C',
  'reporté': '#8B90A8',
  'annulé': '#E5484D',
  'terminé': '#4B9EF0',
};

function statusMetaFor(locale) {
  return {
    'proposé': { label: t('agenda.statusProposed', locale), color: STATUS_COLORS['proposé'] },
    'validé': { label: t('agenda.statusValidated', locale), color: STATUS_COLORS['validé'] },
    'reporté': { label: t('agenda.statusPostponed', locale), color: STATUS_COLORS['reporté'] },
    'annulé': { label: t('agenda.statusCancelled', locale), color: STATUS_COLORS['annulé'] },
    'terminé': { label: t('agenda.statusCompleted', locale), color: STATUS_COLORS['terminé'] },
  };
}

// CHANGEMENTS A FAIRE #86 : Disponibilités n'est plus une page séparée avec
// onglet — ses réglages (créneaux hebdo récurrents + indisponibilités
// ponctuelles) vivent maintenant dans deux sections dédiées tout en bas de
// cette page (voir plus bas dans le JSX). daysFor/apptTypesFor/dayLabel et
// monthLabelsFor/weekdayLabelsFor sont repris tels quels de l'ancienne page
// app/app/disponibilites/page.jsx (qui redirige maintenant ici, voir ce fichier).
function daysFor(locale) {
  return [
    { value: 1, label: t('disponibilites.dayMonday', locale) },
    { value: 2, label: t('disponibilites.dayTuesday', locale) },
    { value: 3, label: t('disponibilites.dayWednesday', locale) },
    { value: 4, label: t('disponibilites.dayThursday', locale) },
    { value: 5, label: t('disponibilites.dayFriday', locale) },
    { value: 6, label: t('disponibilites.daySaturday', locale) },
    { value: 0, label: t('disponibilites.daySunday', locale) },
  ];
}

function apptTypesFor(locale) {
  return [
    { value: '', label: t('disponibilites.allApptTypes', locale) },
    { value: 'visio', label: t('apptType.visio', locale) },
    { value: 'tel', label: t('apptType.telephonique', locale) },
    { value: 'physique', label: t('apptType.physique', locale) },
  ];
}

function dayLabel(value, locale) {
  return daysFor(locale).find((d) => d.value === value)?.label || '';
}

function monthLabelsFor(locale) {
  return [
    t('disponibilites.monthJanuary', locale),
    t('disponibilites.monthFebruary', locale),
    t('disponibilites.monthMarch', locale),
    t('disponibilites.monthApril', locale),
    t('disponibilites.monthMay', locale),
    t('disponibilites.monthJune', locale),
    t('disponibilites.monthJuly', locale),
    t('disponibilites.monthAugust', locale),
    t('disponibilites.monthSeptember', locale),
    t('disponibilites.monthOctober', locale),
    t('disponibilites.monthNovember', locale),
    t('disponibilites.monthDecember', locale),
  ];
}

function weekdayLabelsFor(locale) {
  return [
    t('disponibilites.weekdayInitialMon', locale),
    t('disponibilites.weekdayInitialTue', locale),
    t('disponibilites.weekdayInitialWed', locale),
    t('disponibilites.weekdayInitialThu', locale),
    t('disponibilites.weekdayInitialFri', locale),
    t('disponibilites.weekdayInitialSat', locale),
    t('disponibilites.weekdayInitialSun', locale),
  ];
}

export default function AgendaPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const TYPE_LABELS = typeLabelsFor(locale);
  const STATUS_META = statusMetaFor(locale);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState(null);
  const [conflict, setConflict] = useState(null); // { appointmentId, reasons }
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalPreset, setAddModalPreset] = useState(null); // { kind, date } quand ouvert depuis le calendrier
  const [detailAppointment, setDetailAppointment] = useState(null);

  // Disponibilités (fusionnées depuis l'ancienne page, voir #86) — règles
  // hebdomadaires récurrentes + indisponibilités ponctuelles.
  const [rules, setRules] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [newRule, setNewRule] = useState({ day_of_week: 1, start_time: '09:00', end_time: '18:00', appointment_type: '' });
  const [savingRule, setSavingRule] = useState(false);
  const [newBlock, setNewBlock] = useState({ start_at: '', end_at: '', reason: '' });
  const [savingBlock, setSavingBlock] = useState(false);
  const [availError, setAvailError] = useState(null);

  // Calendrier mensuel (#87) — vue type iPhone au-dessus des listes : jours
  // avec RDV en vert, jours avec indisponibilité en rouge, clic = détail du jour.
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json());
    setAppointments(res.appointments || []);
    setLoading(false);
  }

  function loadAvailability() {
    if (!userId) return;
    setAvailabilityLoading(true);
    fetch(`/api/availability?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        setRules(body.rules || []);
        setBlocks(body.blocks || []);
        setAvailabilityLoading(false);
      });
  }

  useEffect(() => {
    if (!userId) return;
    load();
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleAddRule(e) {
    e.preventDefault();
    setSavingRule(true);
    setAvailError(null);
    const res = await fetch('/api/availability/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...newRule }),
    });
    const body = await res.json();
    setSavingRule(false);
    if (!res.ok) {
      setAvailError(body.error);
      return;
    }
    setRules((prev) => [...prev, body.rule].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)));
  }

  async function handleDeleteRule(id) {
    await fetch(`/api/availability/rules/${id}?user_id=${userId}`, { method: 'DELETE' });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleAddBlock(e) {
    e.preventDefault();
    if (!newBlock.start_at || !newBlock.end_at) return;
    setSavingBlock(true);
    setAvailError(null);
    const res = await fetch('/api/availability/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        start_at: new Date(newBlock.start_at).toISOString(),
        end_at: new Date(newBlock.end_at).toISOString(),
        reason: newBlock.reason,
      }),
    });
    const body = await res.json();
    setSavingBlock(false);
    if (!res.ok) {
      setAvailError(body.error);
      return;
    }
    setBlocks((prev) => [...prev, body.block].sort((a, b) => a.start_at.localeCompare(b.start_at)));
    setNewBlock({ start_at: '', end_at: '', reason: '' });
  }

  async function handleDeleteBlock(id) {
    await fetch(`/api/availability/blocks/${id}?user_id=${userId}`, { method: 'DELETE' });
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function openAddForDay(kind) {
    setAddModalPreset({ kind, date: selectedDay });
    setShowAddModal(true);
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
            background: var(--bg);
            color: var(--muted);
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
            background: var(--bg);
            color: var(--accent-red);
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

  const selectedDayAppointments = selectedDay
    ? appointments.filter((a) => new Date(a.proposed_at).toDateString() === selectedDay.toDateString() && a.status !== 'annulé')
    : [];
  const selectedDayBlocks = selectedDay
    ? blocks.filter((b) => {
        const start = new Date(b.start_at);
        const end = new Date(b.end_at);
        const dayStart = new Date(selectedDay);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDay);
        dayEnd.setHours(23, 59, 59, 999);
        return start <= dayEnd && end >= dayStart;
      })
    : [];

  return (
    <Shell active={t('nav.agenda', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('agenda.eyebrow', locale)}</p>
          <h1>{t('agenda.title', locale)}</h1>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setAddModalPreset(null);
            setShowAddModal(true);
          }}
        >
          + {t('common.add', locale)}
        </button>
      </header>

      {showAddModal && (
        <AddEntryModal
          userId={userId}
          preset={addModalPreset}
          onClose={() => {
            setShowAddModal(false);
            setAddModalPreset(null);
          }}
          onCreated={() => {
            setShowAddModal(false);
            setAddModalPreset(null);
            load();
            loadAvailability();
          }}
        />
      )}

      {detailAppointment && (
        <AppointmentDetailModal
          appointment={detailAppointment}
          onClose={() => setDetailAppointment(null)}
        />
      )}

      {conflict && (
        <div className="conflict-overlay" onClick={() => setConflict(null)}>
          <div className="conflict-box" onClick={(e) => e.stopPropagation()}>
            <p className="conflict-title">{t('agenda.conflictTitle', locale)}</p>
            <ul className="conflict-reasons">
              {conflict.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="conflict-hint">{t('agenda.conflictHint', locale)}</p>
            <div className="conflict-actions">
              <button className="btn-neutral" onClick={() => setConflict(null)}>{t('common.cancel', locale)}</button>
              <button
                className="btn-valid"
                onClick={() => handleAction(conflict.appointmentId, conflict.action, true)}
              >
                {t('agenda.conflictConfirmAnyway', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="block calendar-block">
        <h2>{t('agenda.calendarTitle', locale)}</h2>
        <MonthCalendar
          month={calendarMonth}
          onChangeMonth={setCalendarMonth}
          appointments={appointments}
          blocks={blocks}
          selectedDay={selectedDay}
          onSelectDay={(day) => setSelectedDay((prev) => (prev && prev.toDateString() === day.toDateString() ? null : day))}
        />

        {selectedDay && (
          <div className="day-detail">
            <div className="day-detail-header">
              <strong>{selectedDay.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
              <button type="button" className="btn-remove" onClick={() => setSelectedDay(null)} aria-label={t('agenda.dayDetailClose', locale)}>✕</button>
            </div>

            {selectedDayAppointments.length === 0 ? (
              <p className="muted small">{t('agenda.dayDetailNoAppointments', locale)}</p>
            ) : (
              <ul className="day-detail-list">
                {selectedDayAppointments.map((a) => (
                  <li key={a.id} className="day-detail-item">
                    <span className={`type-badge type-${a.type}`}>{TYPE_ICONS[a.type] || ''} {TYPE_LABELS[a.type]}</span>
                    <span>{new Date(a.proposed_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="muted">{a.prospects?.full_name || a.contact_name}</span>
                  </li>
                ))}
              </ul>
            )}

            {selectedDayBlocks.length === 0 ? (
              <p className="muted small">{t('agenda.dayDetailNoBlocks', locale)}</p>
            ) : (
              <ul className="day-detail-list">
                {selectedDayBlocks.map((b) => (
                  <li key={b.id} className="day-detail-item">
                    <span className="block-dot" />
                    <span>
                      {new Date(b.start_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                      {' → '}
                      {new Date(b.end_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    {b.reason && <span className="muted">{b.reason}</span>}
                  </li>
                ))}
              </ul>
            )}

            <div className="day-detail-actions">
              <button type="button" className="btn-secondary" onClick={() => openAddForDay(null)}>
                {t('agenda.dayDetailAddAppt', locale)}
              </button>
              <button type="button" className="btn-secondary" onClick={() => openAddForDay('indisponibilite')}>
                {t('agenda.dayDetailAddBlock', locale)}
              </button>
            </div>
          </div>
        )}

        <div className="calendar-legend">
          <span className="legend-item"><span className="legend-dot appt" /> {t('agenda.calendarLegendAppt', locale)}</span>
          <span className="legend-item"><span className="legend-dot blocked" /> {t('agenda.calendarLegendBlocked', locale)}</span>
        </div>
      </section>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : appointments.length === 0 ? (
        <EmptyState title={t('agenda.emptyTitle', locale)} body={t('agenda.emptyBody', locale)} />
      ) : (
        <>
          {pending.length > 0 && (
            <section className="block">
              <h2>{t('agenda.statusProposed', locale)} ({pending.length})</h2>
              <div className="list">
                {pending.map((a) => (
                  <div className="row" key={a.id}>
                    <div
                      className={a.prospect_id ? 'row-info clickable' : 'row-info'}
                      onClick={a.prospect_id ? () => setDetailAppointment(a) : undefined}
                    >
                      <strong>{a.prospects?.full_name}</strong>
                      <span className="muted"> — {a.prospects?.prospect_companies?.name || t('agenda.unknownCompany', locale)}</span>
                      <div className="meta">
                        <span className={`type-badge type-${a.type}`}>{TYPE_ICONS[a.type] || ''} {TYPE_LABELS[a.type]}</span>
                        {' · '}{new Date(a.proposed_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        className="btn-valid"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'valider')}
                      >
                        {t('agenda.actionValidate', locale)}
                      </button>
                      <button
                        className="btn-neutral"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'reporter')}
                      >
                        {t('agenda.actionPostpone', locale)}
                      </button>
                      <button
                        className="btn-danger"
                        disabled={actingOn === a.id}
                        onClick={() => handleAction(a.id, 'annuler')}
                      >
                        {t('common.cancel', locale)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="block">
            <h2>{t('agenda.sectionAll', locale)}</h2>
            <div className="list">
              {rest.map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META['proposé'];
                return (
                  <div className="row" key={a.id}>
                    <div
                      className={a.prospect_id ? 'row-info clickable' : 'row-info'}
                      onClick={a.prospect_id ? () => setDetailAppointment(a) : undefined}
                    >
                      <strong>{a.prospects?.full_name || a.contact_name}</strong>
                      {a.prospects ? (
                        <span className="muted"> — {a.prospects?.prospect_companies?.name || t('agenda.unknownCompany', locale)}</span>
                      ) : (
                        <span className="muted"> — {t('agenda.personalContact', locale)}</span>
                      )}
                      <div className="meta">
                        <span className={`type-badge type-${a.type}`}>{TYPE_ICONS[a.type] || ''} {TYPE_LABELS[a.type]}</span>
                        {' · '}{new Date(a.proposed_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                        {a.source === 'manuel' && ` · ${t('agenda.addedManually', locale)}`}
                      </div>
                      {a.meet_link && (
                        <a href={a.meet_link} target="_blank" rel="noreferrer" className="meet-link">
                          {t('agenda.meetLink', locale)}
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

      {/* Disponibilités fusionnées ici (#86) — deux sections sous les RDV, plus d'onglet séparé. */}
      <section className="block">
        <h2>{t('disponibilites.recurringSlotsTitle', locale)}</h2>
        {availabilityLoading ? (
          <p className="muted">{t('common.loading', locale)}</p>
        ) : (
          <div className="panel">
            {rules.length === 0 ? (
              <p className="muted small">{t('disponibilites.noRulesYet', locale)}</p>
            ) : (
              <ul className="rule-list">
                {rules.map((r) => (
                  <li key={r.id} className="rule-item">
                    <span className="rule-day">{dayLabel(r.day_of_week, locale)}</span>
                    <span className="rule-time">{r.start_time.slice(0, 5)} – {r.end_time.slice(0, 5)}</span>
                    <span className="rule-type">{apptTypesFor(locale).find((opt) => opt.value === (r.appointment_type || ''))?.label || t('disponibilites.allApptTypes', locale)}</span>
                    <button type="button" className="btn-remove" onClick={() => handleDeleteRule(r.id)} aria-label={t('common.delete', locale)}>✕</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="rule-form" onSubmit={handleAddRule}>
              <select value={newRule.day_of_week} onChange={(e) => setNewRule({ ...newRule, day_of_week: Number(e.target.value) })}>
                {daysFor(locale).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <input type="time" value={newRule.start_time} onChange={(e) => setNewRule({ ...newRule, start_time: e.target.value })} required />
              <span className="sep">{t('disponibilites.timeRangeSep', locale)}</span>
              <input type="time" value={newRule.end_time} onChange={(e) => setNewRule({ ...newRule, end_time: e.target.value })} required />
              <select value={newRule.appointment_type} onChange={(e) => setNewRule({ ...newRule, appointment_type: e.target.value })}>
                {apptTypesFor(locale).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <button type="submit" className="btn-primary" disabled={savingRule}>{savingRule ? t('disponibilites.adding', locale) : t('common.add', locale)}</button>
            </form>
          </div>
        )}
      </section>

      <section className="block">
        <h2>{t('disponibilites.oneOffUnavailabilityTitle', locale)}</h2>
        {availabilityLoading ? (
          <p className="muted">{t('common.loading', locale)}</p>
        ) : (
          <div className="panel">
            {blocks.length === 0 ? (
              <p className="muted small">{t('disponibilites.noBlocksUpcoming', locale)}</p>
            ) : (
              <ul className="block-list">
                {blocks.map((b) => (
                  <li key={b.id} className="block-item">
                    <span className="block-dates">
                      {new Date(b.start_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                      {' → '}
                      {new Date(b.end_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {b.reason && <span className="block-reason">{b.reason}</span>}
                    <button type="button" className="btn-remove" onClick={() => handleDeleteBlock(b.id)} aria-label={t('common.delete', locale)}>✕</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="block-form" onSubmit={handleAddBlock}>
              <input type="datetime-local" value={newBlock.start_at} onChange={(e) => setNewBlock({ ...newBlock, start_at: e.target.value })} required />
              <span className="sep">{t('disponibilites.timeRangeSep', locale)}</span>
              <input type="datetime-local" value={newBlock.end_at} onChange={(e) => setNewBlock({ ...newBlock, end_at: e.target.value })} required />
              <input type="text" placeholder={t('disponibilites.reasonPlaceholder', locale)} value={newBlock.reason} onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })} />
              <button type="submit" className="btn-primary" disabled={savingBlock}>{savingBlock ? t('disponibilites.adding', locale) : t('disponibilites.blockSlotButton', locale)}</button>
            </form>

            {availError && <p className="error">{availError}</p>}
          </div>
        )}
      </section>

      <style jsx>{`
        .header {
          margin-bottom: 1.2rem;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-md);
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
          border-radius: var(--radius-lg);
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
        .row-info.clickable {
          cursor: pointer;
          border-radius: var(--radius-sm);
          margin: -0.3rem;
          padding: 0.3rem;
          transition: background var(--fast);
        }
        .row-info.clickable:hover {
          background: rgba(75, 57, 239, 0.1);
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
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .type-badge.type-telephonique {
          border-color: var(--accent-amber);
          color: var(--accent-amber);
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
        .small {
          font-size: 0.84rem;
        }
        .row-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        .btn-valid, .btn-neutral, .btn-danger {
          border: none;
          border-radius: var(--radius-sm);
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
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
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
          border: 1px solid var(--accent-red);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          max-width: 420px;
          width: 100%;
        }
        .conflict-title {
          font-weight: 600;
          margin: 0 0 0.8rem;
          color: var(--accent-red);
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

        /* Calendrier mensuel (#87) */
        .calendar-block {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
        }
        .calendar-legend {
          display: flex;
          gap: 1.2rem;
          margin-top: 1rem;
          padding-top: 0.9rem;
          border-top: 1px solid var(--border);
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.78rem;
          color: var(--muted);
        }
        .legend-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          display: inline-block;
        }
        .legend-dot.appt {
          background: var(--accent-green);
        }
        .legend-dot.blocked {
          background: var(--accent-red);
        }
        .day-detail {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1rem 1.1rem;
          margin-top: 1rem;
        }
        .day-detail-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.7rem;
          font-size: 0.9rem;
          text-transform: capitalize;
        }
        .day-detail-list {
          list-style: none;
          margin: 0 0 0.6rem;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .day-detail-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 0.82rem;
        }
        .block-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-red);
          flex-shrink: 0;
        }
        .day-detail-actions {
          display: flex;
          gap: 0.6rem;
          margin-top: 0.8rem;
        }

        /* Disponibilités fusionnées (#86) */
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          max-width: 720px;
        }
        .rule-list, .block-list {
          list-style: none;
          margin: 0 0 1.2rem;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .rule-item, .block-item {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.9rem;
          font-size: 0.85rem;
        }
        .rule-day {
          font-weight: 600;
          min-width: 80px;
        }
        .rule-time {
          font-family: var(--font-mono);
          color: var(--accent-green);
        }
        .rule-type {
          color: var(--muted);
          margin-left: auto;
        }
        .block-dates {
          font-family: var(--font-mono);
          font-size: 0.8rem;
        }
        .block-reason {
          color: var(--muted);
          margin-left: 0.4rem;
        }
        .btn-remove {
          margin-left: auto;
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0.2rem 0.4rem;
        }
        .btn-remove:hover {
          color: var(--accent-red);
        }
        .rule-form, .block-form {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
        }
        .rule-form select, .rule-form input, .block-form input {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.7rem;
          color: var(--text);
          font-size: 0.84rem;
        }
        .block-form input[type='text'] {
          flex: 1;
          min-width: 180px;
        }
        .sep {
          color: var(--muted);
          font-size: 0.8rem;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.85rem;
          margin-top: 0.6rem;
        }
        .btn-secondary {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
      `}</style>
    </Shell>
  );
}

// Panneau ouvert au clic sur un RDV lié à un prospect suivi par Aaron :
// regroupe l'avis d'Aaron (profil DISC détecté, angle d'approche, objections
// déjà soulevées — voir lib/aaron-sales.ts -> generateAppointmentBrief) et
// l'historique brut des échanges (GET /api/prospects/[id]), pour que le
// commercial ait tout sous la main avant/après le RDV sans repasser par
// Aaron Sales ou Prospects.
function AppointmentDetailModal({ appointment, onClose }) {
  const [locale] = useLocale();
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefError, setBriefError] = useState(null);

  async function loadBrief(regenerate) {
    setBriefLoading(true);
    setBriefError(null);
    const res = await fetch(`/api/appointments/${appointment.id}/brief${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setBriefLoading(false);
    if (!res.ok) {
      setBriefError(body.error || t('agenda.briefErrorFallback', locale));
      return;
    }
    setBrief(body.brief);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/prospects/${appointment.prospect_id}`);
      const body = await res.json();
      if (!cancelled) {
        setMessages(body.messages || []);
        setMessagesLoading(false);
      }
    })();

    loadBrief(false);

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment.id, appointment.prospect_id]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{appointment.prospects?.full_name}</h2>
            {appointment.prospects?.prospect_companies?.name && (
              <p className="hint">{appointment.prospects.prospect_companies.name}</p>
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.close', locale)}</button>
        </div>

        <section className="detail-block">
          <h3>{t('agenda.aaronAdviceTitle', locale)}</h3>
          {briefLoading ? (
            <p className="muted">{t('agenda.briefGenerating', locale)}</p>
          ) : briefError ? (
            <p className="error">{briefError}</p>
          ) : brief ? (
            <div className="brief-box">
              <p><strong>{t('agenda.briefSummaryLabel', locale)}</strong> {brief.resume_historique}</p>
              {brief.profil_personnalite && <p><strong>{t('agenda.briefPersonalityLabel', locale)}</strong> {brief.profil_personnalite}</p>}
              {brief.objections_deja_soulevees?.length > 0 && (
                <p><strong>{t('agenda.briefObjectionsLabel', locale)}</strong> {brief.objections_deja_soulevees.join(' · ')}</p>
              )}
              {brief.info_entreprise && <p><strong>{t('agenda.briefCompanyLabel', locale)}</strong> {brief.info_entreprise}</p>}
              <p><strong>{t('agenda.briefApproachLabel', locale)}</strong> {brief.angle_approche_suggere}</p>
              {brief.points_attention?.length > 0 && (
                <ul>
                  {brief.points_attention.map((point, i) => <li key={i}>{point}</li>)}
                </ul>
              )}
              <button type="button" className="btn-secondary regen-btn" onClick={() => loadBrief(true)}>
                {t('agenda.regenerateBrief', locale)}
              </button>
            </div>
          ) : null}
        </section>

        <section className="detail-block">
          <h3>{t('agenda.historyTitle', locale)}</h3>
          {messagesLoading ? (
            <p className="muted">{t('common.loading', locale)}</p>
          ) : messages.length === 0 ? (
            <p className="muted">{t('agenda.noMessages', locale)}</p>
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <div className={`msg msg-${m.direction}`} key={i}>
                  <p className="msg-meta">
                    {m.direction === 'outbound' ? (
                      <span className="ai-badge" title={t('agenda.aiGeneratedTitle', locale)}>{t('agenda.aiGeneratedBadge', locale)}</span>
                    ) : (
                      t('agenda.prospectReply', locale)
                    )}
                    {' — '}
                    {new Date(m.sent_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  <p className="msg-body">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 600px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0;
        }
        .hint {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0.2rem 0 0;
        }
        .btn-secondary {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.8rem;
          font-size: 0.8rem;
          cursor: pointer;
          flex-shrink: 0;
        }
        .muted {
          color: var(--muted);
        }
        .error {
          color: var(--accent-red);
          font-size: 0.84rem;
        }
        .detail-block {
          margin-top: 1.3rem;
          padding-top: 1.1rem;
          border-top: 1px solid var(--border);
        }
        .detail-block h3 {
          font-size: 0.9rem;
          margin: 0 0 0.6rem;
        }
        .brief-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .brief-box p {
          margin: 0 0 0.5rem;
        }
        .brief-box ul {
          margin: 0.4rem 0 0.6rem;
          padding-left: 1.1rem;
        }
        .regen-btn {
          margin-top: 0.3rem;
        }
        .thread {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          max-height: 320px;
          overflow-y: auto;
        }
        .msg {
          border-radius: var(--radius-md);
          padding: 0.7rem 0.9rem;
          font-size: 0.82rem;
          border: 1px solid var(--border);
        }
        .msg-outbound {
          background: rgba(75, 57, 239, 0.1);
          margin-left: 1.5rem;
        }
        .msg-inbound {
          background: var(--bg);
          margin-right: 1.5rem;
        }
        .msg-meta {
          color: var(--muted);
          font-size: 0.72rem;
          margin: 0 0 0.35rem;
        }
        .ai-badge {
          display: inline-block;
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          font-size: 0.7rem;
          font-weight: 600;
        }
        .msg-body {
          margin: 0;
          white-space: pre-line;
          overflow-wrap: break-word;
        }
      `}</style>
    </div>
  );
}

function entryKindsFor(locale) {
  return [
    { key: 'indisponibilite', label: t('agenda.kindUnavailability', locale), icon: '🚫' },
    { key: 'telephonique', label: t('agenda.kindPhone', locale), icon: '📞' },
    { key: 'visio', label: t('agenda.kindVideo', locale), icon: '💻' },
    { key: 'physique', label: t('agenda.kindInPerson', locale), icon: '🤝' },
  ];
}

// Formate une Date en 'YYYY-MM-DD' pour préremplir un <input type="date">.
function toDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// CHANGEMENTS A FAIRE #87 : "ajout d'évènement avec recherche prospect/
// opportunité/client" — le tunnel Aaron Prospect ne couvre que les prospects
// et opportunités en cours (voir GET /api/prospects, qui exclut les clients
// avec 1ère commande confirmée) ; les vrais clients viennent de
// GET /api/customers/pipeline. On fusionne les deux listes ici avec une
// étiquette par type, plus un filtre texte, pour que le commercial puisse
// planifier un RDV avec n'importe lequel des trois sans changer de page.
function AddEntryModal({ userId, onClose, onCreated, preset }) {
  const [locale] = useLocale();
  const ENTRY_KINDS = entryKindsFor(locale);
  const [kind, setKind] = useState(preset?.kind || null);
  const [prospectSource, setProspectSource] = useState('aaron'); // 'aaron' | 'perso'
  const [contacts, setContacts] = useState([]); // prospects + opportunités + clients fusionnés
  const [contactFilter, setContactFilter] = useState('');
  const [prospectId, setProspectId] = useState('');
  const [contactName, setContactName] = useState('');
  const presetDate = preset?.date ? toDateInputValue(preset.date) : '';
  const [date, setDate] = useState(presetDate);
  const [time, setTime] = useState('');
  const [endDate, setEndDate] = useState(presetDate);
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (kind && kind !== 'indisponibilite' && prospectSource === 'aaron' && contacts.length === 0) {
      Promise.all([
        fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
        fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json()),
      ]).then(([prospectsRes, customersRes]) => {
        const opportunitiesAndProspects = (prospectsRes.prospects || []).map((p) => ({
          ...p,
          kind: p.deal_stage ? 'opportunity' : 'prospect',
        }));
        const clients = (customersRes.customers || []).map((c) => ({ ...c, kind: 'client' }));
        setContacts(
          [...opportunitiesAndProspects, ...clients].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
        );
      });
    }
  }, [kind, prospectSource, userId, contacts.length]);

  const CONTACT_TAG_LABELS = { prospect: t('agenda.tagProspect', locale), opportunity: t('agenda.tagOpportunity', locale), client: t('agenda.tagClient', locale) };
  const filteredContacts = contactFilter.trim()
    ? contacts.filter((c) => {
        const q = contactFilter.trim().toLowerCase();
        return c.full_name?.toLowerCase().includes(q) || c.prospect_companies?.name?.toLowerCase().includes(q);
      })
    : contacts;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (kind === 'indisponibilite') {
      if (!date || !time || !endDate || !endTime) {
        setError(t('agenda.errUnavailabilityRange', locale));
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
        setError(body.error || t('agenda.errCreateGeneric', locale));
        return;
      }
      onCreated();
      return;
    }

    if (!date || !time) {
      setError(t('agenda.errApptDateTime', locale));
      return;
    }
    if (prospectSource === 'aaron' && !prospectId) {
      setError(t('agenda.errChooseProspect', locale));
      return;
    }
    if (prospectSource === 'perso' && !contactName.trim()) {
      setError(t('agenda.errContactName', locale));
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
      setError(body.error || t('agenda.errCreateGeneric', locale));
      return;
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t('agenda.addModalTitle', locale)}</h2>

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
                  {t('agenda.sourceAaron', locale)}
                </button>
                <button
                  type="button"
                  className={prospectSource === 'perso' ? 'chip active' : 'chip'}
                  onClick={() => setProspectSource('perso')}
                >
                  {t('agenda.sourcePerso', locale)}
                </button>
              </div>
            )}

            {kind !== 'indisponibilite' && prospectSource === 'aaron' && (
              <>
                <label>
                  {t('agenda.searchContactPlaceholder', locale)}
                  <input
                    type="text"
                    value={contactFilter}
                    onChange={(e) => setContactFilter(e.target.value)}
                    placeholder={t('agenda.searchContactPlaceholder', locale)}
                  />
                </label>
                <label>
                  {t('agenda.prospectLabel', locale)}
                  <select value={prospectId} onChange={(e) => setProspectId(e.target.value)} required>
                    <option value="">{t('agenda.selectPlaceholder', locale)}</option>
                    {filteredContacts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}{p.prospect_companies?.name ? ` — ${p.prospect_companies.name}` : ''} · {CONTACT_TAG_LABELS[p.kind]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {kind !== 'indisponibilite' && prospectSource === 'perso' && (
              <label>
                {t('agenda.contactNameLabel', locale)}
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t('agenda.contactNamePlaceholder', locale)} required />
              </label>
            )}

            <div className="date-row">
              <label>
                {kind === 'indisponibilite' ? t('agenda.startLabel', locale) : t('agenda.dateLabel', locale)}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label>
                {t('agenda.timeLabel', locale)}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </label>
            </div>

            {kind === 'indisponibilite' && (
              <div className="date-row">
                <label>
                  {t('agenda.endLabel', locale)}
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
                </label>
                <label>
                  {t('agenda.timeLabel', locale)}
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                </label>
              </div>
            )}

            {kind === 'indisponibilite' && (
              <label>
                {t('agenda.reasonLabel', locale)}
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('agenda.reasonPlaceholder', locale)} />
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => setKind(null)}>{t('common.back', locale)}</button>
              <button type="submit" className="btn-valid" disabled={submitting}>
                {submitting ? t('agenda.saving', locale) : t('common.add', locale)}
              </button>
            </div>
          </>
        )}

        {!kind && (
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', locale)}</button>
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
          z-index: 100;
          padding: 1rem;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
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
          border-radius: var(--radius-md);
          padding: 1rem 0.6rem;
          color: var(--text);
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .kind-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
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
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.7rem;
          color: var(--text);
          font-size: 0.88rem;
          font-family: inherit;
        }
        .error {
          color: var(--accent-red);
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
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
          border: none;
          border-radius: var(--radius-sm);
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
          border-radius: var(--radius-lg);
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

// CHANGEMENTS A FAIRE #87 : calendrier mensuel type iPhone — jours avec RDV
// en vert, jours avec indisponibilité en rouge, clic = détail du jour
// (voir day-detail dans AgendaPage). Remplace l'ancien MiniCalendar de
// app/app/disponibilites/page.jsx (qui ne servait qu'à préremplir une
// indisponibilité) : celui-ci sert à la fois à la navigation et à l'ajout,
// pour RDV comme pour indisponibilités.
function MonthCalendar({ month, onChangeMonth, appointments, blocks, selectedDay, onSelectDay }) {
  const [locale] = useLocale();
  const MONTH_LABELS = monthLabelsFor(locale);
  const WEEKDAY_LABELS = weekdayLabelsFor(locale);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  // getDay() = 0 (dimanche) .. 6 (samedi) -> on veut un offset lundi-first
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const apptDates = new Set(
    (appointments || [])
      .filter((a) => a.status !== 'annulé')
      .map((a) => new Date(a.proposed_at).toDateString())
  );

  // Un bloc peut s'étaler sur plusieurs jours — on marque chaque jour couvert
  // (borné à 60 itérations par bloc pour rester défensif sur des données
  // aberrantes plutôt que de boucler indéfiniment).
  const blockedDates = new Set();
  (blocks || []).forEach((b) => {
    const start = new Date(b.start_at);
    const end = new Date(b.end_at);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let guard = 0;
    while (cursor <= end && guard < 60) {
      blockedDates.add(cursor.toDateString());
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  });

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="month-calendar">
      <div className="cal-header">
        <button type="button" onClick={() => onChangeMonth(new Date(year, monthIndex - 1, 1))}>‹</button>
        <span>{MONTH_LABELS[monthIndex]} {year}</span>
        <button type="button" onClick={() => onChangeMonth(new Date(year, monthIndex + 1, 1))}>›</button>
      </div>
      <div className="cal-grid cal-weekdays">
        {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} className="cal-cell empty" />;
          const dateStr = day.toDateString();
          const hasAppt = apptDates.has(dateStr);
          const isBlocked = blockedDates.has(dateStr);
          const isToday = dateStr === today.toDateString();
          const isSelected = selectedDay && selectedDay.toDateString() === dateStr;
          return (
            <button
              type="button"
              key={i}
              className={`cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectDay(day)}
            >
              {day.getDate()}
              <span className="cal-dots">
                {hasAppt && <span className="cal-dot appt" />}
                {isBlocked && <span className="cal-dot blocked" />}
              </span>
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .month-calendar {
          max-width: 480px;
        }
        .cal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.9rem;
          font-weight: 600;
          margin-bottom: 0.8rem;
          text-transform: capitalize;
        }
        .cal-header button {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          width: 28px;
          height: 28px;
          cursor: pointer;
        }
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.25rem;
        }
        .cal-weekdays {
          margin-bottom: 0.4rem;
          font-size: 0.72rem;
          color: var(--muted);
          text-align: center;
        }
        .cal-cell {
          aspect-ratio: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.15rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 0.8rem;
          cursor: pointer;
        }
        .cal-cell.empty {
          background: transparent;
          border: none;
          cursor: default;
        }
        .cal-cell.today {
          border-color: var(--accent);
        }
        .cal-cell.selected {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.18);
        }
        .cal-cell:not(.empty):hover {
          border-color: var(--accent);
        }
        .cal-dots {
          display: flex;
          gap: 3px;
          height: 6px;
        }
        .cal-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }
        .cal-dot.appt {
          background: var(--accent-green);
        }
        .cal-dot.blocked {
          background: var(--accent-red);
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
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
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
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
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
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
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
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
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
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
