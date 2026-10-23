'use client';
// components/ActivityFeed.jsx
// Le fil « Pendant ton absence » du tableau de bord (Alex, 16/10/2026).
//
// Un fil, pas un tableau de bord. Une ligne par évènement, les plus récents
// en haut, groupés par jour. C'est la raison de revenir : il s'est toujours
// passé quelque chose depuis la dernière fois.
//
// Deux règles de ton, et elles comptent plus que le style :
//   - Aaron parle à la première personne (« j'ai contacté 14 entreprises »),
//     parce que c'est LUI qui a travaillé pendant que le commercial dormait.
//     Un fil impersonnel (« 14 emails envoyés ») raconte un logiciel ; un
//     fil à la première personne raconte un collègue.
//   - Une seule ligne fête : le client signé. Elle a son icône, sa couleur,
//     et rien d'autre dans le fil n'en a. Si tout fête, rien ne fête.
//
// Quand le fil est vide, il ne montre pas un placeholder triste : il dit
// qu'Aaron est au travail et quand il y aura du nouveau. L'absence de
// nouvelles pendant une heure est normale ; l'écran ne doit pas la faire
// ressembler à une panne.
import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

const ICON = {
  contacted: 'mail',
  replied: 'message',
  quote_requested: 'file',
  quote_sent: 'file',
  quote_opened: 'phone',
  appointment_proposed: 'calendar',
  appointment_confirmed: 'calendar',
  won: 'party',
  found: 'target',
};

// Les évènements qui demandent une action ont déjà leur story en haut de
// page. Ici on raconte, on ne redemande pas : la ligne est cliquable vers
// la fiche, point.
function textFor(ev, locale) {
  const name = ev.prospect_name || t('feed.someone', locale);
  switch (ev.kind) {
    case 'contacted':
      return t(ev.count > 1 ? 'feed.contactedMany' : 'feed.contactedOne', locale).replace('{n}', ev.count);
    case 'found':
      return t(ev.count > 1 ? 'feed.foundMany' : 'feed.foundOne', locale).replace('{n}', ev.count);
    case 'replied':
      return t('feed.replied', locale).replace('{name}', name);
    case 'quote_requested':
      return t('feed.quoteRequested', locale).replace('{name}', name);
    case 'quote_sent':
      return t('feed.quoteSent', locale).replace('{name}', name);
    case 'quote_opened':
      return t('feed.quoteOpened', locale).replace('{name}', name);
    case 'appointment_proposed':
      return t('feed.apptProposed', locale).replace('{name}', name);
    case 'appointment_confirmed':
      return t('feed.apptConfirmed', locale).replace('{name}', name);
    case 'won':
      return t('feed.won', locale).replace('{name}', name);
    default:
      return '';
  }
}

// Refonte visuelle 17/10/2026 (maquettes validées par Alex) : le fil
// s'ouvre sur un RÉSUMÉ en une phrase + 4 chiffres, puis les lignes. Les
// textes vivent ici (lib/i18n.js dépasse la taille acceptée par l'envoi
// GitHub, voir ContactCard.jsx — même compromis).
const HERO_TEXT = {
  fr: { contacted: 'prospects contactés', replies: 'réponses', appts: 'rendez-vous', quotes: 'devis demandés', won: 'clients gagnés', more: 'Tout voir', less: 'Réduire', sentence: 'Aaron a contacté {c} {cw}{r}{a}{w}.', cw1: 'prospect', cwN: 'prospects', r: ', obtenu {n} {w}', r1: 'réponse', rN: 'réponses', a: ' et {n} {w}', a1: 'rendez-vous', aN: 'rendez-vous', w: ' · {n} {w}', w1: 'client gagné', wN: 'clients gagnés', quiet: 'Aaron travaille : {n} {w} cette semaine.', qw1: 'nouveauté', qwN: 'nouveautés', week: 'Cette semaine : {list}.', q1: 'devis demandé', qN: 'devis demandés' },
  en: { contacted: 'prospects contacted', replies: 'replies', appts: 'meetings', quotes: 'quotes requested', won: 'clients won', more: 'See all', less: 'Collapse', sentence: 'Aaron contacted {c} {cw}{r}{a}{w}.', cw1: 'prospect', cwN: 'prospects', r: ', got {n} {w}', r1: 'reply', rN: 'replies', a: ' and {n} {w}', a1: 'meeting', aN: 'meetings', w: ' · {n} {w}', w1: 'client won', wN: 'clients won', quiet: 'Aaron is at work: {n} {w} this week.', qw1: 'update', qwN: 'updates', week: 'This week: {list}.', q1: 'quote requested', qN: 'quotes requested' },
  de: { contacted: 'Interessenten kontaktiert', replies: 'Antworten', appts: 'Termine', quotes: 'Angebote angefragt', won: 'Kunden gewonnen', more: 'Alle anzeigen', less: 'Einklappen', sentence: 'Aaron hat {c} {cw} kontaktiert{r}{a}{w}.', cw1: 'Interessenten', cwN: 'Interessenten', r: ', {n} {w} erhalten', r1: 'Antwort', rN: 'Antworten', a: ' und {n} {w} vereinbart', a1: 'Termin', aN: 'Termine', w: ' · {n} {w}', w1: 'Kunde gewonnen', wN: 'Kunden gewonnen', quiet: 'Aaron arbeitet: {n} {w} diese Woche.', qw1: 'Neuigkeit', qwN: 'Neuigkeiten', week: 'Diese Woche: {list}.', q1: 'Angebot angefragt', qN: 'Angebote angefragt' },
  it: { contacted: 'prospect contattati', replies: 'risposte', appts: 'appuntamenti', quotes: 'preventivi richiesti', won: 'clienti acquisiti', more: 'Vedi tutto', less: 'Riduci', sentence: 'Aaron ha contattato {c} {cw}{r}{a}{w}.', cw1: 'prospect', cwN: 'prospect', r: ', ottenuto {n} {w}', r1: 'risposta', rN: 'risposte', a: ' e {n} {w}', a1: 'appuntamento', aN: 'appuntamenti', w: ' · {n} {w}', w1: 'cliente acquisito', wN: 'clienti acquisiti', quiet: 'Aaron è al lavoro: {n} {w} questa settimana.', qw1: 'novità', qwN: 'novità', week: 'Questa settimana: {list}.', q1: 'preventivo richiesto', qN: 'preventivi richiesti' },
  es: { contacted: 'prospectos contactados', replies: 'respuestas', appts: 'citas', quotes: 'presupuestos pedidos', won: 'clientes ganados', more: 'Ver todo', less: 'Reducir', sentence: 'Aaron contactó a {c} {cw}{r}{a}{w}.', cw1: 'prospecto', cwN: 'prospectos', r: ', obtuvo {n} {w}', r1: 'respuesta', rN: 'respuestas', a: ' y {n} {w}', a1: 'cita', aN: 'citas', w: ' · {n} {w}', w1: 'cliente ganado', wN: 'clientes ganados', quiet: 'Aaron está trabajando: {n} {w} esta semana.', qw1: 'novedad', qwN: 'novedades', week: 'Esta semana: {list}.', q1: 'presupuesto pedido', qN: 'presupuestos pedidos' },
  pt: { contacted: 'prospects contactados', replies: 'respostas', appts: 'reuniões', quotes: 'orçamentos pedidos', won: 'clientes ganhos', more: 'Ver tudo', less: 'Reduzir', sentence: 'O Aaron contactou {c} {cw}{r}{a}{w}.', cw1: 'prospect', cwN: 'prospects', r: ', obteve {n} {w}', r1: 'resposta', rN: 'respostas', a: ' e {n} {w}', a1: 'reunião', aN: 'reuniões', w: ' · {n} {w}', w1: 'cliente ganho', wN: 'clientes ganhos', quiet: 'O Aaron está a trabalhar: {n} {w} esta semana.', qw1: 'novidade', qwN: 'novidades', week: 'Esta semana: {list}.', q1: 'orçamento pedido', qN: 'orçamentos pedidos' },
  nl: { contacted: 'prospects benaderd', replies: 'reacties', appts: 'afspraken', quotes: 'offertes gevraagd', won: 'klanten gewonnen', more: 'Alles tonen', less: 'Inklappen', sentence: 'Aaron heeft {c} {cw} benaderd{r}{a}{w}.', cw1: 'prospect', cwN: 'prospects', r: ', {n} {w} gekregen', r1: 'reactie', rN: 'reacties', a: ' en {n} {w} geregeld', a1: 'afspraak', aN: 'afspraken', w: ' · {n} {w}', w1: 'klant gewonnen', wN: 'klanten gewonnen', quiet: 'Aaron is aan het werk: {n} {w} deze week.', qw1: 'update', qwN: 'updates', week: 'Deze week: {list}.', q1: 'offerte gevraagd', qN: 'offertes gevraagd' },
};
const ht = (key, locale) => (HERO_TEXT[locale] || HERO_TEXT.fr)[key] || HERO_TEXT.fr[key];
const COLLAPSED_ROWS = 5;

function summarize(events) {
  const s = { contacted: 0, replies: 0, appts: 0, quotes: 0, won: 0 };
  for (const ev of events) {
    if (ev.kind === 'contacted') s.contacted += ev.count || 1;
    else if (ev.kind === 'replied') s.replies += 1;
    else if (ev.kind === 'appointment_confirmed' || ev.kind === 'appointment_proposed') s.appts += 1;
    else if (ev.kind === 'quote_requested') s.quotes += 1;
    else if (ev.kind === 'won') s.won += 1;
  }
  return s;
}

function heroSentence(s, total, locale) {
  const pl = (n, one, many) => ht(n === 1 ? one : many, locale);
  if (s.contacted === 0) {
    // Rien d'envoyé cette semaine mais des réponses, rendez-vous, devis ou
    // clients : on les nomme (« Cette semaine : 2 rendez-vous. ») plutôt
    // qu'un vague « 2 nouvelles » (retour d'Alex, 23/10/2026).
    const items = [
      [s.replies, 'r1', 'rN'],
      [s.appts, 'a1', 'aN'],
      [s.quotes, 'q1', 'qN'],
      [s.won, 'w1', 'wN'],
    ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${pl(n, one, many)}`);
    if (items.length) return ht('week', locale).replace('{list}', items.join(' · '));
    return ht('quiet', locale).replace('{n}', total).replace('{w}', pl(total, 'qw1', 'qwN'));
  }
  const part = (n, key, one, many) => (n > 0 ? ht(key, locale).replace('{n}', n).replace('{w}', pl(n, one, many)) : '');
  return ht('sentence', locale)
    .replace('{c}', s.contacted)
    .replace('{cw}', pl(s.contacted, 'cw1', 'cwN'))
    .replace('{r}', part(s.replies, 'r', 'r1', 'rN'))
    .replace('{a}', part(s.appts, 'a', 'a1', 'aN'))
    .replace('{w}', part(s.won, 'w', 'w1', 'wN'));
}

function dayLabel(iso, locale, now) {
  const d = new Date(iso);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return t('feed.today', locale);
  if (sameDay(d, yesterday)) return t('feed.yesterday', locale);
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function ActivityFeed({ userId, locale, onOpenContact }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/activity?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setEvents(body.events || []);
      })
      .catch(() => !cancelled && setError('network'));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const now = new Date();
  const summary = summarize(events || []);
  const total = (events || []).length;

  // Groupes par jour, dans l'ordre d'arrivée (déjà trié côté API). Replié
  // par défaut aux COLLAPSED_ROWS premières lignes : le résumé dit déjà
  // l'essentiel, les lignes sont le détail.
  const visible = expanded ? events || [] : (events || []).slice(0, COLLAPSED_ROWS);
  const groups = [];
  for (const ev of visible) {
    const label = dayLabel(ev.at, locale, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

  const kpis = [
    { key: 'contacted', value: summary.contacted, label: ht('contacted', locale) },
    { key: 'replies', value: summary.replies, label: ht('replies', locale) },
    { key: 'appts', value: summary.appts, label: ht('appts', locale) },
    { key: summary.won > 0 ? 'won' : 'quotes', value: summary.won > 0 ? summary.won : summary.quotes, label: ht(summary.won > 0 ? 'won' : 'quotes', locale) },
  ];

  return (
    <section className="feed" aria-live="polite">
      <div className="feed-head">
        <h2>{t('feed.title', locale)}</h2>
        {events && events.length > 0 && (
          <span className="feed-sub">{t('feed.subtitle', locale)}</span>
        )}
      </div>

      {error ? null : events === null ? (
        <div className="feed-skeleton" aria-hidden="true">
          <span /><span /><span />
        </div>
      ) : events.length === 0 ? (
        <div className="feed-empty">
          <span className="feed-empty-icon" aria-hidden="true"><Ic name="bot" size={18} /></span>
          <div>
            <p className="feed-empty-title">{t('feed.emptyTitle', locale)}</p>
            <p className="feed-empty-body">{t('feed.emptyBody', locale)}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="feed-hero">{heroSentence(summary, total, locale)}</p>
          <div className="feed-kpis">
            {kpis.map((k) => (
              <div key={k.key} className={`feed-kpi ${k.key}`}>
                <b>{k.value}</b>
                <span>{k.label}</span>
              </div>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.label} className="feed-day">
              <p className="feed-day-label">{g.label}</p>
              <ul className="feed-list">
                {g.items.map((ev) => {
                  const Tag = ev.prospect_id && onOpenContact ? 'button' : 'div';
                  const time = new Date(ev.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                  return (
                    <li key={ev.id}>
                      <Tag
                        type={Tag === 'button' ? 'button' : undefined}
                        className={`feed-row${ev.kind === 'won' ? ' won' : ''}${Tag === 'button' ? ' clickable' : ''}`}
                        onClick={Tag === 'button' ? () => onOpenContact(ev.prospect_id) : undefined}
                      >
                        <span className={`feed-icon ${ev.kind}`} aria-hidden="true">
                          <Ic name={ICON[ev.kind] || 'message'} size={15} strokeWidth={2.2} />
                        </span>
                        <span className="feed-text">
                          {textFor(ev, locale)}
                          {ev.company_name && ev.prospect_id ? <span className="feed-company"> · {ev.company_name}</span> : null}
                        </span>
                        <span className="feed-time">{time}</span>
                      </Tag>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {total > COLLAPSED_ROWS && (
            <button type="button" className="feed-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? ht('less', locale) : `${ht('more', locale)} (${total})`}
              <Ic name={expanded ? 'chevronUp' : 'chevronDown'} size={13} />
            </button>
          )}
        </>
      )}

      <style jsx>{`
        .feed {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg, 20px);
          padding: 1.1rem 1.2rem 0.6rem;
          margin-bottom: 1.25rem;
          box-shadow: var(--shadow-sm);
        }
        .feed-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.4rem;
        }
        .feed-head h2 {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .feed-sub {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .feed-hero {
          margin: 0.5rem 0 0.9rem;
          font-size: 1.25rem;
          font-weight: 700;
          line-height: 1.3;
          letter-spacing: -0.01em;
          text-wrap: balance;
        }
        .feed-kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.6rem;
          margin-bottom: 0.4rem;
        }
        .feed-kpi {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.6rem 0.75rem;
          min-width: 0;
        }
        .feed-kpi b {
          display: block;
          font-size: 1.4rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .feed-kpi span {
          display: block;
          margin-top: 0.15rem;
          font-size: 0.7rem;
          color: var(--muted);
          line-height: 1.2;
        }
        .feed-kpi.replies b { color: var(--accent-light, var(--accent)); }
        .feed-kpi.appts b { color: #b07cf5; }
        .feed-kpi.won b { color: var(--accent-green, #3dd68c); }
        .feed-more {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          margin: 0.4rem 0 0.5rem;
          padding: 0.45rem 0.8rem;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--muted);
          font: inherit;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
        }
        .feed-more:hover { color: var(--text); border-color: var(--accent); }
        .feed-day-label {
          margin: 0.75rem 0 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-soft, var(--muted));
        }
        .feed-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .feed-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          padding: 0.55rem 0.35rem;
          border: 0;
          border-radius: 12px;
          background: transparent;
          color: var(--text);
          text-align: left;
          font: inherit;
          min-width: 0;
        }
        .feed-row.clickable {
          cursor: pointer;
          transition: background var(--fast, 0.15s);
        }
        .feed-row.clickable:hover {
          background: var(--surface-hover);
        }
        .feed-icon {
          flex: 0 0 auto;
          width: 2em;
          height: 2em;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-elevated);
          color: var(--muted);
        }
        .feed-icon.replied { color: var(--accent-light, var(--accent)); }
        .feed-icon.quote_opened { color: var(--accent-green); }
        .feed-icon.appointment_confirmed { color: var(--accent); }
        /* La seule ligne qui fête. */
        .feed-row.won .feed-icon {
          background: linear-gradient(135deg, #3dd68c, #4b9ef0);
          color: #fff;
        }
        .feed-row.won .feed-text { font-weight: 700; }
        .feed-text {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 0.95rem;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .feed-company { color: var(--muted); font-weight: 400; }
        .feed-time {
          flex: 0 0 auto;
          font-size: 0.75rem;
          color: var(--muted-soft, var(--muted));
          font-variant-numeric: tabular-nums;
        }
        .feed-empty {
          display: flex;
          gap: 0.8rem;
          align-items: flex-start;
          padding: 0.6rem 0.2rem 0.8rem;
        }
        .feed-empty-icon {
          flex: 0 0 auto;
          width: 2.2em;
          height: 2.2em;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: #fff;
        }
        .feed-empty-title { margin: 0 0 0.15rem; font-weight: 600; }
        .feed-empty-body { margin: 0; color: var(--muted); font-size: 0.9rem; }
        .feed-skeleton { display: grid; gap: 0.6rem; padding: 0.5rem 0 0.9rem; }
        .feed-skeleton span {
          display: block;
          height: 0.9rem;
          border-radius: 6px;
          background: var(--border-soft, var(--border));
          opacity: 0.6;
        }
        .feed-skeleton span:nth-child(2) { width: 70%; }
        .feed-skeleton span:nth-child(3) { width: 45%; }
        @media (max-width: 640px) {
          .feed { padding: 0.9rem 0.9rem 0.4rem; }
          .feed-time { display: none; }
          .feed-hero { font-size: 1.1rem; }
          .feed-kpis { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </section>
  );
}
