// app/app/agenda/rdv/[id]/bilan/page.jsx
// Page ouverte depuis la notification "Comment s'est passé le RDV ?"
// (voir app/api/cron/appointment-feedback-prompts) ou depuis l'agenda.
// Docx Modifs Aaron 30/08/2026, items 3 et 7 : brief post-RDV en 4 temps —
// 1) ressenti (bien / moyen / mal), 2) la suite (à continuer / opportunité /
// demande de devis / perdu), 3) contexte par chips ou texte libre ("points
// communs sur les abeilles", "je lui envoie le devis dans la journée"...),
// 4) case « Aaron envoie un email de remerciement » (cochée par défaut).
// Aaron enregistre le bilan, réagit, et envoie l'email (lib/appointment-outcome.ts).

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

function useAuthedUser() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
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

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Voir la même logique dans useAuthedUser des autres pages —
          // compte valide mais profil Meet Aaron pas encore créé (paiement
          // Stripe non terminé, ou invitation commerciale pas encore
          // rejointe) : on renvoie vers /onboarding plutôt que d'afficher un
          // message d'erreur sans issue.
          router.push('/onboarding');
          return;
        }
        // Voir la même logique dans useAuthedUser des autres pages — cas réel
        // remonté par Alex (2026-08-19) : une session que le client croyait
        // valide mais que le serveur rejette quand même laissait la page
        // affichée sans rien pouvoir faire ni se déconnecter. On nettoie la
        // session locale et on renvoie vers /login plutôt que d'afficher un
        // message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }
      setReady(true);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { ready, authError };
}

// CHANGEMENTS A FAIRE #6 (2026-08-15) : "opportunité" et "demande de devis"
// amènent la même réaction d'Aaron (voir lib/appointment-outcome.ts) — deux
// choix distincts car ils ne démarrent pas à la même étape du pipeline.
function choicesFor(locale) {
  return [
    { value: 'a_continuer', label: t('bilanRdv.choiceContinuer', locale), emoji: <Ic name="smile" size={16} /> },
    { value: 'opportunite', label: t('bilanRdv.choiceOpportunite', locale), emoji: <Ic name="party" size={16} /> },
    { value: 'devis', label: t('bilanRdv.choiceDevis', locale), emoji: <Ic name="file" size={16} /> },
    { value: 'perdu', label: t('bilanRdv.choicePerdu', locale), emoji: <Ic name="frown" size={16} /> },
  ];
}

export default function BilanRdvPage({ params }) {
  const [locale] = useLocale();
  const { ready, authError } = useAuthedUser();
  const CHOICES = choicesFor(locale);
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [mood, setMood] = useState(null); // 'bien' | 'moyen' | 'mal'
  const [outcome, setOutcome] = useState(null);
  const [context, setContext] = useState('');
  const [sendThankYou, setSendThankYou] = useState(true);
  const [thankYouStatus, setThankYouStatus] = useState(null); // 'sent' | 'failed' | null
  const MOODS = [
    { value: 'bien', label: t('bilanRdv.moodBien', locale), emoji: <Ic name="smile" size={22} /> },
    { value: 'moyen', label: t('bilanRdv.moodMoyen', locale), emoji: <Ic name="meh" size={22} /> },
    { value: 'mal', label: t('bilanRdv.moodMal', locale), emoji: <Ic name="frown" size={22} /> },
  ];
  const CHIPS = [
    t('bilanRdv.chipCommonGround', locale),
    t('bilanRdv.chipQuoteToday', locale),
    t('bilanRdv.chipNextStepSet', locale),
    t('bilanRdv.chipTeamDecision', locale),
    t('bilanRdv.chipComparing', locale),
    t('bilanRdv.chipBadTiming', locale),
  ];
  function addChip(text) {
    setContext((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
  }

  useEffect(() => {
    if (!ready || authError) return;

    fetch(`/api/appointments/${params.id}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
        } else {
          setAppointment(body);
          if (body.outcome) setNote(body.outcome_note);
        }
      })
      .finally(() => setLoading(false));
  }, [ready, authError, params.id]);

  async function handleSubmit() {
    if (submitting || !outcome) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/appointments/${params.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, mood, context: context.trim() || null, send_thank_you: sendThankYou }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error || t('bilanRdv.genericError', locale));
      } else {
        setNote(body.note);
        if (sendThankYou) setThankYouStatus(body.thank_you_sent ? 'sent' : 'failed');
        setAppointment((prev) => (prev ? { ...prev, outcome } : prev));
      }
    } catch (err) {
      setError(t('bilanRdv.networkError', locale));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || loading) {
    return <div style={styles.page}><p style={styles.muted}>{t('common.loading', locale)}</p></div>;
  }

  if (authError || error && !appointment) {
    return <div style={styles.page}><p style={styles.muted}>{authError || error}</p></div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>
          {appointment?.prospect_full_name
            ? t('bilanRdv.titleWithName', locale).replace('{name}', appointment.prospect_full_name)
            : t('bilanRdv.titleGeneric', locale)}
        </h1>

        {!appointment?.outcome && (
          <>
            <p style={styles.stepLabel}>{t('bilanRdv.moodLabel', locale)}</p>
            <div style={styles.moodRow}>
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMood(m.value)}
                  style={{ ...styles.moodButton, ...(mood === m.value ? styles.selected : {}) }}
                >
                  <span style={{ display: 'inline-flex' }}>{m.emoji}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            <p style={styles.stepLabel}>{t('bilanRdv.nextLabel', locale)}</p>
            <div style={styles.choices}>
              {CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setOutcome(choice.value)}
                  style={{ ...styles.choiceButton, ...(outcome === choice.value ? styles.selected : {}) }}
                >
                  <span style={{ marginRight: 8 }}>{choice.emoji}</span>
                  {choice.label}
                </button>
              ))}
            </div>

            <p style={styles.stepLabel}>{t('bilanRdv.contextLabel', locale)}</p>
            <div style={styles.chips}>
              {CHIPS.map((chip) => (
                <button key={chip} type="button" onClick={() => addChip(chip)} style={styles.chip}>
                  + {chip}
                </button>
              ))}
            </div>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t('bilanRdv.contextPlaceholder', locale)}
              rows={3}
              style={styles.textarea}
            />

            <label style={styles.checkRow}>
              <input type="checkbox" checked={sendThankYou} onChange={(e) => setSendThankYou(e.target.checked)} style={{ accentColor: '#4b39ef', width: 18, height: 18 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{t('bilanRdv.thankYouLabel', locale)}</span>
                <span style={{ display: 'block', color: '#8b90a8', fontSize: 13, marginTop: 2 }}>{t('bilanRdv.thankYouHint', locale)}</span>
              </span>
            </label>

            <button type="button" onClick={handleSubmit} disabled={submitting || !outcome} style={{ ...styles.submit, opacity: submitting || !outcome ? 0.55 : 1 }}>
              {submitting ? t('bilanRdv.submitting', locale) : t('bilanRdv.submit', locale)}
            </button>
            {!outcome && <p style={styles.hint}>{t('bilanRdv.pickNextHint', locale)}</p>}
          </>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        {note && (
          <div style={styles.noteBox}>
            <p style={styles.noteLabel}>{t('bilanRdv.aaronLabel', locale)}</p>
            <p style={styles.noteText}>{note}</p>
          </div>
        )}
        {thankYouStatus === 'sent' && <p style={styles.okText}>{t('bilanRdv.thankYouSent', locale)}</p>}
        {thankYouStatus === 'failed' && <p style={styles.errorText}>{t('bilanRdv.thankYouFailed', locale)}</p>}
      </div>
    </div>
  );
}

// Couleurs alignées sur les variables CSS utilisées partout ailleurs dans
// l'app (--bg, --surface, --text, --muted, --border) — avant, cette page
// (atteinte depuis une notification de rappel de bilan post-RDV) utilisait
// des teintes légèrement différentes, ce qui créait un changement de fond
// perceptible en y arrivant depuis le reste de l'app.
const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0b0e1a',
    padding: 24,
  },
  card: {
    maxWidth: 480,
    width: '100%',
    background: '#131629',
    borderRadius: 16,
    padding: 28,
  },
  title: {
    color: '#f4f1ea',
    fontSize: 20,
    marginBottom: 20,
    lineHeight: 1.4,
  },
  choices: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  choiceButton: {
    padding: '14px 16px',
    borderRadius: 10,
    border: '1px solid #232744',
    background: '#1a1e35',
    color: '#f4f1ea',
    fontSize: 15,
    textAlign: 'left',
    cursor: 'pointer',
  },
  stepLabel: {
    color: '#8b90a8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '18px 0 8px',
  },
  moodRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  moodButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '12px 6px',
    borderRadius: 10,
    border: '1px solid #232744',
    background: '#1a1e35',
    color: '#f4f1ea',
    fontSize: 13,
    cursor: 'pointer',
  },
  selected: {
    borderColor: '#7c6ef5',
    background: 'rgba(75, 57, 239, 0.18)',
    boxShadow: '0 0 0 2px rgba(124, 110, 245, 0.35)',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid #232744',
    background: 'transparent',
    color: '#c9c6d8',
    fontSize: 12.5,
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#0b0e1a',
    border: '1px solid #232744',
    borderRadius: 10,
    color: '#f4f1ea',
    padding: '10px 12px',
    fontSize: 16,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    color: '#f4f1ea',
    fontSize: 14,
    cursor: 'pointer',
  },
  submit: {
    marginTop: 18,
    width: '100%',
    padding: '13px 16px',
    borderRadius: 10,
    border: 'none',
    background: '#4b39ef',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  hint: {
    color: '#8b90a8',
    fontSize: 12.5,
    marginTop: 8,
    textAlign: 'center',
  },
  okText: {
    color: '#3dd68c',
    marginTop: 12,
    fontSize: 14,
  },
  noteBox: {
    marginTop: 20,
    padding: 16,
    borderRadius: 10,
    background: '#1a1e35',
  },
  noteLabel: {
    color: '#8b90a8',
    fontSize: 12,
    marginBottom: 4,
  },
  noteText: {
    color: '#f4f1ea',
    fontSize: 15,
    lineHeight: 1.5,
  },
  muted: {
    color: '#8b90a8',
  },
  errorText: {
    color: '#e5484d',
    marginTop: 12,
  },
};
