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

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

function useAuthedUser() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [userId, setUserId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('user_id') || null; } catch { return null; }
  });

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
      try {
        const body = await res.json();
        if (body?.user?.id) setUserId(body.user.id);
      } catch {}
      setReady(true);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { ready, authError, userId };
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

// ORDRE DES QUATRE ISSUES SELON LE RESSENTI (22/09/2026, remarque d'Alex).
//
// L'ordre etait fige : « a continuer » toujours en premier, « perdu »
// toujours en dernier. Apres avoir clique « Mal passe », le commercial
// voyait donc en tete de liste la carte la moins probable, et devait
// descendre jusqu'en bas pour trouver la bonne. L'ecran semblait ne pas
// l'avoir ecoute.
//
// On ne change ni les libelles ni les valeurs : seulement l'ordre
// d'affichage, pour que le choix le plus probable soit sous le pouce.
// Sans ressenti choisi, on garde l'ordre historique.
const ORDER_BY_MOOD = {
  bien: ['opportunite', 'devis', 'a_continuer', 'perdu'],
  moyen: ['a_continuer', 'devis', 'opportunite', 'perdu'],
  mal: ['perdu', 'a_continuer', 'devis', 'opportunite'],
};

function orderedChoices(locale, mood) {
  const all = choicesFor(locale);
  const order = ORDER_BY_MOOD[mood];
  if (!order) return all;
  return order.map((value) => all.find((c) => c.value === value)).filter(Boolean);
}

// Textes propres à cette page (dictionnaire local).
// Rendez-vous sans contact rattache (Alex, 30/10/2026 : « j'ai place un RDV
// en perdu, mais ou est passe ce contact ? »). Le RDV avait ete saisi avec un
// simple nom — il n'existait aucune fiche a faire passer en perdu. Le bilan
// etait bien enregistre, Aaron repondait, et rien ne disait que le fichier
// n'avait pas bouge. On le dit maintenant.
const NO_CONTACT_NOTICE = {
  fr: "Ce rendez-vous n'est rattaché à aucun contact de ton fichier — il avait été saisi avec un simple nom. Le bilan est enregistré sur le rendez-vous, mais aucune fiche n'a été mise à jour.",
  en: 'This meeting is not linked to any contact in your list — it was entered with just a name. The outcome is saved on the meeting, but no contact record was updated.',
  de: 'Dieser Termin ist mit keinem Kontakt aus deiner Liste verknüpft — er wurde nur mit einem Namen angelegt. Das Ergebnis ist am Termin gespeichert, aber es wurde kein Kontakt aktualisiert.',
  it: "Questo appuntamento non è collegato a nessun contatto della tua lista — era stato inserito con un semplice nome. L'esito è registrato sull'appuntamento, ma nessuna scheda è stata aggiornata.",
  es: 'Esta cita no está vinculada a ningún contacto de tu lista — se creó solo con un nombre. El resultado queda guardado en la cita, pero no se actualizó ninguna ficha.',
  pt: 'Esta reunião não está associada a nenhum contacto da tua lista — foi criada apenas com um nome. O resultado fica guardado na reunião, mas nenhuma ficha foi atualizada.',
  nl: 'Deze afspraak is aan geen enkel contact uit je lijst gekoppeld — ze is met alleen een naam aangemaakt. De uitkomst is bij de afspraak opgeslagen, maar er is geen contactfiche bijgewerkt.',
};

const THANK_YOU_PENDING = {
  fr: "Aaron rédige et envoie l'email de remerciement…",
  en: 'Aaron is writing and sending the thank-you email…',
  de: 'Aaron schreibt und sendet die Dankes-E-Mail…',
  it: "Aaron sta scrivendo e inviando l'email di ringraziamento…",
  es: 'Aaron está redactando y enviando el email de agradecimiento…',
  pt: 'O Aaron está a escrever e enviar o email de agradecimento…',
  nl: 'Aaron schrijft en verstuurt de bedank-e-mail…',
};

export default function BilanRdvPage(props) {
  const params = use(props.params);
  const [locale] = useLocale();
  const { ready, authError, userId } = useAuthedUser();
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [mood, setMood] = useState(null); // 'bien' | 'moyen' | 'mal'
  const CHOICES = orderedChoices(locale, mood);
  const [outcome, setOutcome] = useState(null);
  // null = pas encore enregistre ; false = aucune fiche contact mise a jour.
  const [contactUpdated, setContactUpdated] = useState(null);
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

  // SORTIE (28/10/2026, Alex : « quand je clique sur Terminé rien ne se
  // passe »). router.push() chargeait la page Agenda en silence, parfois
  // plusieurs secondes sans aucun signe. Désormais : le bouton change tout
  // de suite, et on fait une vraie navigation (barre de chargement du
  // navigateur) vers la page d'où l'on vient — tableau de bord ou agenda —
  // avec l'identifiant déjà dans l'adresse pour qu'elle s'ouvre plus vite.
  const [leaving, setLeaving] = useState(false);
  function leave() {
    if (leaving) return;
    setLeaving(true);
    let target = `/app/agenda${userId ? `?user_id=${userId}` : ''}`;
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === window.location.origin && /^\/app\/(dashboard|agenda|prospects)/.test(ref.pathname)) {
        target = ref.pathname + ref.search;
      }
    } catch {}
    window.location.assign(target);
  }

  async function handleSubmit() {
    if (submitting || !outcome) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/appointments/${params.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, mood, context: context.trim() || null, send_thank_you: sendThankYou && appointment?.can_send_thank_you !== false }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error || t('bilanRdv.genericError', locale));
      } else {
        // 28/10/2026 : le serveur répond tout de suite avec la note générique ;
        // la note personnalisée d'Aaron et l'email de remerciement arrivent en
        // arrière-plan. On relit le RDV à 4 s, 10 s et 20 s pour les afficher.
        setNote(body.note);
        if (body.contact_updated === false) setContactUpdated(false);
        const wantsThankYou = sendThankYou && appointment?.can_send_thank_you !== false;
        if (wantsThankYou) setThankYouStatus('pending');
        setAppointment((prev) => (prev ? { ...prev, outcome } : prev));
        const initialNote = body.note;
        let settled = false;
        for (const delay of [4000, 10000, 20000]) {
          setTimeout(async () => {
            if (settled) return;
            try {
              const r = await fetch(`/api/appointments/${params.id}`);
              const a = await r.json();
              if (!r.ok) return;
              if (a.outcome_note && a.outcome_note !== initialNote) setNote(a.outcome_note);
              if (wantsThankYou) {
                if (a.thank_you_sent_at) { setThankYouStatus('sent'); settled = true; }
                else if (a.thank_you_error) { setThankYouStatus('failed'); settled = true; }
                else if (delay === 20000) setThankYouStatus(null);
              } else if (a.outcome_note && a.outcome_note !== initialNote) {
                settled = true;
              }
            } catch {}
          }, delay);
        }
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
        <button
          type="button"
          onClick={leave}
          aria-label={t('bilanRdv.close', locale)}
          title={t('bilanRdv.close', locale)}
          style={styles.closeBtn}
        >
          <Ic name="x" size={16} />
        </button>

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

            {appointment?.can_send_thank_you !== false && (
            <label style={styles.checkRow}>
              <input type="checkbox" checked={sendThankYou} onChange={(e) => setSendThankYou(e.target.checked)} style={{ accentColor: '#4b39ef', width: 18, height: 18 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{t('bilanRdv.thankYouLabel', locale)}</span>
                <span style={{ display: 'block', color: '#8b90a8', fontSize: 13, marginTop: 2 }}>{t('bilanRdv.thankYouHint', locale)}</span>
              </span>
            </label>
            )}

            <button type="button" onClick={handleSubmit} disabled={submitting || !outcome} style={{ ...styles.submit, opacity: submitting || !outcome ? 0.55 : 1 }}>
              {submitting ? t('bilanRdv.submitting', locale) : t('bilanRdv.submit', locale)}
            </button>
            {!outcome && <p style={styles.hint}>{t('bilanRdv.pickNextHint', locale)}</p>}
          </>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        {contactUpdated === false && (
          <p style={styles.noContactNotice}>{NO_CONTACT_NOTICE[locale] || NO_CONTACT_NOTICE.fr}</p>
        )}

        {note && (
          <div style={styles.noteBox}>
            <p style={styles.noteLabel}>{t('bilanRdv.aaronLabel', locale)}</p>
            <p style={styles.noteText}>{note}</p>
          </div>
        )}
        {thankYouStatus === 'pending' && <p style={styles.muted}>{THANK_YOU_PENDING[locale] || THANK_YOU_PENDING.fr}</p>}
        {thankYouStatus === 'sent' && <p style={styles.okText}>{t('bilanRdv.thankYouSent', locale)}</p>}
        {thankYouStatus === 'failed' && <p style={styles.errorText}>{t('bilanRdv.thankYouFailed', locale)}</p>}

        {/* SORTIE DE PAGE (18/09/2026, signalee par Alex : « je ne peux pas
            quitter cette page »). Une fois le bilan enregistre, le formulaire
            est remplace par la note d'Aaron — et il n'y avait plus AUCUN
            moyen de partir : ni bouton, ni lien, ni redirection. Seul le
            bouton Retour du navigateur s'en sortait, ce qui n'existe pas dans
            l'app installee en PWA sur telephone.
            Deux sorties desormais : la croix en haut a droite de la carte,
            toujours presente (y compris avant enregistrement, pour abandonner
            sans rien casser), et ce bouton « Termine » une fois le bilan
            enregistre. Les deux ramenent a l'agenda. */}
        {note && (
          <button type="button" onClick={leave} disabled={leaving} style={{ ...styles.doneBtn, opacity: leaving ? 0.7 : 1 }}>
            <Ic name="check" size={16} /> {leaving ? t('common.loading', locale) : t('bilanRdv.done', locale)}
          </button>
        )}
      </div>
    </div>
  );
}

// Couleurs = les variables CSS de l'app (--bg, --surface, --text, --muted,
// --border), avec la valeur sombre en repli. Cette page n'a pas de bloc
// :root à elle (styles inline), donc en thème sombre les variables sont
// absentes et le repli s'applique ; en mode clair, globals.css les définit
// sur html[data-theme='light'] et la page suit le thème. Avant (08/09/2026),
// les valeurs étaient écrites en dur : cette page restait sombre en mode
// clair — la seule de l'app hors visite guidée.
const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg, #0b0e1a)',
    padding: 24,
  },
  card: {
    maxWidth: 480,
    width: '100%',
    background: 'var(--surface, #131629)',
    borderRadius: 16,
    padding: 28,
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: 'var(--muted, #8b90a8)',
    cursor: 'pointer',
    lineHeight: 0,
  },
  doneBtn: {
    width: '100%',
    marginTop: 18,
    padding: '13px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: '#4b39ef',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  title: {
    color: 'var(--text, #f4f1ea)',
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
    border: '1px solid var(--border, #232744)',
    background: 'var(--surface-hover, #1a1e35)',
    color: 'var(--text, #f4f1ea)',
    fontSize: 15,
    textAlign: 'left',
    cursor: 'pointer',
  },
  stepLabel: {
    color: 'var(--muted, #8b90a8)',
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
    border: '1px solid var(--border, #232744)',
    background: 'var(--surface-hover, #1a1e35)',
    color: 'var(--text, #f4f1ea)',
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
    border: '1px solid var(--border, #232744)',
    background: 'transparent',
    color: 'var(--text, #c9c6d8)',
    fontSize: 12.5,
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg, #0b0e1a)',
    border: '1px solid var(--border, #232744)',
    borderRadius: 10,
    color: 'var(--text, #f4f1ea)',
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
    color: 'var(--text, #f4f1ea)',
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
    color: 'var(--muted, #8b90a8)',
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
    background: 'var(--surface-hover, #1a1e35)',
  },
  noteLabel: {
    color: 'var(--muted, #8b90a8)',
    fontSize: 12,
    marginBottom: 4,
  },
  noteText: {
    color: 'var(--text, #f4f1ea)',
    fontSize: 15,
    lineHeight: 1.5,
  },
  muted: {
    color: 'var(--muted, #8b90a8)',
  },
  errorText: {
    color: '#e5484d',
    marginTop: 12,
  },
  // Avertissement « aucune fiche contact mise à jour » : informatif, pas une
  // erreur — le bilan EST enregistré. Ton ambre plutôt que rouge.
  noContactNotice: {
    marginTop: 14,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(245, 166, 35, 0.35)',
    background: 'rgba(245, 166, 35, 0.10)',
    color: 'var(--text, #f4f1ea)',
    fontSize: 13,
    lineHeight: 1.45,
  },
};
