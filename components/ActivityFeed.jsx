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

  // Groupes par jour, dans l'ordre d'arrivée (déjà trié côté API).
  const groups = [];
  for (const ev of events || []) {
    const label = dayLabel(ev.at, locale, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

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
        groups.map((g) => (
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
        ))
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
        }
      `}</style>
    </section>
  );
}
