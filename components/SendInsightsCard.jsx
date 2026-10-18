'use client';
// components/SendInsightsCard.jsx
// « Ce qu'Aaron a appris » (validé par Alex le 18/10/2026) : taux de réponse
// par créneau d'envoi sur ce compte, et le créneau qu'Aaron en a tiré. Les
// chiffres viennent de /api/send-insights (lib/send-insights.ts). Deux
// variantes : `compact` (une phrase, pour le tableau de bord) et complète
// (phrase + barres par tranche horaire et par jour, pour Mes résultats).
//
// Règle de ton : on ne dit rien tant qu'il n'y a pas assez d'envois. Une
// phrase fondée sur 12 emails ferait plus de mal que de bien.
import { useEffect, useState } from 'react';
import Ic from '@/components/UiIcon';

const TEXT = {
  fr: { title: "Ce qu'Aaron a appris", notYet: 'Pas encore assez d\'envois pour apprendre ({n} sur {min} minimum). Aaron utilise le créneau de base : lundi→vendredi, 8 h–12 h.', learnedHours: 'Tes prospects répondent {lift}× plus quand Aaron écrit entre {from} h et {to} h', learnedDays: 'et surtout le {days}', learnedDaysOnly: 'Tes prospects répondent {lift}× plus le {days}', apply: 'Aaron y concentre désormais tes envois.', flat: 'Sur {n} emails, aucune tranche ne sort du lot : Aaron garde le créneau de base (lundi→vendredi, 8 h–12 h).', byHour: 'Taux de réponse par heure d\'envoi', byDay: 'Par jour', sample: '{n} emails analysés sur {d} jours · {rate} % de réponses', days: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'], other: 'nuit', refresh: 'Recalculer' },
  en: { title: 'What Aaron has learned', notYet: 'Not enough emails yet to learn ({n} of {min} minimum). Aaron uses the default window: Monday–Friday, 8–12.', learnedHours: 'Your prospects reply {lift}× more when Aaron writes between {from} and {to}', learnedDays: 'and especially on {days}', learnedDaysOnly: 'Your prospects reply {lift}× more on {days}', apply: 'Aaron now concentrates your sends there.', flat: 'Across {n} emails no slot stands out: Aaron keeps the default window (Monday–Friday, 8–12).', byHour: 'Reply rate by send hour', byDay: 'By day', sample: '{n} emails analysed over {d} days · {rate}% replies', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], other: 'night', refresh: 'Recompute' },
  de: { title: 'Was Aaron gelernt hat', notYet: 'Noch nicht genug E-Mails zum Lernen ({n} von mindestens {min}). Aaron nutzt das Standardfenster: Montag–Freitag, 8–12 Uhr.', learnedHours: 'Ihre Interessenten antworten {lift}× öfter, wenn Aaron zwischen {from} und {to} Uhr schreibt', learnedDays: 'und vor allem am {days}', learnedDaysOnly: 'Ihre Interessenten antworten {lift}× öfter am {days}', apply: 'Aaron konzentriert Ihre Sendungen jetzt darauf.', flat: 'Bei {n} E-Mails sticht kein Zeitfenster hervor: Aaron behält das Standardfenster (Montag–Freitag, 8–12 Uhr).', byHour: 'Antwortrate nach Sendezeit', byDay: 'Nach Tag', sample: '{n} E-Mails über {d} Tage analysiert · {rate} % Antworten', days: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'], other: 'Nacht', refresh: 'Neu berechnen' },
  it: { title: 'Cosa ha imparato Aaron', notYet: 'Non ancora abbastanza email per imparare ({n} su {min} minimo). Aaron usa la fascia di base: lunedì–venerdì, 8–12.', learnedHours: 'I tuoi prospect rispondono {lift}× di più quando Aaron scrive tra le {from} e le {to}', learnedDays: 'e soprattutto il {days}', learnedDaysOnly: 'I tuoi prospect rispondono {lift}× di più il {days}', apply: 'Aaron concentra ora lì i tuoi invii.', flat: 'Su {n} email nessuna fascia spicca: Aaron mantiene la fascia di base (lunedì–venerdì, 8–12).', byHour: 'Tasso di risposta per ora di invio', byDay: 'Per giorno', sample: '{n} email analizzate su {d} giorni · {rate} % di risposte', days: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'], other: 'notte', refresh: 'Ricalcola' },
  es: { title: 'Lo que Aaron ha aprendido', notYet: 'Aún no hay suficientes emails para aprender ({n} de {min} mínimo). Aaron usa la franja base: lunes–viernes, 8–12.', learnedHours: 'Tus prospectos responden {lift}× más cuando Aaron escribe entre las {from} y las {to}', learnedDays: 'y sobre todo el {days}', learnedDaysOnly: 'Tus prospectos responden {lift}× más el {days}', apply: 'Aaron concentra ahí tus envíos a partir de ahora.', flat: 'En {n} emails ninguna franja destaca: Aaron mantiene la franja base (lunes–viernes, 8–12).', byHour: 'Tasa de respuesta por hora de envío', byDay: 'Por día', sample: '{n} emails analizados en {d} días · {rate} % de respuestas', days: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'], other: 'noche', refresh: 'Recalcular' },
  pt: { title: 'O que o Aaron aprendeu', notYet: 'Ainda não há emails suficientes para aprender ({n} de {min} no mínimo). O Aaron usa a faixa base: segunda–sexta, 8–12.', learnedHours: 'Os teus prospects respondem {lift}× mais quando o Aaron escreve entre as {from} e as {to}', learnedDays: 'e sobretudo à {days}', learnedDaysOnly: 'Os teus prospects respondem {lift}× mais à {days}', apply: 'O Aaron concentra aí os teus envios a partir de agora.', flat: 'Em {n} emails nenhuma faixa se destaca: o Aaron mantém a faixa base (segunda–sexta, 8–12).', byHour: 'Taxa de resposta por hora de envio', byDay: 'Por dia', sample: '{n} emails analisados em {d} dias · {rate} % de respostas', days: ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'], other: 'noite', refresh: 'Recalcular' },
  nl: { title: 'Wat Aaron heeft geleerd', notYet: 'Nog niet genoeg e-mails om van te leren ({n} van minimaal {min}). Aaron gebruikt het standaardvenster: maandag–vrijdag, 8–12 u.', learnedHours: 'Je prospects antwoorden {lift}× vaker als Aaron tussen {from} en {to} u schrijft', learnedDays: 'en vooral op {days}', learnedDaysOnly: 'Je prospects antwoorden {lift}× vaker op {days}', apply: 'Aaron concentreert je verzendingen daar nu op.', flat: 'Over {n} e-mails springt geen tijdvak eruit: Aaron houdt het standaardvenster (maandag–vrijdag, 8–12 u).', byHour: 'Antwoordpercentage per verzenduur', byDay: 'Per dag', sample: '{n} e-mails geanalyseerd over {d} dagen · {rate} % antwoorden', days: ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'], other: 'nacht', refresh: 'Opnieuw berekenen' },
};
const tx = (locale, key) => (TEXT[locale] || TEXT.fr)[key] ?? TEXT.fr[key];
const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k]), s);
const MIN_SAMPLE = 40;

export function insightSentence(ins, locale) {
  if (!ins) return null;
  const L = TEXT[locale] || TEXT.fr;
  if (ins.sample_size < MIN_SAMPLE) return fill(L.notYet, { n: ins.sample_size, min: MIN_SAMPLE });
  const lw = ins.learned_window;
  if (!lw) return fill(L.flat, { n: ins.sample_size });
  const bestHour = (ins.by_hour || []).filter((b) => b.bucket !== 'autre' && b.sent >= 15).sort((a, b) => (b.lift || 0) - (a.lift || 0))[0];
  const bestDay = (ins.by_weekday || []).filter((d) => d.weekday <= 5 && d.sent >= 15).sort((a, b) => (b.lift || 0) - (a.lift || 0))[0];
  const hoursLearned = lw.hours && !(lw.hours.length === 1 && lw.hours[0][0] === 8 && lw.hours[0][1] === 12 && (!bestHour || (bestHour.lift || 0) < 1.25));
  const daysLearned = lw.weekdays && lw.weekdays.length < 5;
  const fmtLift = (x) => String(Math.round((x || 1) * 10) / 10).replace('.', locale === 'en' ? '.' : ',');
  const dayNames = daysLearned ? lw.weekdays.map((d) => L.days[d - 1]).join(', ') : '';
  let s = '';
  if (hoursLearned && bestHour) {
    const [from, to] = lw.hours[0];
    s = fill(L.learnedHours, { lift: fmtLift(bestHour.lift), from, to });
    if (daysLearned) s += ' ' + fill(L.learnedDays, { days: dayNames });
  } else if (daysLearned && bestDay) {
    s = fill(L.learnedDaysOnly, { lift: fmtLift(bestDay.lift), days: dayNames });
  } else {
    return fill(L.flat, { n: ins.sample_size });
  }
  return `${s}. ${L.apply}`;
}

export default function SendInsightsCard({ userId, locale, compact = false }) {
  const [ins, setIns] = useState(null);
  const [loading, setLoading] = useState(true);
  const L = TEXT[locale] || TEXT.fr;

  async function load(refresh) {
    setLoading(true);
    try {
      const r = await fetch(`/api/send-insights?user_id=${userId}${refresh ? '&refresh=1' : ''}`);
      const body = await r.json();
      setIns(body.insights || null);
    } catch {
      setIns(null);
    }
    setLoading(false);
  }
  useEffect(() => {
    if (!userId) return;
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) return null;
  const sentence = insightSentence(ins, locale);
  const learned = !!ins?.learned_window && ins.sample_size >= MIN_SAMPLE;

  if (compact) {
    if (loading || !sentence || !learned) return null;
    return (
      <div className="sic-compact">
        <span className="sic-ic" aria-hidden="true"><Ic name="sparkles" size={15} /></span>
        <div className="sic-body"><b>{L.title}</b><span>{sentence}</span></div>
        <style jsx>{`
          .sic-compact { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.8rem; padding: 0.7rem 0.85rem; border-radius: var(--radius-md, 14px); background: rgba(75, 57, 239, 0.08); border: 1px solid rgba(124, 110, 245, 0.35); }
          .sic-ic { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: rgba(124, 110, 245, 0.18); color: var(--accent-light); }
          .sic-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .sic-body b { font-size: 0.78rem; color: var(--accent-light); }
          .sic-body span { font-size: 0.84rem; line-height: 1.4; }
        `}</style>
      </div>
    );
  }

  const maxHour = Math.max(0.0001, ...((ins?.by_hour || []).map((b) => b.rate)));
  const maxDay = Math.max(0.0001, ...((ins?.by_weekday || []).map((d) => d.rate)));
  const pct = (r) => `${Math.round(r * 1000) / 10}`;

  return (
    <section className="sic">
      <div className="sic-head">
        <h3><Ic name="sparkles" size={15} /> {L.title}</h3>
        <button type="button" className="sic-refresh" onClick={() => load(true)} disabled={loading}>{L.refresh}</button>
      </div>
      {loading && !ins ? (
        <p className="sic-muted">…</p>
      ) : !ins ? null : (
        <>
          <p className={`sic-sentence${learned ? ' learned' : ''}`}>{sentence}</p>
          <p className="sic-muted">{fill(L.sample, { n: ins.sample_size, d: ins.window_days, rate: ins.overall_reply_rate != null ? pct(ins.overall_reply_rate) : '—' })}</p>
          {ins.sample_size > 0 && (
            <div className="sic-grids">
              <div>
                <p className="sic-label">{L.byHour}</p>
                <div className="sic-bars">
                  {(ins.by_hour || []).map((b) => (
                    <div className="sic-bar" key={b.bucket} title={`${b.replied}/${b.sent}`}>
                      <span className="sic-val">{b.sent > 0 ? `${pct(b.rate)} %` : '·'}</span>
                      <span className="sic-track"><i style={{ height: `${Math.round((b.rate / maxHour) * 100)}%`, opacity: b.sent >= 15 ? 1 : 0.45 }} /></span>
                      <span className="sic-x">{b.bucket === 'autre' ? L.other : b.bucket.replace('-', '–')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="sic-label">{L.byDay}</p>
                <div className="sic-bars">
                  {(ins.by_weekday || []).map((d) => (
                    <div className="sic-bar" key={d.weekday} title={`${d.replied}/${d.sent}`}>
                      <span className="sic-val">{d.sent > 0 ? `${pct(d.rate)} %` : '·'}</span>
                      <span className="sic-track"><i style={{ height: `${Math.round((d.rate / maxDay) * 100)}%`, opacity: d.sent >= 15 ? 1 : 0.45 }} /></span>
                      <span className="sic-x">{L.days[d.weekday - 1].slice(0, 3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <style jsx>{`
        .sic { margin-top: 1.25rem; padding: 1rem 1.1rem; border-radius: var(--radius-lg, 20px); background: var(--bg); border: 1px solid var(--border); }
        .sic-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.5rem; }
        .sic-head h3 { margin: 0; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 0.4rem; }
        .sic-refresh { background: none; border: 1px solid var(--border); color: var(--muted); border-radius: 999px; padding: 0.25rem 0.7rem; font: inherit; font-size: 0.74rem; cursor: pointer; }
        .sic-sentence { margin: 0.2rem 0 0.2rem; font-size: 1rem; line-height: 1.4; }
        .sic-sentence.learned { font-weight: 600; }
        .sic-muted { margin: 0; font-size: 0.76rem; color: var(--muted); }
        .sic-label { margin: 0.9rem 0 0.4rem; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
        .sic-grids { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.2rem; }
        .sic-bars { display: flex; gap: 0.35rem; align-items: stretch; height: 120px; }
        .sic-bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.25rem; min-width: 0; }
        .sic-val { font-size: 0.62rem; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .sic-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
        .sic-track i { display: block; width: 100%; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, var(--accent-light), var(--accent)); min-height: 2px; }
        .sic-x { font-size: 0.62rem; color: var(--muted); white-space: nowrap; }
        @media (max-width: 700px) { .sic-grids { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
