// app/app/agenda/rdv/[id]/bilan/page.jsx
// Page ouverte depuis la notification "Comment s'est passé le RDV ?"
// (voir app/api/cron/appointment-feedback-prompts). Le commercial choisit une
// des 4 réponses, Aaron enregistre le bilan et réagit (lib/appointment-outcome.ts).

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale } from '@/lib/i18n';

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
        const body = await res.json();
        setAuthError(body.error || 'Accès refusé');
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
    { value: 'a_continuer', label: t('bilanRdv.choiceContinuer', locale), emoji: '🙂' },
    { value: 'opportunite', label: t('bilanRdv.choiceOpportunite', locale), emoji: '🎉' },
    { value: 'devis', label: t('bilanRdv.choiceDevis', locale), emoji: '📄' },
    { value: 'perdu', label: t('bilanRdv.choicePerdu', locale), emoji: '😕' },
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

  async function handleChoice(value) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/appointments/${params.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: value }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error || t('bilanRdv.genericError', locale));
      } else {
        setNote(body.note);
        setAppointment((prev) => (prev ? { ...prev, outcome: value } : prev));
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
          <div style={styles.choices}>
            {CHOICES.map((choice) => (
              <button
                key={choice.value}
                onClick={() => handleChoice(choice.value)}
                disabled={submitting}
                style={styles.choiceButton}
              >
                <span style={{ marginRight: 8 }}>{choice.emoji}</span>
                {choice.label}
              </button>
            ))}
          </div>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        {note && (
          <div style={styles.noteBox}>
            <p style={styles.noteLabel}>{t('bilanRdv.aaronLabel', locale)}</p>
            <p style={styles.noteText}>{note}</p>
          </div>
        )}
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
