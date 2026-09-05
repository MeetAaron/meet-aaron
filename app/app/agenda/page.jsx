// app/app/agenda/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import { Repeat, CalendarOff, Plus, X, Pencil, Trash2, RefreshCw, Phone, Handshake, Video, Calendar as CalendarIcon } from 'lucide-react';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import { frenchTypography } from '@/lib/text-typography';

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
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
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

// Icônes de type de RDV : traits (lucide) et non emojis — docx 05/09/2026,
// « tous les symboles de l'appli doivent être modernes ». Rendues en ligne
// dans les badges .type-badge (voir TypeIcon ci-dessous).
function TypeIcon({ type, size = 13 }) {
  const props = { size, strokeWidth: 2.2, 'aria-hidden': 'true', style: { verticalAlign: '-2px', marginRight: '0.3em' } };
  if (type === 'telephonique') return <Phone {...props} />;
  if (type === 'physique') return <Handshake {...props} />;
  if (type === 'visio') return <Video {...props} />;
  return null;
}

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

// Pastille de date des lignes d'agenda (04/09/2026, demande Alex : « je
// trouve que ça manque un peu d'âme le visuel »). Une liste de rendez-vous
// sans repère de date se lit ligne par ligne ; avec un bloc jour/mois à
// gauche, l'œil saute directement à la bonne date. « Aujourd'hui » et
// « demain » sont mis en avant : ce sont les deux seules dates qu'on cherche
// vraiment dans un agenda.
function dayChipInfo(dateStr, locale) {
  const d = new Date(dateStr);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(today)) / 86400000);
  return {
    day: d.toLocaleDateString(locale, { day: 'numeric' }),
    month: d.toLocaleDateString(locale, { month: 'short' }).replace('.', ''),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    isToday: diffDays === 0,
    isTomorrow: diffDays === 1,
    isPast: diffDays < 0,
  };
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
  const [addModalPreset, setAddModalPreset] = useState(null); // { kind, date, hideUnavailability } quand ouvert depuis le calendrier
  const [detailAppointment, setDetailAppointment] = useState(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false); // docx AGENDA #19 : liste repliable (5 par défaut)
  // Demande d'Alex (25/08/2026) : mêmes listes repliables (5 par défaut) pour
  // les créneaux récurrents et les indisponibilités ponctuelles.
  const [showAllRules, setShowAllRules] = useState(false);
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  // Formulaires d'ajout repliés derrière le « + » de chaque groupe (05/09/2026).
  const [addingRule, setAddingRule] = useState(false);
  const [addingBlock, setAddingBlock] = useState(false);
  // « Modifications enregistrées » sous le groupe concerné (docx 05/09/2026 :
  // « il faut que ce soit la même chose sur toutes les fonctionnalités »).
  const [savedGroup, setSavedGroup] = useState(null);
  const savedTimer = useRef(null);
  function flashSaved(group) {
    setSavedGroup(group);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedGroup(null), 2500);
  }

  // Disponibilités (fusionnées depuis l'ancienne page, voir #86) — règles
  // hebdomadaires récurrentes + indisponibilités ponctuelles.
  const [rules, setRules] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [newRule, setNewRule] = useState({ day_of_week: 1, start_time: '09:00', end_time: '18:00', appointment_type: '' });
  const [savingRule, setSavingRule] = useState(false);
  const [newBlock, setNewBlock] = useState({ start_at: '', end_at: '', reason: '' });
  const [savingBlock, setSavingBlock] = useState(false);
  // docx "AGENDA" item A3 : pouvoir modifier une ligne existante (créneau
  // récurrent ou indisponibilité ponctuelle), pas juste la supprimer.
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editRuleDraft, setEditRuleDraft] = useState(null);
  const [savingEditRule, setSavingEditRule] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editBlockDraft, setEditBlockDraft] = useState(null);
  const [savingEditBlock, setSavingEditBlock] = useState(false);
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

  // Prospects/A4 (docx CHANGEMENTS A FAIRE, 2026-08-20) : suppression
  // définitive d'un RDV déjà passé — auparavant seule l'annulation existait,
  // ce qui envoyait à tort un message d'annulation au prospect pour un
  // rendez-vous déjà terminé (voir app/api/appointments/[id]/route.ts).
  // Volontairement limité aux RDV déjà passés côté serveur ; pas de
  // confirmation supplémentaire ici (le commercial vient de cliquer un
  // bouton "Supprimer" explicite).
  async function handleDelete(appointmentId) {
    setActingOn(appointmentId);
    await fetch(`/api/appointments/${appointmentId}`, { method: 'DELETE' });
    setActingOn(null);
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
    setAddingRule(false);
    flashSaved('rules');
  }

  async function handleDeleteRule(id) {
    await fetch(`/api/availability/rules/${id}?user_id=${userId}`, { method: 'DELETE' });
    setRules((prev) => prev.filter((r) => r.id !== id));
    flashSaved('rules');
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
    setAddingBlock(false);
    flashSaved('blocks');
  }

  async function handleDeleteBlock(id) {
    await fetch(`/api/availability/blocks/${id}?user_id=${userId}`, { method: 'DELETE' });
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    flashSaved('blocks');
  }

  // --- Modifier un créneau récurrent (docx AGENDA item A3) ---
  function startEditRule(r) {
    setEditingRuleId(r.id);
    setEditRuleDraft({
      day_of_week: r.day_of_week,
      start_time: r.start_time.slice(0, 5),
      end_time: r.end_time.slice(0, 5),
      appointment_type: r.appointment_type || '',
    });
  }

  function cancelEditRule() {
    setEditingRuleId(null);
    setEditRuleDraft(null);
  }

  async function handleSaveEditRule(id) {
    setSavingEditRule(true);
    setAvailError(null);
    const res = await fetch(`/api/availability/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...editRuleDraft }),
    });
    const body = await res.json();
    setSavingEditRule(false);
    if (!res.ok) {
      setAvailError(body.error);
      return;
    }
    setRules((prev) =>
      prev
        .map((r) => (r.id === id ? body.rule : r))
        .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
    );
    cancelEditRule();
    flashSaved('rules');
  }

  // --- Modifier une indisponibilité ponctuelle (docx AGENDA item A3) ---
  function toDatetimeLocalValue(isoString) {
    // <input type="datetime-local"> attend "AAAA-MM-JJTHH:mm" en heure
    // locale du navigateur — new Date(iso).toISOString() renverrait de
    // l'UTC, d'où ce recalage manuel du décalage horaire.
    const d = new Date(isoString);
    const offsetMs = d.getTimezoneOffset() * 60 * 1000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function startEditBlock(b) {
    setEditingBlockId(b.id);
    setEditBlockDraft({
      start_at: toDatetimeLocalValue(b.start_at),
      end_at: toDatetimeLocalValue(b.end_at),
      reason: b.reason || '',
    });
  }

  function cancelEditBlock() {
    setEditingBlockId(null);
    setEditBlockDraft(null);
  }

  async function handleSaveEditBlock(id) {
    setSavingEditBlock(true);
    setAvailError(null);
    const res = await fetch(`/api/availability/blocks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        start_at: new Date(editBlockDraft.start_at).toISOString(),
        end_at: new Date(editBlockDraft.end_at).toISOString(),
        reason: editBlockDraft.reason,
      }),
    });
    const body = await res.json();
    setSavingEditBlock(false);
    if (!res.ok) {
      setAvailError(body.error);
      return;
    }
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? body.block : b)).sort((a, b) => a.start_at.localeCompare(b.start_at))
    );
    cancelEditBlock();
    flashSaved('blocks');
  }

  function openAddForDay(kind, opts) {
    // docx AGENDA A2 : "+RDV ce jour" ne doit proposer que les 3 vrais types
    // de RDV, pas "indisponibilité" en 4e option (bouton dédié juste à côté).
    setAddModalPreset({ kind, date: selectedDay, hideUnavailability: opts?.hideUnavailability });
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
      </header>

      {/* « Je trouve que le bouton ajouter n'est pas au bon endroit » (Alex,
          04/09/2026), puis « fais les modifs pour la version PC également ».
          Le bouton de l'en-tête a disparu partout : c'est un bouton flottant
          en bas à droite, sur téléphone (au-dessus de la barre d'onglets, zone
          sûre iPhone comprise) comme sur ordinateur. Le geste « ajouter » est
          le seul de la page qu'on refait sans arrêt : il doit être au même
          endroit quelle que soit la longueur de la liste, pas en haut d'une
          page qu'on a fait défiler. */}
      <button
        type="button"
        className="fab"
        aria-label={t('common.add', locale)}
        onClick={() => {
          setAddModalPreset(null);
          setShowAddModal(true);
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>

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

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          {/* Bloc « Aujourd'hui » (04/09/2026, « ça manque d'âme, de punch »).
              Un agenda doit répondre en une seconde à UNE question : qu'est-ce
              que j'ai aujourd'hui, et c'est quand le prochain ? Avant, on
              arrivait sur une liste plate qu'il fallait lire. Ce bloc est
              calculé sur les mêmes rendez-vous que la liste, jamais figé. */}
          {(() => {
            const now = new Date();
            const live = appointments.filter((a) => a.status !== 'annulé');
            const todayList = live
              .filter((a) => new Date(a.proposed_at).toDateString() === now.toDateString())
              .sort((a, b) => new Date(a.proposed_at) - new Date(b.proposed_at));
            const upcoming = live
              .filter((a) => new Date(a.proposed_at) >= now)
              .sort((a, b) => new Date(a.proposed_at) - new Date(b.proposed_at));
            const next = upcoming[0] || null;
            const todayLeft = todayList.filter((a) => new Date(a.proposed_at) >= now).length;
            const nextIsToday = next && new Date(next.proposed_at).toDateString() === now.toDateString();
            const nextIsTomorrow = next && (() => { const d = new Date(now); d.setDate(d.getDate() + 1); return new Date(next.proposed_at).toDateString() === d.toDateString(); })();
            const who = (a) => a.prospects?.full_name || a.contact_name || '';
            const where = (a) => a.prospects?.prospect_companies?.name || '';
            return (
              <section className="today-hero">
                <div className="today-main">
                  <p className="today-eyebrow">{t('agenda.todayEyebrow', locale)}</p>
                  <p className="today-count">
                    {todayList.length === 0
                      ? t('agenda.todayNone', locale)
                      : t(todayList.length === 1 ? 'agenda.todayOne' : 'agenda.todayMany', locale).replace('{n}', todayList.length)}
                    {todayList.length > 0 && todayLeft < todayList.length && (
                      <span className="today-left"> · {t('agenda.todayLeft', locale).replace('{n}', todayLeft)}</span>
                    )}
                  </p>
                </div>
                {next ? (
                  <div className="today-next">
                    <span className="today-next-label">
                      {nextIsToday ? t('agenda.nextToday', locale) : nextIsTomorrow ? t('agenda.nextTomorrow', locale) : t('agenda.nextLater', locale)}
                    </span>
                    <button
                      type="button"
                      className="today-next-card"
                      onClick={next.prospect_id ? () => setDetailAppointment(next) : undefined}
                    >
                      <span className="today-next-time">
                        {nextIsToday || nextIsTomorrow
                          ? new Date(next.proposed_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                          : new Date(next.proposed_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="today-next-who">
                        <strong>{who(next)}</strong>
                        {where(next) && <span className="muted"> — {where(next)}</span>}
                      </span>
                      <span className={`type-badge type-${next.type}`}><TypeIcon type={next.type} />{TYPE_LABELS[next.type]}</span>
                    </button>
                    {next.meet_link && (
                      <a href={next.meet_link} target="_blank" rel="noreferrer" className="today-join">
                        {t('agenda.joinNow', locale)} →
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="today-empty">{t('agenda.noUpcoming', locale)}</p>
                )}
              </section>
            );
          })()}


          {/* L'état vide « Aucun rendez-vous » a disparu (Alex, 04/09/2026 :
              « il y a un gros vide au milieu, c'est moche ») : le bloc
              « Aujourd'hui » ci-dessus dit déjà qu'il n'y a rien, et le
              calendrier reste utile même vide (indisponibilités, ajout). */}
          {pending.length > 0 && (
            <section className="block">
              <h2>{t('agenda.statusProposed', locale)} ({pending.length})</h2>
              <div className="list">
                {pending.map((a) => (
                  <div className="row" key={a.id}>
                    {(() => {
                      const chip = dayChipInfo(a.proposed_at, locale);
                      return (
                        <span className={`day-chip${chip.isToday ? ' today' : ''}${chip.isPast ? ' past' : ''}`} aria-hidden="true">
                          <span className="day-chip-num">{chip.day}</span>
                          <span className="day-chip-mon">{chip.month}</span>
                          <span className="day-chip-time">{chip.time}</span>
                        </span>
                      );
                    })()}
                    <div
                      className={a.prospect_id ? 'row-info clickable' : 'row-info'}
                      onClick={a.prospect_id ? () => setDetailAppointment(a) : undefined}
                    >
                      <strong>{a.prospects?.full_name}</strong>
                      <span className="muted"> — {a.prospects?.prospect_companies?.name || t('agenda.unknownCompany', locale)}</span>
                      <div className="meta">
                        <span className={`type-badge type-${a.type}`}><TypeIcon type={a.type} />{TYPE_LABELS[a.type]}</span>
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
                      {new Date(a.proposed_at) < new Date() && (
                        <button
                          className="btn-danger"
                          disabled={actingOn === a.id}
                          onClick={() => handleDelete(a.id)}
                        >
                          {t('common.delete', locale)}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="block">
            <h2>{t('agenda.sectionAll', locale)}</h2>
            <div className="list">
              {(showAllUpcoming ? rest : rest.slice(0, 5)).map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META['proposé'];
                return (
                  <div className="row" key={a.id}>
                    {(() => {
                      const chip = dayChipInfo(a.proposed_at, locale);
                      return (
                        <span className={`day-chip${chip.isToday ? ' today' : ''}${chip.isPast ? ' past' : ''}`} aria-hidden="true">
                          <span className="day-chip-num">{chip.day}</span>
                          <span className="day-chip-mon">{chip.month}</span>
                          <span className="day-chip-time">{chip.time}</span>
                        </span>
                      );
                    })()}
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
                        <span className={`type-badge type-${a.type}`}><TypeIcon type={a.type} />{TYPE_LABELS[a.type]}</span>
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
                    {/* Docx 30/08, items 3 et 7 : le bilan (ressenti + suite +
                        contexte + email de remerciement) est accessible
                        directement depuis l'agenda pour tout RDV passé, pas
                        seulement depuis la notification. */}
                    {new Date(a.proposed_at) < new Date() && a.prospect_id && a.status !== 'annulé' && (
                      <a href={`/app/agenda/rdv/${a.id}/bilan`} className={a.outcome ? 'btn-bilan done' : 'btn-bilan'}>
                        {a.outcome ? t('agenda.bilanDone', locale) : t('agenda.bilanTodo', locale)}
                      </a>
                    )}
                    {new Date(a.proposed_at) < new Date() && (
                      <button
                        type="button"
                        className="btn-remove"
                        disabled={actingOn === a.id}
                        onClick={() => handleDelete(a.id)}
                        aria-label={t('common.delete', locale)}
                        title={t('common.delete', locale)}
                      >
                        <X size={15} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {rest.length > 5 && (
              <button
                type="button"
                className="btn-link-more"
                onClick={() => setShowAllUpcoming((prev) => !prev)}
              >
                {showAllUpcoming
                  ? t('agenda.showLess', locale)
                  : `${t('agenda.showMore', locale)} (${rest.length - 5})`}
              </button>
            )}
          </section>
        </>
      )}

      {/* "la liste des rdvs à venir doit être tout en haut. Et ensuite
          seulement le bloc calendrier" (Alex, 25/08/2026) — le bloc
          calendrier vient maintenant après la liste des RDV ci-dessus,
          au lieu d'avant. */}
      {/* Calendrier à gauche, panneau du jour à droite (Alex, 04/09/2026 :
          « sur PC il y a un gros vide au milieu entre le calendrier et le + »).
          Le calendrier est borné à 480 px de large — au-delà les cases
          deviennent des dalles — donc la moitié droite de l'écran était vide.
          Le panneau du jour y prend place : le jour sélectionné, ou par défaut
          les prochains rendez-vous du mois affiché. Sur téléphone, les deux
          s'empilent comme avant. */}
      <section className="block calendar-block">
        <h2>{t('agenda.calendarTitle', locale)}</h2>
        <div className="calendar-layout">
        <div className="calendar-col">
        <MonthCalendar
          month={calendarMonth}
          onChangeMonth={setCalendarMonth}
          appointments={appointments}
          blocks={blocks}
          selectedDay={selectedDay}
          onSelectDay={(day) => setSelectedDay((prev) => (prev && prev.toDateString() === day.toDateString() ? null : day))}
        />
        <div className="calendar-legend">
          <span className="legend-item"><span className="legend-dot appt" /> {t('agenda.calendarLegendAppt', locale)}</span>
          <span className="legend-item"><span className="legend-dot blocked" /> {t('agenda.calendarLegendBlocked', locale)}</span>
        </div>
        </div>

        <div className="calendar-side">
        {!selectedDay && (() => {
          const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
          const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0, 23, 59, 59);
          const inMonth = appointments
            .filter((a) => a.status !== 'annulé')
            .filter((a) => { const d = new Date(a.proposed_at); return d >= monthStart && d <= monthEnd; })
            .sort((a, b) => new Date(a.proposed_at) - new Date(b.proposed_at));
          return (
            <div className="day-detail month-side">
              <div className="day-detail-header">
                <strong>{calendarMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</strong>
                <span className="muted small">{t('agenda.monthSideCount', locale).replace('{n}', inMonth.length)}</span>
              </div>
              {inMonth.length === 0 ? (
                <p className="muted small">{t('agenda.monthSideEmpty', locale)}</p>
              ) : (
                <ul className="day-detail-list">
                  {inMonth.slice(0, 8).map((a) => {
                    const d = new Date(a.proposed_at);
                    return (
                      <li key={a.id} className="day-detail-item clickable" onClick={() => setSelectedDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()))}>
                        <span className="side-date">{d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })} · {d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{a.prospects?.full_name || a.contact_name}</span>
                        <span className={`type-badge type-${a.type}`}><TypeIcon type={a.type} />{TYPE_LABELS[a.type]}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="muted small side-hint">{t('agenda.monthSideHint', locale)}</p>
              <div className="day-detail-actions">
                <button type="button" className="btn-secondary" onClick={() => { setAddModalPreset(null); setShowAddModal(true); }}>
                  {t('agenda.dayDetailAddAppt', locale)}
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setAddModalPreset({ kind: 'indisponibilite', date: null }); setShowAddModal(true); }}>
                  {t('agenda.dayDetailAddBlock', locale)}
                </button>
              </div>
            </div>
          );
        })()}

        {selectedDay && (
          <div className="day-detail">
            <div className="day-detail-header">
              <strong>{selectedDay.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
              <button type="button" className="btn-remove" onClick={() => setSelectedDay(null)} aria-label={t('agenda.dayDetailClose', locale)}><X size={15} strokeWidth={2.2} aria-hidden="true" /></button>
            </div>

            {selectedDayAppointments.length === 0 ? (
              <p className="muted small">{t('agenda.dayDetailNoAppointments', locale)}</p>
            ) : (
              <ul className="day-detail-list">
                {selectedDayAppointments.map((a) => (
                  <li key={a.id} className="day-detail-item">
                    <span className={`type-badge type-${a.type}`}><TypeIcon type={a.type} />{TYPE_LABELS[a.type]}</span>
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
              <button type="button" className="btn-secondary" onClick={() => openAddForDay(null, { hideUnavailability: true })}>
                {t('agenda.dayDetailAddAppt', locale)}
              </button>
              <button type="button" className="btn-secondary" onClick={() => openAddForDay('indisponibilite')}>
                {t('agenda.dayDetailAddBlock', locale)}
              </button>
            </div>
          </div>
        )}

          {/* Docx « derniers ajouts » (05/09/2026) : créneaux récurrents et
              indisponibilités ponctuelles À CÔTÉ du calendrier — plus deux
              grands encadrés en bas de page qu'il fallait aller chercher en
              défilant. Chaque liste montre 5 lignes, puis « voir plus » ;
              l'ajout est replié derrière un « + » pour ne pas encombrer la
              colonne. Sur téléphone, la colonne passe sous le calendrier. */}
          <div className="avail-card">
            <div className="avail-group">
              <div className="avail-head">
                <span className="avail-ic"><Repeat size={16} strokeWidth={2} aria-hidden="true" /></span>
                <div className="avail-titles">
                  <strong>{t('disponibilites.recurringSlotsTitle', locale)}</strong>
                  <span className="muted small">{rules.length === 0 ? t('disponibilites.noRulesYet', locale) : t('agenda.availRulesHint', locale)}</span>
                </div>
                <button type="button" className={`btn-icon${addingRule ? ' active' : ''}`} onClick={() => setAddingRule((v) => !v)} aria-label={t('common.add', locale)} title={t('common.add', locale)}>
                  {addingRule ? <X size={16} strokeWidth={2.2} aria-hidden="true" /> : <Plus size={16} strokeWidth={2.2} aria-hidden="true" />}
                </button>
              </div>

              {addingRule && (
                <form className="avail-form" onSubmit={async (e) => { await handleAddRule(e); }}>
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
              )}

              {availabilityLoading ? (
                <p className="muted small">{t('common.loading', locale)}</p>
              ) : rules.length > 0 && (
                <ul className="avail-list">
                  {(showAllRules ? rules : rules.slice(0, 5)).map((r) =>
                    editingRuleId === r.id ? (
                      <li key={r.id} className="avail-row editing">
                        <select
                          value={editRuleDraft.day_of_week}
                          onChange={(e) => setEditRuleDraft({ ...editRuleDraft, day_of_week: Number(e.target.value) })}
                        >
                          {daysFor(locale).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                        <input
                          type="time"
                          value={editRuleDraft.start_time}
                          onChange={(e) => setEditRuleDraft({ ...editRuleDraft, start_time: e.target.value })}
                        />
                        <span className="sep">{t('disponibilites.timeRangeSep', locale)}</span>
                        <input
                          type="time"
                          value={editRuleDraft.end_time}
                          onChange={(e) => setEditRuleDraft({ ...editRuleDraft, end_time: e.target.value })}
                        />
                        <select
                          value={editRuleDraft.appointment_type}
                          onChange={(e) => setEditRuleDraft({ ...editRuleDraft, appointment_type: e.target.value })}
                        >
                          {apptTypesFor(locale).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                        <button type="button" className="btn-primary" disabled={savingEditRule} onClick={() => handleSaveEditRule(r.id)}>
                          {savingEditRule ? t('common.saving', locale) : t('common.save', locale)}
                        </button>
                        <button type="button" className="btn-secondary" onClick={cancelEditRule}>{t('common.cancel', locale)}</button>
                      </li>
                    ) : (
                      <li key={r.id} className="avail-row">
                        <span className="avail-day">{dayLabel(r.day_of_week, locale).slice(0, 3)}</span>
                        <span className="avail-time">{r.start_time.slice(0, 5)} – {r.end_time.slice(0, 5)}</span>
                        <span className="avail-type">{apptTypesFor(locale).find((opt) => opt.value === (r.appointment_type || ''))?.label || t('disponibilites.allApptTypes', locale)}</span>
                        <span className="avail-actions">
                          <button type="button" className="btn-icon sm" onClick={() => startEditRule(r)} aria-label={t('common.edit', locale)} title={t('common.edit', locale)}><Pencil size={14} strokeWidth={2} aria-hidden="true" /></button>
                          <button type="button" className="btn-icon sm danger" onClick={() => handleDeleteRule(r.id)} aria-label={t('common.delete', locale)} title={t('common.delete', locale)}><Trash2 size={14} strokeWidth={2} aria-hidden="true" /></button>
                        </span>
                      </li>
                    )
                  )}
                </ul>
              )}
              {rules.length > 5 && (
                <button type="button" className="btn-link-more" onClick={() => setShowAllRules((prev) => !prev)}>
                  {showAllRules ? t('agenda.showLess', locale) : `${t('agenda.showMore', locale)} (${rules.length - 5})`}
                </button>
              )}
              {savedGroup === 'rules' && <p className="saved-flash" role="status">{t('preferences.changeSaved', locale)}</p>}
            </div>

            <div className="avail-group">
              <div className="avail-head">
                <span className="avail-ic off"><CalendarOff size={16} strokeWidth={2} aria-hidden="true" /></span>
                <div className="avail-titles">
                  <strong>{t('disponibilites.oneOffUnavailabilityTitle', locale)}</strong>
                  <span className="muted small">{blocks.length === 0 ? t('disponibilites.noBlocksUpcoming', locale) : t('agenda.availBlocksHint', locale)}</span>
                </div>
                <button type="button" className={`btn-icon${addingBlock ? ' active' : ''}`} onClick={() => setAddingBlock((v) => !v)} aria-label={t('common.add', locale)} title={t('common.add', locale)}>
                  {addingBlock ? <X size={16} strokeWidth={2.2} aria-hidden="true" /> : <Plus size={16} strokeWidth={2.2} aria-hidden="true" />}
                </button>
              </div>

              {addingBlock && (
                <form className="avail-form" onSubmit={handleAddBlock}>
                  <input type="datetime-local" value={newBlock.start_at} onChange={(e) => setNewBlock({ ...newBlock, start_at: e.target.value })} required />
                  <span className="sep">{t('disponibilites.timeRangeSep', locale)}</span>
                  <input type="datetime-local" value={newBlock.end_at} onChange={(e) => setNewBlock({ ...newBlock, end_at: e.target.value })} required />
                  <input type="text" placeholder={t('disponibilites.reasonPlaceholder', locale)} value={newBlock.reason} onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })} />
                  <button type="submit" className="btn-primary" disabled={savingBlock}>{savingBlock ? t('disponibilites.adding', locale) : t('disponibilites.blockSlotButton', locale)}</button>
                </form>
              )}

              {availabilityLoading ? (
                <p className="muted small">{t('common.loading', locale)}</p>
              ) : blocks.length > 0 && (
                <ul className="avail-list">
                  {(showAllBlocks ? blocks : blocks.slice(0, 5)).map((b) =>
                    editingBlockId === b.id ? (
                      <li key={b.id} className="avail-row editing">
                        <input
                          type="datetime-local"
                          value={editBlockDraft.start_at}
                          onChange={(e) => setEditBlockDraft({ ...editBlockDraft, start_at: e.target.value })}
                        />
                        <span className="sep">{t('disponibilites.timeRangeSep', locale)}</span>
                        <input
                          type="datetime-local"
                          value={editBlockDraft.end_at}
                          onChange={(e) => setEditBlockDraft({ ...editBlockDraft, end_at: e.target.value })}
                        />
                        <input
                          type="text"
                          placeholder={t('disponibilites.reasonPlaceholder', locale)}
                          value={editBlockDraft.reason}
                          onChange={(e) => setEditBlockDraft({ ...editBlockDraft, reason: e.target.value })}
                        />
                        <button type="button" className="btn-primary" disabled={savingEditBlock} onClick={() => handleSaveEditBlock(b.id)}>
                          {savingEditBlock ? t('common.saving', locale) : t('common.save', locale)}
                        </button>
                        <button type="button" className="btn-secondary" onClick={cancelEditBlock}>{t('common.cancel', locale)}</button>
                      </li>
                    ) : (
                      <li key={b.id} className="avail-row">
                        <span className="avail-dot" aria-hidden="true" />
                        <span className="avail-dates">
                          <span>{new Date(b.start_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <span className="muted"> → </span>
                          <span>{new Date(b.end_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          {b.reason && <span className="avail-reason">{b.reason}</span>}
                        </span>
                        {b.source === 'sync' ? (
                          // Remontée automatiquement depuis Google/Outlook (voir
                          // lib/calendar-sync.ts) : ni modifiable ni supprimable
                          // depuis Aaron — ça reviendrait juste au prochain
                          // passage du cron tant que l'événement existe côté
                          // calendrier externe. Le badge explique pourquoi les
                          // boutons habituels ne sont pas là.
                          <span className="avail-sync" title={t('disponibilites.syncedHint', locale)}>
                            <RefreshCw size={12} strokeWidth={2} aria-hidden="true" /> {t('disponibilites.syncedBadge', locale)}
                          </span>
                        ) : (
                          <span className="avail-actions">
                            <button type="button" className="btn-icon sm" onClick={() => startEditBlock(b)} aria-label={t('common.edit', locale)} title={t('common.edit', locale)}><Pencil size={14} strokeWidth={2} aria-hidden="true" /></button>
                            <button type="button" className="btn-icon sm danger" onClick={() => handleDeleteBlock(b.id)} aria-label={t('common.delete', locale)} title={t('common.delete', locale)}><Trash2 size={14} strokeWidth={2} aria-hidden="true" /></button>
                          </span>
                        )}
                      </li>
                    )
                  )}
                </ul>
              )}
              {blocks.length > 5 && (
                <button type="button" className="btn-link-more" onClick={() => setShowAllBlocks((prev) => !prev)}>
                  {showAllBlocks ? t('agenda.showLess', locale) : `${t('agenda.showMore', locale)} (${blocks.length - 5})`}
                </button>
              )}
              {savedGroup === 'blocks' && <p className="saved-flash" role="status">{t('preferences.changeSaved', locale)}</p>}
              {availError && <p className="error">{availError}</p>}
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* Synchronisation calendrier (lien ICS/webcal + QR) : déplacée le
          31/08/2026 dans la checklist « Mise en route » de Mon compte >
          Connexion (docx Modifs Aaron 30/08 — "toutes les étapes nécessaires
          au bon fonctionnement d'Aaron au même endroit"). On laisse juste un
          renvoi pour ne pas perdre ceux qui la cherchaient ici. */}
      <p className="sync-moved muted small">
        {t('disponibilites.syncMovedHint', locale)}{' '}
        <a href={`/app/connexions?tab=connection${userId ? `&user_id=${userId}` : ''}`}>{t('disponibilites.syncMovedLink', locale)} →</a>
      </p>

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
        /* Pastille de date (04/09/2026). Largeur fixe pour que toutes les
           lignes s'alignent : c'est l'alignement, plus que la pastille, qui
           donne son rythme à la liste. */
        .day-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          width: 52px;
          flex-shrink: 0;
          padding: 0.4rem 0;
          border-radius: var(--radius-md);
          background: var(--bg);
          border: 1px solid var(--border);
        }
        .day-chip-num {
          font-family: var(--font-mono);
          font-size: 1.05rem;
          line-height: 1;
        }
        .day-chip-mon {
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted);
        }
        .day-chip-time {
          font-family: var(--font-mono);
          font-size: 0.62rem;
          color: var(--muted);
          margin-top: 2px;
        }
        .day-chip.today {
          background: rgba(75, 57, 239, 0.14);
          border-color: rgba(75, 57, 239, 0.5);
        }
        .day-chip.today .day-chip-num { color: var(--accent-light); }
        .day-chip.past { opacity: 0.55; }
        .row-info {
          font-size: 0.9rem;
          flex-grow: 1;
          min-width: 0;
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
        /* « Le bloc aucun RDV est collé au bloc calendrier » (Alex,
           04/09/2026) : 1 rem ne suffisait pas à séparer visuellement deux
           encadrés qui se touchent presque. */
        .calendar-layout {
          display: grid;
          grid-template-columns: minmax(0, 480px) minmax(0, 1fr);
          gap: 1.6rem;
          align-items: start;
        }
        .calendar-col {
          min-width: 0;
        }
        .day-detail {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1.1rem 1.15rem;
          margin-top: 0;
        }
        .day-detail-item.clickable { cursor: pointer; }
        .day-detail-item.clickable:hover { color: var(--accent-light); }
        .side-date {
          font-family: var(--font-mono);
          font-size: 0.76rem;
          color: var(--muted);
          min-width: 9ch;
        }
        .side-hint { margin: 0.6rem 0 0; }
        @media (max-width: 900px) {
          .calendar-layout { grid-template-columns: 1fr; }
          .day-detail { margin-top: 1.2rem; }
        }

        /* Bloc « Aujourd'hui » (04/09/2026). Le dégradé est réservé à ce seul
           bloc : c'est lui qui donne la première impression de la page, le
           reste doit rester calme pour qu'il ressorte. */
        .today-hero {
          display: flex;
          align-items: stretch;
          gap: 1.4rem;
          padding: 1.3rem 1.5rem;
          margin-bottom: 1.4rem;
          border-radius: var(--radius-lg);
          background: linear-gradient(135deg, rgba(75, 57, 239, 0.22), rgba(201, 63, 140, 0.12));
          border: 1px solid rgba(75, 57, 239, 0.35);
        }
        .today-main {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 180px;
        }
        .today-eyebrow {
          margin: 0 0 0.3rem;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--accent-light);
        }
        .today-count {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.2;
        }
        .today-left {
          font-family: var(--font-body);
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--muted);
        }
        .today-next {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding-left: 1.4rem;
          border-left: 1px solid rgba(244, 241, 234, 0.12);
        }
        .today-next-label {
          font-size: 0.7rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .today-next-card {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          flex-wrap: wrap;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.9rem;
          color: var(--text);
          font-family: inherit;
          font-size: 0.9rem;
          text-align: left;
          cursor: pointer;
          transition: border-color var(--fast);
        }
        .today-next-card:hover { border-color: var(--accent); }
        .today-next-time {
          font-family: var(--font-mono);
          font-size: 1.05rem;
          color: var(--accent-light);
          flex-shrink: 0;
        }
        .today-next-who { flex: 1; min-width: 0; }
        .today-join {
          align-self: flex-start;
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--accent-green);
          text-decoration: none;
        }
        .today-empty {
          margin: 0;
          align-self: center;
          color: var(--muted);
          font-size: 0.88rem;
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
        /* --- Colonne à droite du calendrier : panneau du jour/mois puis la
           carte « disponibilités » (05/09/2026). --- */
        .calendar-side {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1.2rem;
        }
        .avail-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.4rem 0;
        }
        .avail-group {
          padding: 0.8rem 1.15rem 0.9rem;
        }
        .avail-group + .avail-group {
          border-top: 1px solid var(--border);
        }
        .avail-head {
          display: flex;
          align-items: center;
          gap: 0.8rem;
        }
        .avail-ic {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(75, 57, 239, 0.14);
          color: var(--accent-light);
          flex-shrink: 0;
        }
        .avail-ic.off {
          background: rgba(239, 68, 89, 0.12);
          color: var(--accent-red);
        }
        .avail-titles {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          flex: 1;
        }
        .avail-titles strong {
          font-size: 0.92rem;
        }
        .avail-titles .small {
          font-size: 0.76rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .avail-head .btn-icon.active {
          background: var(--tint-8);
          color: var(--text);
        }
        .avail-form {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          margin: 0.8rem 0 0.2rem;
          padding: 0.7rem;
          background: var(--surface);
          border: 1px dashed var(--border);
          border-radius: var(--radius-sm);
        }
        .avail-form select,
        .avail-form input,
        .avail-row.editing select,
        .avail-row.editing input {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.42rem 0.6rem;
          color: var(--text);
          font-size: 0.82rem;
          min-width: 0;
        }
        .avail-form input[type='text'] {
          flex: 1;
          min-width: 140px;
        }
        .avail-form .btn-primary,
        .avail-row.editing .btn-primary {
          padding: 0.42rem 0.8rem;
          font-size: 0.8rem;
        }
        .avail-list {
          list-style: none;
          margin: 0.7rem 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .avail-row {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0.45rem 0.6rem;
          border-radius: var(--radius-sm);
          font-size: 0.84rem;
          transition: background var(--fast, 0.15s ease);
        }
        .avail-row:hover {
          background: var(--tint-4);
        }
        .avail-row.editing {
          flex-wrap: wrap;
          background: var(--surface);
          border: 1px solid var(--border);
        }
        .avail-day {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--accent-light);
          background: rgba(75, 57, 239, 0.14);
          border-radius: 6px;
          padding: 2px 7px;
          min-width: 3ch;
          text-align: center;
        }
        .avail-time {
          font-family: var(--font-mono);
          font-size: 0.82rem;
          white-space: nowrap;
        }
        .avail-type {
          color: var(--muted);
          font-size: 0.78rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .avail-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-red);
          flex-shrink: 0;
        }
        .avail-dates {
          flex: 1;
          min-width: 0;
          font-family: var(--font-mono);
          font-size: 0.78rem;
          line-height: 1.4;
        }
        .avail-reason {
          display: block;
          font-family: var(--font-body);
          color: var(--muted);
          font-size: 0.78rem;
        }
        .avail-actions {
          display: inline-flex;
          gap: 0.15rem;
          margin-left: auto;
          flex-shrink: 0;
          opacity: 0.55;
          transition: opacity var(--fast, 0.15s ease);
        }
        .avail-row:hover .avail-actions,
        .avail-row:focus-within .avail-actions {
          opacity: 1;
        }
        .btn-icon.sm {
          width: 28px;
          height: 28px;
        }
        .btn-icon.danger:hover {
          color: var(--accent-red);
          background: rgba(239, 68, 89, 0.12);
        }
        .avail-sync {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          color: var(--muted);
          font-size: 0.74rem;
          white-space: nowrap;
        }
        @media (max-width: 640px) {
          .avail-actions { opacity: 1; }
          .avail-type { display: none; }
        }
        .sync-moved {
          margin: 0.4rem 0 0;
        }
        .sync-moved a {
          color: var(--accent);
          text-decoration: underline;
        }
        .btn-bilan {
          border: 1px solid var(--accent);
          color: var(--accent-light);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.78rem;
          font-weight: 600;
          text-decoration: none;
          white-space: nowrap;
        }
        .btn-bilan.done {
          border-color: rgba(61, 214, 140, 0.4);
          color: var(--accent-green);
        }
        .btn-remove {
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          padding: 0;
        }
        .btn-remove:hover { background: rgba(239, 68, 89, 0.12); }
        .btn-remove:hover {
          color: var(--accent-red);
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
        .btn-link-more {
          background: none;
          border: none;
          color: var(--accent, #2563eb);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0.6rem 0;
          margin-top: 0.2rem;
        }
        .btn-link-more:hover {
          text-decoration: underline;
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
              <p><strong>{t('agenda.briefSummaryLabel', locale)}</strong> {frenchTypography(brief.resume_historique)}</p>
              {brief.profil_personnalite && <p><strong>{t('agenda.briefPersonalityLabel', locale)}</strong> {frenchTypography(brief.profil_personnalite)}</p>}
              {brief.objections_deja_soulevees?.length > 0 && (
                <p><strong>{t('agenda.briefObjectionsLabel', locale)}</strong> {frenchTypography(brief.objections_deja_soulevees.join(' · '))}</p>
              )}
              {brief.info_entreprise && <p><strong>{t('agenda.briefCompanyLabel', locale)}</strong> {frenchTypography(brief.info_entreprise)}</p>}
              <p><strong>{t('agenda.briefApproachLabel', locale)}</strong> {frenchTypography(brief.angle_approche_suggere)}</p>
              {brief.points_attention?.length > 0 && (
                <ul>
                  {brief.points_attention.map((point, i) => <li key={i}>{frenchTypography(point)}</li>)}
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
    { key: 'indisponibilite', label: t('agenda.kindUnavailability', locale), icon: <CalendarOff size={20} strokeWidth={2} aria-hidden="true" /> },
    { key: 'telephonique', label: t('agenda.kindPhone', locale), icon: <Phone size={20} strokeWidth={2} aria-hidden="true" /> },
    { key: 'visio', label: t('agenda.kindVideo', locale), icon: <Video size={20} strokeWidth={2} aria-hidden="true" /> },
    { key: 'physique', label: t('agenda.kindInPerson', locale), icon: <Handshake size={20} strokeWidth={2} aria-hidden="true" /> },
  ];
}

// Formate une Date en 'YYYY-MM-DD' pour préremplir un <input type="date">.
function toDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Retour d'Alex (25/08/2026) sur le formulaire "Ajouter dans l'agenda" :
// "quand on choisit une indisponibilité, un calendrier apparaît [...] mais
// penses à bien séparer entre les mois [...] car là on ne distingue pas bien
// les mois entre eux" — c'était le sélecteur de date NATIF du navigateur
// (<input type="date">), dont l'apparence dépend entièrement du navigateur/OS
// et qu'on ne peut pas restyler en CSS. On le remplace ici par un vrai
// composant, sur le même principe que MonthCalendar (un seul mois affiché à
// la fois, en-tête "Mois Année" bien visible, flèches précédent/suivant) —
// même logique visuelle qu'Alex avait déjà validée pour le calendrier
// principal de l'agenda.
function SimpleDatePicker({ value, onChange }) {
  const [locale] = useLocale();
  const MONTH_LABELS = monthLabelsFor(locale);
  const WEEKDAY_LABELS = weekdayLabelsFor(locale);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selectedDate = value ? new Date(`${value}T00:00:00`) : null;
  const [viewMonth, setViewMonth] = useState(() => selectedDate || new Date());

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Retour d'Alex (25/08/2026) : choisir le 15 septembre comme date de début
  // puis ouvrir le sélecteur de date de fin ne doit pas retomber sur le mois
  // du jour (août) — "ça perturbe et on est obligé de scroller à chaque
  // fois". `viewMonth` doit donc suivre `value` quand celui-ci change depuis
  // l'extérieur (voir la synchronisation date de début -> date de fin dans
  // AddEntryModal), pas seulement à l'ouverture initiale du composant.
  useEffect(() => {
    if (selectedDate) setViewMonth(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));

  const displayLabel = selectedDate
    ? selectedDate.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : t('agenda.pickDatePlaceholder', locale);

  return (
    <div className="simple-date-picker" ref={wrapRef}>
      <button type="button" className="date-trigger" onClick={() => setOpen((o) => !o)}>
        <CalendarIcon size={15} strokeWidth={2} aria-hidden="true" /> {displayLabel}
      </button>
      {open && (
        <div className="date-popover">
          <div className="cal-header">
            <button type="button" onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))} aria-label={t('common.back', locale)}>‹</button>
            <span>{MONTH_LABELS[monthIndex]} {year}</span>
            <button type="button" onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))} aria-label={t('tour.next', locale)}>›</button>
          </div>
          <div className="cal-grid cal-weekdays">
            {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="cal-grid">
            {cells.map((day, i) => {
              if (!day) return <span key={i} className="cal-cell empty" />;
              const dateStr = toDateInputValue(day);
              const isSelected = value === dateStr;
              return (
                <button
                  type="button"
                  key={i}
                  className={`cal-cell${isSelected ? ' selected' : ''}`}
                  onClick={() => { onChange(dateStr); setOpen(false); }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <style jsx>{`
        .simple-date-picker {
          position: relative;
        }
        .date-trigger {
          width: 100%;
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          padding: 0.55rem 0.7rem;
          font-size: 0.85rem;
          cursor: pointer;
        }
        .date-popover {
          position: absolute;
          top: calc(100% + 0.4rem);
          left: 0;
          z-index: 60;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          padding: 0.8rem;
          width: 280px;
        }
        .cal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.88rem;
          font-weight: 600;
          margin-bottom: 0.7rem;
          text-transform: capitalize;
        }
        .cal-header button {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          width: 26px;
          height: 26px;
          cursor: pointer;
        }
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.2rem;
        }
        .cal-weekdays {
          margin-bottom: 0.3rem;
          font-size: 0.68rem;
          color: var(--muted);
          text-align: center;
        }
        .cal-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 0.76rem;
          cursor: pointer;
        }
        .cal-cell.empty {
          background: transparent;
          border: none;
          cursor: default;
        }
        .cal-cell.selected {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.18);
        }
        .cal-cell:not(.empty):hover {
          border-color: var(--accent);
        }
      `}</style>
    </div>
  );
}

// Même retour d'Alex : le sélecteur d'heure natif (<input type="time">)
// s'affiche, selon le navigateur, comme deux colonnes de chiffres sans
// étiquette ("on ne sait pas à quoi correspondent ces 2 colonnes de
// nombres") — remplacé ici par deux menus déroulants clairement étiquetés
// "Heures" / "Minutes", combinés vers le même format "HH:MM" qu'utilisait
// déjà <input type="time"> (aucun changement nécessaire côté logique de
// soumission du formulaire).
function TimeSelectField({ value, onChange }) {
  const [locale] = useLocale();
  const [hours, minutes] = value ? value.split(':') : ['', ''];

  function update(nextHours, nextMinutes) {
    if (nextHours === '' || nextMinutes === '') {
      onChange('');
      return;
    }
    onChange(`${nextHours}:${nextMinutes}`);
  }

  return (
    <div className="time-select-field">
      <div className="time-select-col">
        <span className="time-select-label">{t('agenda.hoursLabel', locale)}</span>
        <select value={hours} onChange={(e) => update(e.target.value, minutes || '00')}>
          <option value="" disabled>--</option>
          {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      </div>
      <span className="time-select-sep">:</span>
      <div className="time-select-col">
        <span className="time-select-label">{t('agenda.minutesLabel', locale)}</span>
        <select value={minutes} onChange={(e) => update(hours || '00', e.target.value)}>
          <option value="" disabled>--</option>
          {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <style jsx>{`
        .time-select-field {
          display: flex;
          align-items: flex-end;
          gap: 0.35rem;
        }
        .time-select-col {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .time-select-label {
          font-size: 0.68rem;
          color: var(--muted);
        }
        .time-select-col select {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          padding: 0.55rem 0.5rem;
          font-size: 0.85rem;
        }
        .time-select-sep {
          padding-bottom: 0.6rem;
          color: var(--muted);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
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
  // docx AGENDA A2 : depuis "+RDV ce jour", ne pas re-proposer "indisponibilité"
  // (un bouton dédié existe déjà juste à côté dans le panneau du jour).
  const ENTRY_KINDS = entryKindsFor(locale).filter((k) => !(preset?.hideUnavailability && k.key === 'indisponibilite'));
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
                <SimpleDatePicker
                  value={date}
                  onChange={(newDate) => {
                    // Retour d'Alex (25/08/2026) : la date de fin doit suivre
                    // la date de début tant que le commercial ne l'a pas
                    // modifiée lui-même — évite de retomber sur le mois du
                    // jour en ouvrant le sélecteur de fin juste après.
                    setDate(newDate);
                    if (kind === 'indisponibilite') {
                      setEndDate((prevEnd) => (!prevEnd || prevEnd === date ? newDate : prevEnd));
                    }
                  }}
                />
              </label>
              <label>
                {t('agenda.timeLabel', locale)}
                <TimeSelectField value={time} onChange={setTime} />
              </label>
            </div>

            {kind === 'indisponibilite' && (
              <div className="date-row">
                <label>
                  {t('agenda.endLabel', locale)}
                  <SimpleDatePicker value={endDate} onChange={setEndDate} />
                </label>
                <label>
                  {t('agenda.timeLabel', locale)}
                  <TimeSelectField value={endTime} onChange={setEndTime} />
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
              {/* docx AGENDA A2 : si le type était préréglé (ex. "Ajouter une
                  indisponibilité" depuis le panneau du jour), "Retour" doit
                  fermer la fenêtre — pas re-proposer un choix de type qui
                  n'a jamais été affiché à l'utilisateur. */}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => (preset?.kind ? onClose() : setKind(null))}
              >
                {t('common.back', locale)}
              </button>
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
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(75, 57, 239, 0.14);
          color: var(--accent-light);
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

function Shell({ children, active, userId, onNotificationsChanged, onNotificationContact }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  // Docx « derniers ajouts » (05/09/2026) : « Mon équipe » disparaissait
  // 1–2 s à chaque changement de rubrique, le temps que /api/preferences
  // réponde, puis réapparaissait. On relit d'abord le rôle mémorisé lors de
  // la dernière réponse (par utilisateur), puis la réponse le confirme : la
  // rubrique est là dès le premier rendu et ne bouge plus.
  useEffect(() => {
    if (!userId) return;
    try {
      const cached = window.localStorage.getItem(`aaron_role:${userId}`);
      if (cached) setUserRole(cached);
    } catch {
      // stockage indisponible : on attend simplement la réponse réseau
    }
  }, [userId]);
  // Docx Modifs Aaron (30/08/2026) : la rubrique Clients est réservée au
  // compte aaron@meetaaron.app (supprimée pour tous les autres comptes,
  // fondateur comme commercial) — même logique "fermé par défaut" que
  // userRole ci-dessus. Produits est retiré pour tout le monde, et
  // Suggestions devient un onglet de Mon équipe (voir app/app/team/page.jsx).
  const [userEmail, setUserEmail] = useState(null);
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
        setUserRole(prefs.role || null);
        try {
          window.localStorage.setItem(`aaron_role:${userId}`, prefs.role || '');
        } catch {
          // idem : best effort
        }
        setUserEmail(prefs.email || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
  ];
  return (
    <div className="shell">
      {/* Habillage téléphone/tablette : barre du haut + barre d'onglets du
          bas (components/MobileChrome.jsx, styles dans app/globals.css) —
          remplace l'ancien bouton hamburger flottant (docx 30/08, item 8). */}
      <MobileChrome
        title={active}
        items={NAV_ITEMS}
        userId={userId}
        onMenu={() => setMobileOpen(true)}
        menuLabel={t('shell.openMenu', locale)}
        moreLabel={t('shell.more', locale)}
        locale={locale}
      />
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
            <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon"><NavIcon slug="logout" /></span>
            <span className="nav-label">{t('common.logout', locale)}</span>
          </button>
        </div>
      </nav>
      <main className="content">
        {/* Notifications « bulles » en haut de CHAQUE page, toujours au même
            endroit (demande Alex, 03/09/2026). Avant, le bandeau n'existait
            que sur Tableau de bord et Contacts, et la cloche du rail était
            invisible sous 901px : sur téléphone, un commercial ne voyait donc
            AUCUNE notification tant qu'il n'était pas sur l'une de ces deux
            pages. Placé ici, dans le Shell, la position est identique partout
            et sur tous les écrans.
            Coût nul quand il n'y a rien à traiter : Stories rend `null` si
            aucun groupe n'est en attente (voir components/Stories.jsx), donc
            aucune page ne perd de hauteur utile. */}
        <Stories userId={userId} locale={locale} onChanged={onNotificationsChanged} onOpenContact={onNotificationContact} />
        {children}
      </main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: var(--tint-7);
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
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
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
          box-shadow: 0 0 0 1px var(--tint-8), 0 4px 14px rgba(75, 57, 239, 0.35);
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
          background: var(--tint-4);
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
          min-width: 0;
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
          .today-hero {
            flex-direction: column;
            gap: 0.9rem;
            padding: 1.1rem 1.1rem;
          }
          .today-next {
            padding-left: 0;
            border-left: 0;
            padding-top: 0.9rem;
            border-top: 1px solid rgba(244, 241, 234, 0.12);
          }

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
