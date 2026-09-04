'use client';

// components/ReportDetail.jsx
//
// Rapport détaillé jour / semaine / mois — maquettes validées par Alex le
// 04/09/2026 (« je valide ton visuel avec fonctionnalités : la ligne de
// progression et les 3 rapports jour/semaine/mois »).
//
// Avant : un rapport était une ligne avec quatre chiffres et deux boutons
// de téléchargement. On ne lisait le rapport qu'après l'avoir téléchargé.
// Maintenant : le rapport SE LIT ICI, dans une fenêtre, et le PDF / l'Excel
// ne servent plus qu'à l'envoyer à quelqu'un d'autre.
//
// Tout est calculé à partir des données déjà chargées par la page Résultats
// (contacts avec leurs dates de passage, rendez-vous) : aucune requête de
// plus, aucune estimation. Un chiffre qu'on ne sait pas calculer n'est pas
// affiché — il n'y a pas de « relances » ni de « réponses » dans le rapport
// du jour, par exemple, parce que le suivi des emails n'est pas chargé ici.
//
// Composant PUR (aucun import serveur).

import { t } from '@/lib/i18n';
import { derivePipelinePosition } from '@/lib/pipeline';

const DAY_MS = 24 * 60 * 60 * 1000;

function inRange(value, range) {
  if (!value) return false;
  const d = new Date(value);
  return d >= range.start && d <= range.end;
}

function fmtTime(value, locale) {
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// Événements datés d'un contact — la matière du fil « ce qui s'est passé ».
function eventsFor(p, range, locale) {
  const out = [];
  const name = p.full_name || '';
  const company = p.prospect_companies?.name || '';
  const who = company ? `${name} (${company})` : name;
  if (inRange(p.created_at, range)) out.push({ at: p.created_at, tone: 'prospect', text: t('report.evContacted', locale).replace('{who}', who) });
  if (inRange(p.quote_requested_at, range)) out.push({ at: p.quote_requested_at, tone: 'opportunite', text: t('report.evQuoteAsked', locale).replace('{who}', who) });
  if (inRange(p.devis_sent_at, range)) out.push({ at: p.devis_sent_at, tone: 'opportunite', text: t('report.evQuoteSent', locale).replace('{who}', who) });
  if (inRange(p.won_at, range)) out.push({ at: p.won_at, tone: 'client', text: t('report.evWon', locale).replace('{who}', who) });
  if (inRange(p.lost_at, range)) out.push({ at: p.lost_at, tone: 'lost', text: t('report.evLost', locale).replace('{who}', who) });
  return out;
}

export function computeReport(type, bucket, { allContacts, appointments, contactAmount }, locale) {
  const range = { start: bucket.start, end: bucket.end };
  const contacts = allContacts || [];
  const appts = (appointments || []).filter((a) => a.status !== 'annulé');

  const contacted = contacts.filter((p) => inRange(p.created_at, range));
  const rdv = appts.filter((a) => inRange(a.proposed_at, range) && (a.status === 'validé' || a.status === 'terminé'));
  const quotes = contacts.filter((p) => inRange(p.quote_requested_at, range));
  const won = contacts.filter((p) => inRange(p.won_at, range));
  const lost = contacts.filter((p) => inRange(p.lost_at, range));
  const signedAmount = won.reduce((s, p) => s + (contactAmount ? contactAmount(p) : 0), 0);

  // Fil des événements (jour) — trié par heure.
  const events = [
    ...contacts.flatMap((p) => eventsFor(p, range, locale)),
    ...appts
      .filter((a) => inRange(a.proposed_at, range))
      .map((a) => ({
        at: a.proposed_at,
        tone: 'opportunite',
        text: t(a.status === 'proposé' ? 'report.evApptProposed' : 'report.evApptDone', locale)
          .replace('{who}', a.prospects?.full_name || a.contact_name || '')
          .replace('{time}', fmtTime(a.proposed_at, locale)),
      })),
  ].sort((x, y) => new Date(x.at) - new Date(y.at));

  // À traiter demain (rapport du jour) : rendez-vous du lendemain + devis
  // demandés et toujours pas envoyés.
  const tomorrowStart = new Date(bucket.end.getTime() + 1);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + DAY_MS - 1);
  const tomorrowAppts = appts.filter((a) => inRange(a.proposed_at, { start: tomorrowStart, end: tomorrowEnd })).length;
  const pendingQuotes = contacts.filter((p) => p.quote_requested_at && !p.devis_sent_at && !derivePipelinePosition(p).lost).length;

  // Par jour (semaine) : contacts touchés.
  const days = [];
  if (type === 'week') {
    for (let i = 0; i < 7; i += 1) {
      const start = new Date(bucket.start.getTime() + i * DAY_MS);
      const end = new Date(start.getTime() + DAY_MS - 1);
      days.push({
        start,
        label: start.toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''),
        value: contacts.filter((p) => inRange(p.created_at, { start, end })).length,
      });
    }
  }
  const bestDay = days.length ? days.reduce((b, d) => (d.value > b.value ? d : b), days[0]) : null;

  // Mois précédent (comparaison du montant signé).
  let previousSigned = null;
  if (type === 'month') {
    const prevStart = new Date(bucket.start.getFullYear(), bucket.start.getMonth() - 1, 1);
    const prevEnd = new Date(bucket.start.getTime() - 1);
    previousSigned = contacts
      .filter((p) => inRange(p.won_at, { start: prevStart, end: prevEnd }))
      .reduce((s, p) => s + (contactAmount ? contactAmount(p) : 0), 0);
  }
  const topSignatures = won
    .map((p) => ({ name: p.prospect_companies?.name || p.full_name, amount: contactAmount ? contactAmount(p) : 0 }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  return {
    contacted: contacted.length,
    rdv: rdv.length,
    quotes: quotes.length,
    won: won.length,
    lost: lost.length,
    signedAmount,
    previousSigned,
    events,
    tomorrow: tomorrowAppts + pendingQuotes,
    days,
    bestDay,
    topSignatures,
  };
}

export default function ReportDetail({ type, bucket, title, data, locale, onClose, onDownload, downloading, formatEur }) {
  const r = computeReport(type, bucket, data, locale);
  const maxDay = Math.max(1, ...r.days.map((d) => d.value));
  const funnelMax = Math.max(1, r.contacted, r.rdv, r.quotes, r.won);
  const delta =
    r.previousSigned !== null && r.previousSigned > 0
      ? Math.round(((r.signedAmount - r.previousSigned) / r.previousSigned) * 100)
      : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="close" onClick={onClose} aria-label={t('common.close', locale)}>✕</button>
        <p className="eyebrow">{t(`report.eyebrow.${type}`, locale)}</p>
        <h2 className="title">{title}</h2>

        {type === 'day' && (
          <>
            <div className="hero">
              <span className="hero-num tone-prospect">{r.contacted}</span>
              <span className="hero-lbl">{t('report.contactedToday', locale)}</span>
            </div>
            <div className="tiles">
              <div className="tile"><span className="tile-num tone-opportunite">{r.rdv}</span><span className="tile-lbl">{t('report.rdvObtained', locale)}</span></div>
              <div className="tile"><span className="tile-num tone-opportunite">{r.quotes}</span><span className="tile-lbl">{t('report.quotesAsked', locale)}</span></div>
              <div className="tile"><span className="tile-num tone-client">{r.won}</span><span className="tile-lbl">{t('report.clientsSigned', locale)}</span></div>
              <div className="tile"><span className="tile-num tone-amber">{r.tomorrow}</span><span className="tile-lbl">{t('report.toHandleTomorrow', locale)}</span></div>
            </div>
            <div className="card">
              <p className="card-title">{t('report.whatHappened', locale)}</p>
              {r.events.length === 0 ? (
                <p className="muted">{t('report.nothingHappened', locale)}</p>
              ) : (
                <ul className="timeline">
                  {r.events.slice(0, 12).map((ev, i) => (
                    <li key={i}>
                      <span className={`dot tone-${ev.tone}`} />
                      <span className="ev-text">{ev.text}</span>
                      <span className="ev-time">{fmtTime(ev.at, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {type === 'week' && (
          <>
            <div className="card">
              <p className="card-title">{t('report.contactedPerDay', locale)}</p>
              <div className="bars">
                {r.days.map((d) => (
                  <div className="bar-col" key={d.label}>
                    <span className="bar-val">{d.value}</span>
                    <span className="bar-track"><span className="bar" style={{ height: `${Math.max(4, (d.value / maxDay) * 100)}%`, opacity: d.value > 0 ? 1 : 0.3 }} /></span>
                    <span className="bar-lbl">{d.label}</span>
                  </div>
                ))}
              </div>
              <p className="muted small">
                {t('report.weekTotal', locale).replace('{n}', r.contacted)}
                {r.bestDay && r.bestDay.value > 0 ? ` · ${t('report.bestDay', locale).replace('{day}', r.bestDay.start.toLocaleDateString(locale, { weekday: 'long' }))}` : ''}
              </p>
            </div>
            <div className="card">
              <p className="card-title">{t('report.produced', locale)}</p>
              {[
                { lbl: t('report.rdvObtained', locale), v: r.rdv, tone: 'opportunite' },
                { lbl: t('report.quotesAsked', locale), v: r.quotes, tone: 'opportunite' },
                { lbl: t('report.clientsSigned', locale), v: r.won, tone: 'client' },
              ].map((row) => (
                <div className="hrow" key={row.lbl}>
                  <span className="hrow-lbl">{row.lbl}</span>
                  <span className="hrow-track"><span className={`hrow-bar tone-bg-${row.tone}`} style={{ width: `${Math.max(3, (row.v / funnelMax) * 100)}%` }} /></span>
                  <span className="hrow-val">{row.v}</span>
                </div>
              ))}
            </div>
            <div className="card insight">
              <p className="card-title">{t('report.aaronNotes', locale)}</p>
              <p className="insight-text">
                {r.contacted === 0
                  ? t('report.insightEmpty', locale)
                  : r.rdv > 0
                  ? t('report.insightRdv', locale).replace('{rate}', Math.round((r.rdv / r.contacted) * 100))
                  : t('report.insightNoRdv', locale)}
              </p>
            </div>
          </>
        )}

        {type === 'month' && (
          <>
            <div className="hero money">
              <span className="hero-amount">{formatEur ? formatEur(r.signedAmount) : r.signedAmount}</span>
              <span className="hero-lbl">{t('report.signedThisMonth', locale)}</span>
              {delta !== null && (
                <span className={`delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '+' : ''}{delta} % {t('report.vsPrevMonth', locale)}</span>
              )}
              {r.signedAmount === 0 && <span className="muted small">{t('report.noAmountHint', locale)}</span>}
            </div>
            <div className="card">
              <p className="card-title">{t('report.monthFunnel', locale)}</p>
              {[
                { lbl: t('report.contacted', locale), v: r.contacted, tone: 'prospect' },
                { lbl: t('report.rdvObtained', locale), v: r.rdv, tone: 'opportunite' },
                { lbl: t('report.quotesAsked', locale), v: r.quotes, tone: 'opportunite' },
                { lbl: t('report.clientsSigned', locale), v: r.won, tone: 'client' },
              ].map((row) => (
                <div className="hrow" key={row.lbl}>
                  <span className="hrow-lbl">{row.lbl}</span>
                  <span className="hrow-track"><span className={`hrow-bar tone-bg-${row.tone}`} style={{ width: `${Math.max(3, (row.v / funnelMax) * 100)}%` }} /></span>
                  <span className="hrow-val">{row.v}</span>
                </div>
              ))}
              {r.lost > 0 && <p className="muted small">{t('report.lostThisPeriod', locale).replace('{n}', r.lost)}</p>}
            </div>
            {r.topSignatures.length > 0 && (
              <div className="card">
                <p className="card-title">{t('report.topSignatures', locale)}</p>
                <ul className="top">
                  {r.topSignatures.map((s, i) => (
                    <li key={i}><span>{s.name}</span><span className="amount">{formatEur ? formatEur(s.amount) : s.amount}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="actions">
          <button type="button" className="btn-secondary" disabled={downloading === 'pdf'} onClick={() => onDownload('pdf')}>
            {t('results.reportDownloadPdf', locale)}
          </button>
          <button type="button" className="btn-secondary" disabled={downloading === 'csv'} onClick={() => onDownload('csv')}>
            {t('results.reportDownloadCsv', locale)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 6, 12, 0.78);
          backdrop-filter: blur(6px);
          z-index: 120;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .sheet {
          position: relative;
          width: min(480px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 1.4rem 1.3rem 1.2rem;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .close {
          position: absolute;
          top: 0.9rem;
          right: 0.9rem;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .eyebrow {
          margin: 0;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .title {
          margin: -0.5rem 0 0.2rem;
          font-family: var(--font-display);
          font-size: 1.35rem;
          font-weight: 700;
          text-transform: capitalize;
        }
        .hero {
          display: flex;
          align-items: baseline;
          gap: 0.6rem;
          flex-wrap: wrap;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1rem 1.1rem;
        }
        .hero.money { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
        .hero-num { font-family: var(--font-mono); font-size: 2.2rem; line-height: 1; }
        .hero-amount { font-family: var(--font-mono); font-size: 2rem; line-height: 1; color: #1fae70; }
        .hero-lbl { font-size: 0.9rem; }
        .delta { font-size: 0.8rem; font-weight: 600; margin-top: 0.3rem; }
        .delta.up { color: #1fae70; }
        .delta.down { color: var(--accent-red); }
        .tiles {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.7rem;
        }
        .tile {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 0.9rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .tile-num { font-family: var(--font-mono); font-size: 1.5rem; line-height: 1; }
        .tile-lbl { font-size: 0.78rem; color: var(--muted); }
        .tone-prospect { color: #3d8fe8; }
        .tone-opportunite { color: #c93f8c; }
        .tone-client { color: #1fae70; }
        .tone-amber { color: var(--accent-amber); }
        .tone-lost { color: var(--accent-red); }
        .tone-bg-prospect { background: #3d8fe8; }
        .tone-bg-opportunite { background: #c93f8c; }
        .tone-bg-client { background: #1fae70; }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1rem 1.1rem;
        }
        .card-title { margin: 0 0 0.7rem; font-weight: 600; font-size: 0.9rem; }
        .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
        .timeline li { display: flex; align-items: flex-start; gap: 0.6rem; font-size: 0.84rem; }
        .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 0.4rem; flex-shrink: 0; background: currentColor; }
        .ev-text { flex: 1; line-height: 1.4; }
        .ev-time { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); }
        .bars {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 0.4rem;
          align-items: end;
        }
        .bar-col { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
        .bar-val { font-family: var(--font-mono); font-size: 0.72rem; }
        .bar-track { height: 90px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
        .bar { display: block; width: 70%; border-radius: 6px 6px 2px 2px; background: #3d8fe8; }
        .bar-lbl { font-size: 0.68rem; color: var(--muted); }
        .hrow { display: grid; grid-template-columns: 1fr 2fr auto; align-items: center; gap: 0.7rem; margin-bottom: 0.55rem; font-size: 0.82rem; }
        .hrow-track { display: block; height: 8px; border-radius: 999px; background: var(--surface-hover, var(--border)); overflow: hidden; }
        .hrow-bar { display: block; height: 100%; border-radius: 999px; }
        .hrow-val { font-family: var(--font-mono); font-size: 0.95rem; min-width: 2ch; text-align: right; }
        .insight { background: rgba(75, 57, 239, 0.1); border-color: rgba(75, 57, 239, 0.35); }
        .insight .card-title { color: var(--accent-light); }
        .insight-text { margin: 0; font-size: 0.88rem; line-height: 1.5; }
        .top { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.86rem; }
        .top li { display: flex; justify-content: space-between; gap: 1rem; }
        .amount { font-family: var(--font-mono); color: #1fae70; }
        .muted { color: var(--muted); margin: 0; }
        .small { font-size: 0.76rem; margin-top: 0.5rem; }
        .actions { display: flex; gap: 0.6rem; }
        .actions > * { flex: 1; }
        /* Boutons : classes globales de app/globals.css ; ici seulement la
           largeur. */
      `}</style>
    </div>
  );
}
