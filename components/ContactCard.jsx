'use client';

// components/ContactCard.jsx
//
// Fiche contact unique de la fusion Prospects + Opportunités + Clients
// (docx « mon avis » d'Alex, 31/08/2026) : panneau latéral sur ordinateur,
// feuille plein écran sur téléphone. Un seul endroit pour tout ce qui
// concerne un contact, quelle que soit son étape :
//   - ligne de progression 6 points + catégorie + risque / perdu (motif) ;
//   - actions : Gagné, Perdu (motif), Déplacer (étape forcée à la main pour
//     un évènement qu'Aaron ne voit pas), Risque, « Il m'a demandé un devis »
//     (SMS, appel…), Aaron s'en charge, Enregistrer sur le téléphone
//     (vCard avec DISC + notes), Modifier la fiche, Supprimer (double
//     confirmation « tu ne pourras pas revenir en arrière ») ;
//   - conviction d'Aaron (score + justification), personnalité ressentie
//     (DISC) et avis d'Aaron — deux blocs distincts ;
//   - infos contact + société (adresse, SIRET…) modifiables ;
//   - outils opportunité (brief / bilan / devis / signature —
//     components/DealTools.jsx) dès le stade RDV obtenu ;
//   - outils client (onboarding, renouvellement, factures — page dédiée)
//     pour un client à part entière ;
//   - historique des échanges.

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { frenchTypography } from '@/lib/text-typography';
import { PIPELINE_STAGES, PIPELINE_COLORS, CATEGORY_ICONS, LOST_REASONS, derivePipelinePosition, stageOrder } from '@/lib/pipeline';
import { contactAlerts } from '@/lib/contact-alerts';
import { downloadVCard } from '@/lib/vcard';
import ContactInfoEditor from '@/components/ContactInfoEditor';
import CompanyInfoEditor from '@/components/CompanyInfoEditor';
import DealTools from '@/components/DealTools';

const PERSONALITY_COLORS = {
  dominant: '#E5484D',
  influent: '#E5B93A',
  stable: '#3DA35D',
  consciencieux: '#4B9EF0',
};

const ORIGIN_KEYS = {
  amene_par_aaron: 'pipeline.origin.aaron',
  amene_par_toi: 'pipeline.origin.you',
  reactive_par_aaron: 'pipeline.origin.reactivated',
};

export function DiscBadge({ type, locale, size = 'md' }) {
  if (!type) return null;
  const color = PERSONALITY_COLORS[type];
  if (!color) return null;
  const letter = t(`personality.${type}`, locale).charAt(0).toUpperCase();
  return (
    <span
      className={`disc-badge disc-${size}`}
      style={{ background: `${color}22`, color, border: `1px solid ${color}` }}
      title={t(`personality.${type}`, locale)}
    >
      {letter}
      <style jsx>{`
        .disc-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-weight: 700;
          flex-shrink: 0;
          font-family: var(--font-mono, monospace);
        }
        .disc-md { width: 1.35rem; height: 1.35rem; font-size: 0.68rem; }
        .disc-lg { width: 1.7rem; height: 1.7rem; font-size: 0.82rem; }
      `}</style>
    </span>
  );
}

// Ligne de progression 6 points. `compact` = version mini du tableau.
export function ProgressLine({ position, locale, compact = false, onSelect }) {
  const reached = stageOrder(position.stage);
  const color = position.lost ? PIPELINE_COLORS.lost : position.wonPendingFirstOrder ? PIPELINE_COLORS.wonPending : PIPELINE_COLORS[position.category];
  return (
    <div className={`progress-line${compact ? ' compact' : ''}`} aria-label={t(position.lost ? 'pipeline.lostLabel' : `pipeline.stage.${camel(position.stage)}`, locale)}>
      {PIPELINE_STAGES.map((s, i) => {
        const done = i < reached;
        const current = i === reached;
        const catColor = PIPELINE_COLORS[s.category];
        const dotStyle = current
          ? { background: color, boxShadow: `0 0 0 3px ${color}33`, borderColor: color }
          : done
          ? { background: catColor, borderColor: catColor }
          : { background: 'transparent', borderColor: 'var(--border)' };
        return (
          <div className="step" key={s.key}>
            {i > 0 && <span className={`link${done || current ? ' on' : ''}`} style={done || current ? { background: PIPELINE_COLORS[PIPELINE_STAGES[i - 1].category] } : undefined} />}
            <button
              type="button"
              className={`dot${current ? ' current' : ''}${position.lost && current ? ' lost' : ''}`}
              style={dotStyle}
              title={`${t(s.labelKey, locale)} — ${t(s.hintKey, locale)}`}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              tabIndex={onSelect ? 0 : -1}
            >
              {position.lost && current ? '✕' : ''}
            </button>
            {!compact && <span className={`lbl${current ? ' current' : ''}`}>{t(s.labelKey, locale)}</span>}
          </div>
        );
      })}
      <style jsx>{`
        .progress-line {
          display: flex;
          align-items: flex-start;
          width: 100%;
        }
        .step {
          position: relative;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 0;
        }
        .link {
          position: absolute;
          top: 8px;
          left: -50%;
          width: 100%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }
        .dot {
          position: relative;
          z-index: 1;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid;
          padding: 0;
          cursor: inherit;
          color: #fff;
          font-size: 0.6rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .dot.lost { color: #fff; }
        .lbl {
          margin-top: 0.4rem;
          font-size: 0.66rem;
          color: var(--muted);
          text-align: center;
          line-height: 1.15;
        }
        .lbl.current { color: var(--text); font-weight: 600; }
        .compact .step { flex: none; width: 16px; }
        .compact .dot { width: 10px; height: 10px; border-width: 1.5px; font-size: 0.5rem; }
        .compact .link { top: 4px; height: 1.5px; }
      `}</style>
    </div>
  );
}

function camel(stage) {
  return stage.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export default function ContactCard({ prospect, locale, userId, onClose, onChanged, onValidateEmail, onLinkedin, onDeleted }) {
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [panel, setPanel] = useState(null); // 'won' | 'lost' | 'move' | 'delete' | null
  const [lostReason, setLostReason] = useState('autre');
  const [feedback, setFeedback] = useState(null);
  const infosRef = useRef(null);
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);

  const position = derivePipelinePosition(prospect);
  const alerts = contactAlerts(prospect);
  const isClient = position.category === 'client' && !position.lost;
  const isFullClient = !!prospect.first_order_confirmed_at;
  const showDealTools = stageOrder(position.stage) >= 2 || !!prospect.latest_appointment || !!prospect.devis_generated_at;
  const conviction = prospect.conviction_score ?? prospect.negotiation_confidence_score ?? null;
  const convictionReason = prospect.conviction_reason ?? prospect.negotiation_confidence_reason ?? null;

  useEffect(() => {
    let cancelled = false;
    setMessagesLoading(true);
    fetch(`/api/prospects/${prospect.id}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setMessages(body.messages || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prospect.id]);

  useEffect(() => {
    setPanel(null);
    setFeedback(null);
  }, [prospect.id]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  async function patch(body) {
    setActing(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/prospects/${prospect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: json.error || t('prospects.loadErrorFallback', locale) });
        return false;
      }
      return true;
    } finally {
      setActing(false);
    }
  }

  async function handleWon(firstOrderConfirmed) {
    if (await patch({ action: 'marquer_gagne', first_order_confirmed: firstOrderConfirmed })) {
      setPanel(null);
      onChanged();
    }
  }

  async function handleConfirmFirstOrder() {
    if (await patch({ action: 'confirmer_premiere_commande' })) onChanged();
  }

  async function handleLost() {
    if (await patch({ action: 'marquer_perdu', lost_reason: lostReason })) {
      setPanel(null);
      onChanged();
    }
  }

  async function handleMove(stage) {
    if (await patch({ action: 'set_pipeline_stage', stage })) {
      setPanel(null);
      onChanged();
    }
  }

  async function handleRisk() {
    if (await patch({ action: 'set_pipeline_risk', risk: !position.risk })) onChanged();
  }

  async function handleQuoteRequested() {
    if (await patch({ action: 'quote_requested' })) {
      setFeedback({ type: 'ok', text: t('card.quoteRequestedDone', locale) });
      onChanged();
    }
  }

  async function handleToggleAiManaged() {
    if (await patch({ action: 'set_ai_managed', ai_managed: prospect.ai_managed === false })) onChanged();
  }

  async function handleDelete() {
    setActing(true);
    const res = await fetch(`/api/prospects/${prospect.id}`, { method: 'DELETE' });
    setActing(false);
    if (res.ok) {
      onDeleted ? onDeleted() : onClose();
    } else {
      setFeedback({ type: 'error', text: t('prospects.loadErrorFallback', locale) });
    }
  }

  function handleSaveToPhone() {
    downloadVCard(prospect, {
      personalityLabel: prospect.personality_type ? `${t('card.discLabel', locale)} : ${t(`personality.${prospect.personality_type}`, locale)}` : null,
      notesLabel: t('prospects.colPersonality', locale),
      adviceLabel: t('modal.aaronAdvice', locale),
    });
  }

  function scrollToInfos() {
    infosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Téléphone : glisser vers le bas depuis la poignée ferme la fiche.
  function onDragStart(e) {
    dragStartY.current = e.touches ? e.touches[0].clientY : e.clientY;
  }
  function onDragEnd(e) {
    if (dragStartY.current == null) return;
    const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    if (y - dragStartY.current > 80) onClose();
    dragStartY.current = null;
  }

  const company = prospect.prospect_companies || {};
  const stageLabel = t(position.lost ? 'pipeline.lostLabel' : PIPELINE_STAGES[stageOrder(position.stage)].labelKey, locale);
  const catColor = position.lost ? PIPELINE_COLORS.lost : PIPELINE_COLORS[position.category];

  return (
    <div className="card-overlay" onClick={onClose}>
      <aside className="card" ref={sheetRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab" onTouchStart={onDragStart} onTouchEnd={onDragEnd}><span /></div>

        <header className="card-head">
          <div className="head-main">
            <span className="cat-icon" style={{ background: `${catColor}22`, color: catColor }}>{position.lost ? '✕' : CATEGORY_ICONS[position.category]}</span>
            <div className="head-text">
              <h2>
                {prospect.full_name}
                <DiscBadge type={prospect.personality_type} locale={locale} size="lg" />
                {alerts.some((a) => a.level === 'urgent') && <span className="alert-badge urgent">!</span>}
              </h2>
              <p className="sub">
                {company.name || prospect.email}
                {prospect.job_title ? ` · ${prospect.job_title}` : ''}
              </p>
              <div className="pills">
                <span className="pill" style={{ color: catColor, borderColor: catColor }}>{stageLabel}</span>
                {position.risk && <span className="pill" style={{ color: PIPELINE_COLORS.risk, borderColor: PIPELINE_COLORS.risk }}>⚠ {t('pipeline.riskLabel', locale)}</span>}
                {position.wonPendingFirstOrder && <span className="pill" style={{ color: PIPELINE_COLORS.wonPending, borderColor: PIPELINE_COLORS.wonPending }}>{t('prospects.wonPendingLabel', locale)}</span>}
                {position.lost && position.lostReason && <span className="pill muted-pill">{t(`pipeline.lostReason.${position.lostReason}`, locale)}</span>}
                {prospect.origin && ORIGIN_KEYS[prospect.origin] && <span className="pill muted-pill">{t(ORIGIN_KEYS[prospect.origin], locale)}</span>}
              </div>
            </div>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label={t('common.close', locale)}>✕</button>
        </header>

        <div className="progress-wrap">
          <ProgressLine position={position} locale={locale} />
        </div>

        {alerts.length > 0 && (
          <div className="alerts">
            {alerts.map((a) => (
              <div key={a.key} className={`alert ${a.level}`}>
                <span>{t(a.labelKey, locale)}</span>
                {a.key === 'email_to_validate' && onValidateEmail && (
                  <button type="button" className="mini" onClick={() => onValidateEmail(prospect)}>{t('prospects.validateFirstEmailButton', locale)}</button>
                )}
                {a.key === 'first_order_to_confirm' && (
                  <button type="button" className="mini" disabled={acting} onClick={handleConfirmFirstOrder}>{t('prospects.confirmOrderButton', locale)}</button>
                )}
                {a.key === 'bilan_to_do' && prospect.latest_appointment && (
                  <a className="mini" href={`/app/agenda/rdv/${prospect.latest_appointment.id}/bilan?user_id=${userId}`}>{t('agenda.bilanTodo', locale)}</a>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="actions">
          {!isClient && !position.lost && (
            <button type="button" className="act won" disabled={acting} onClick={() => setPanel(panel === 'won' ? null : 'won')}>{t('prospects.wonButtonLabel', locale)}</button>
          )}
          {!position.lost && (
            <button type="button" className="act lost" disabled={acting} onClick={() => setPanel(panel === 'lost' ? null : 'lost')}>✕ {t('pipeline.lostLabel', locale)}</button>
          )}
          <button type="button" className="act" disabled={acting} onClick={() => setPanel(panel === 'move' ? null : 'move')}>↔ {t('card.move', locale)}</button>
          {!position.lost && !isClient && (
            <button type="button" className={`act${position.risk ? ' risk-on' : ''}`} disabled={acting} onClick={handleRisk}>⚠ {position.risk ? t('card.riskOff', locale) : t('card.riskOn', locale)}</button>
          )}
          {!position.lost && !isClient && stageOrder(position.stage) < 3 && (
            <button type="button" className="act quote" disabled={acting} onClick={handleQuoteRequested}>📄 {t('card.quoteRequested', locale)}</button>
          )}
          <button type="button" className={`act ai${prospect.ai_managed === false ? ' off' : ''}`} disabled={acting} onClick={handleToggleAiManaged}>
            {prospect.ai_managed === false ? `⏸ ${t('prospects.aiManagedOffLabel', locale)}` : `🤖 ${t('prospects.aiManagedOnLabel', locale)}`}
          </button>
          <button type="button" className="act" onClick={scrollToInfos}>✏️ {t('card.edit', locale)}</button>
          <button type="button" className="act" onClick={handleSaveToPhone}>📱 {t('card.saveToPhone', locale)}</button>
          {onLinkedin && (
            <button type="button" className="act" onClick={() => onLinkedin(prospect)}>{t('prospects.linkedinMessageButton', locale)}</button>
          )}
          <button type="button" className="act delete" disabled={acting} onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>🗑 {t('common.delete', locale)}</button>
        </div>

        {feedback && <p className={`feedback ${feedback.type}`}>{feedback.text}</p>}

        {panel === 'won' && (
          <div className="panel">
            <p className="panel-title">{t('prospects.wonModalTitle', locale)}</p>
            <p className="panel-text">{t('prospects.wonModalBodyLine2', locale)}</p>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>{t('common.cancel', locale)}</button>
              <button type="button" className="btn-secondary" disabled={acting} onClick={() => handleWon(false)}>{t('prospects.wonModalNotYet', locale)}</button>
              <button type="button" className="btn-primary" disabled={acting} onClick={() => handleWon(true)}>{t('prospects.wonModalConfirmed', locale)}</button>
            </div>
          </div>
        )}

        {panel === 'lost' && (
          <div className="panel">
            <p className="panel-title">{t('card.lostTitle', locale).replace('{name}', prospect.full_name)}</p>
            <p className="panel-text">{t('card.lostWhy', locale)}</p>
            <div className="chips">
              {LOST_REASONS.map((r) => (
                <button type="button" key={r} className={`chip${lostReason === r ? ' on' : ''}`} onClick={() => setLostReason(r)}>
                  {t(`pipeline.lostReason.${r}`, locale)}
                </button>
              ))}
            </div>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>{t('common.cancel', locale)}</button>
              <button type="button" className="btn-danger" disabled={acting} onClick={handleLost}>{t('card.lostConfirm', locale)}</button>
            </div>
          </div>
        )}

        {panel === 'move' && (
          <div className="panel">
            <p className="panel-title">{t('card.moveTitle', locale)}</p>
            <p className="panel-text">{t('card.moveHint', locale)}</p>
            <div className="stage-list">
              {PIPELINE_STAGES.map((s) => {
                const current = !position.lost && s.key === position.stage;
                return (
                  <button
                    type="button"
                    key={s.key}
                    className={`stage-opt${current ? ' current' : ''}`}
                    disabled={acting || current}
                    onClick={() => handleMove(s.key)}
                  >
                    <span className="stage-dot" style={{ background: PIPELINE_COLORS[s.category] }} />
                    <span className="stage-name">{CATEGORY_ICONS[s.category]} {t(s.labelKey, locale)}</span>
                    <span className="stage-hint">{t(s.hintKey, locale)}</span>
                  </button>
                );
              })}
            </div>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>{t('common.cancel', locale)}</button>
            </div>
          </div>
        )}

        {panel === 'delete' && (
          <div className="panel danger">
            <p className="panel-title">{t('card.deleteTitle', locale).replace('{name}', prospect.full_name)}</p>
            <p className="panel-text">{t('card.deleteWarning', locale)}</p>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>{t('common.cancel', locale)}</button>
              <button type="button" className="btn-danger" disabled={acting} onClick={handleDelete}>{t('card.deleteConfirm', locale)}</button>
            </div>
          </div>
        )}

        <section className="block">
          <h3>{t('card.convictionTitle', locale)}</h3>
          {conviction != null ? (
            <div className="conviction">
              <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, conviction))}%`, background: conviction >= 70 ? PIPELINE_COLORS.client : conviction >= 40 ? PIPELINE_COLORS.wonPending : PIPELINE_COLORS.lost }} /></div>
              <span className="score">{conviction}/100</span>
            </div>
          ) : (
            <p className="muted">{t('card.convictionNone', locale)}</p>
          )}
          {convictionReason && <p className="text">{frenchTypography(convictionReason)}</p>}
        </section>

        <section className="block">
          <h3>{t('card.personalityTitle', locale)}</h3>
          {prospect.personality_type ? (
            <p className="text">
              <DiscBadge type={prospect.personality_type} locale={locale} /> <strong>{t(`personality.${prospect.personality_type}`, locale)}</strong>
              {prospect.personality_notes && <> — {frenchTypography(prospect.personality_notes)}</>}
            </p>
          ) : (
            <p className="muted">{t('prospects.personalityNotYetDetected', locale)}</p>
          )}
        </section>

        <section className="block">
          <h3>{t('modal.aaronAdvice', locale)}</h3>
          {prospect.aaron_advice ? <p className="text">{frenchTypography(prospect.aaron_advice)}</p> : <p className="muted">—</p>}
        </section>

        <section className="block" ref={infosRef}>
          <h3>{t('card.infosTitle', locale)}</h3>
          <ContactInfoEditor prospect={prospect} locale={locale} onSaved={onChanged} />
          <CompanyInfoEditor prospect={prospect} locale={locale} onSaved={onChanged} />
        </section>

        {showDealTools && (
          <section className="block">
            <h3>{t('card.dealToolsTitle', locale)}</h3>
            <DealTools prospect={prospect} locale={locale} userId={userId} onChanged={onChanged} />
          </section>
        )}

        {isFullClient && (
          <section className="block">
            <h3>{t('card.clientToolsTitle', locale)}</h3>
            <p className="muted small">{t('card.clientToolsHint', locale)}</p>
            <a className="btn-secondary link-btn" href={`/app/customer?user_id=${userId}&client_id=${prospect.id}`}>{t('card.clientToolsOpen', locale)} →</a>
          </section>
        )}

        <section className="block">
          <h3>{t('card.historyTitle', locale)}</h3>
          {messagesLoading ? (
            <p className="muted">{t('common.loading', locale)}</p>
          ) : messages.length === 0 ? (
            <p className="muted">{t('modal.noExchangeYet', locale)}</p>
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <div className={`msg msg-${m.direction}`} key={i}>
                  <p className="msg-meta">
                    {m.direction === 'outbound' ? t('prospects.outboundBadge', locale) : t('prospects.inboundLabel', locale)}
                    {' — '}
                    {new Date(m.sent_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  <p className="msg-body">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <style jsx>{`
        .card-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 6, 12, 0.55);
          backdrop-filter: blur(2px);
          z-index: 120;
          display: flex;
          justify-content: flex-end;
        }
        .card {
          width: min(560px, 100%);
          height: 100%;
          background: var(--surface);
          border-left: 1px solid var(--border);
          box-shadow: var(--shadow-lg);
          overflow-y: auto;
          padding: 1.4rem 1.5rem 3rem;
          box-sizing: border-box;
          animation: slide-in 0.25s var(--ease);
          -webkit-overflow-scrolling: touch;
        }
        @keyframes slide-in { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
        .grab { display: none; }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.8rem;
        }
        .head-main { display: flex; gap: 0.8rem; min-width: 0; }
        .cat-icon {
          width: 2.6rem;
          height: 2.6rem;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          flex-shrink: 0;
        }
        .head-text { min-width: 0; }
        h2 {
          font-family: var(--font-display);
          font-size: 1.25rem;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .sub { color: var(--muted); font-size: 0.84rem; margin: 0.2rem 0 0.5rem; overflow-wrap: anywhere; }
        .pills { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.15rem 0.6rem;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .muted-pill { color: var(--muted); border-color: var(--border); }
        .alert-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.2rem;
          height: 1.2rem;
          border-radius: 50%;
          background: var(--accent-red);
          color: #fff;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .close {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 50%;
          width: 2.1rem;
          height: 2.1rem;
          cursor: pointer;
          flex-shrink: 0;
          font-size: 0.9rem;
        }
        .progress-wrap { margin: 1.3rem 0 0.4rem; padding: 0 0.2rem; }
        .alerts { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 1rem; }
        .alert {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
          border-radius: var(--radius-md);
          padding: 0.55rem 0.8rem;
          font-size: 0.82rem;
          font-weight: 600;
        }
        .alert.urgent { background: rgba(239, 68, 89, 0.14); color: var(--accent-red); border: 1px solid rgba(239, 68, 89, 0.4); }
        .alert.todo { background: rgba(245, 166, 35, 0.12); color: var(--accent-amber); border: 1px solid rgba(245, 166, 35, 0.4); }
        .mini {
          background: transparent;
          border: 1px solid currentColor;
          color: inherit;
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.6rem;
          font-size: 0.74rem;
          cursor: pointer;
          text-decoration: none;
          white-space: nowrap;
          font-family: inherit;
        }
        .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 1.1rem; }
        .act {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.45rem 0.7rem;
          font-size: 0.78rem;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .act:disabled { opacity: 0.55; cursor: not-allowed; }
        .act.won { border-color: var(--accent-green); color: var(--accent-green); }
        .act.lost { border-color: var(--accent-red); color: var(--accent-red); }
        .act.delete { color: var(--accent-red); }
        .act.quote { border-color: var(--accent); color: var(--accent-light); }
        .act.ai { border-color: var(--accent); color: var(--accent-light); }
        .act.ai.off { border-color: var(--muted); color: var(--muted); }
        .act.risk-on { border-color: #f0914e; color: #f0914e; }
        .feedback { font-size: 0.82rem; margin: 0.7rem 0 0; }
        .feedback.error { color: var(--accent-red); }
        .feedback.ok { color: var(--accent-green); }
        .panel {
          margin-top: 0.9rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
        }
        .panel.danger { border-color: var(--accent-red); }
        .panel-title { font-weight: 600; font-size: 0.9rem; margin: 0 0 0.3rem; }
        .panel-text { color: var(--muted); font-size: 0.82rem; margin: 0 0 0.7rem; line-height: 1.45; }
        .panel-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; margin-top: 0.6rem; }
        .btn-secondary, .btn-primary, .btn-danger {
          border-radius: var(--radius-md);
          padding: 0.5rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          border: 1px solid var(--border);
          font-family: inherit;
          text-decoration: none;
        }
        .btn-secondary { background: var(--surface); color: var(--text); }
        .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .btn-danger { background: var(--accent-red); color: #fff; border-color: var(--accent-red); }
        .btn-secondary:disabled, .btn-primary:disabled, .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
        .link-btn { display: inline-block; }
        .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .chip {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          font-size: 0.78rem;
          cursor: pointer;
          font-family: inherit;
        }
        .chip.on { border-color: var(--accent-red); color: var(--text); background: rgba(239, 68, 89, 0.14); }
        .stage-list { display: flex; flex-direction: column; gap: 0.35rem; }
        .stage-opt {
          display: grid;
          grid-template-columns: auto 1fr;
          column-gap: 0.6rem;
          align-items: center;
          text-align: left;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.7rem;
          cursor: pointer;
          font-family: inherit;
          color: var(--text);
        }
        .stage-opt:hover:not(:disabled) { border-color: var(--accent); }
        .stage-opt.current { border-color: var(--accent); background: rgba(75, 57, 239, 0.12); cursor: default; }
        .stage-opt:disabled:not(.current) { opacity: 0.5; }
        .stage-dot { width: 10px; height: 10px; border-radius: 50%; grid-row: span 2; }
        .stage-name { font-size: 0.84rem; font-weight: 600; }
        .stage-hint { font-size: 0.74rem; color: var(--muted); grid-column: 2; }
        .block { margin-top: 1.3rem; padding-top: 1.1rem; border-top: 1px solid var(--border); }
        .block h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 0.6rem; }
        .text { font-size: 0.86rem; line-height: 1.55; margin: 0 0 0.4rem; overflow-wrap: anywhere; }
        .muted { color: var(--muted); font-size: 0.84rem; margin: 0; }
        .small { font-size: 0.8rem; margin-bottom: 0.6rem; }
        .conviction { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.5rem; }
        .bar { flex: 1; height: 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); overflow: hidden; }
        .bar span { display: block; height: 100%; border-radius: 999px; }
        .score { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
        .thread { display: flex; flex-direction: column; gap: 0.6rem; max-height: 360px; overflow-y: auto; }
        .msg { border-radius: var(--radius-md); padding: 0.7rem 0.9rem; font-size: 0.82rem; border: 1px solid var(--border); }
        .msg-outbound { background: rgba(75, 57, 239, 0.1); margin-left: 1.2rem; }
        .msg-inbound { background: var(--bg); margin-right: 1.2rem; }
        .msg-meta { color: var(--muted); font-size: 0.72rem; margin: 0 0 0.35rem; }
        .msg-body { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
        @media (max-width: 900px) {
          .card-overlay { align-items: flex-end; }
          .card {
            width: 100%;
            height: 94dvh;
            height: 94vh;
            border-left: none;
            border-top: 1px solid var(--border);
            border-radius: 22px 22px 0 0;
            padding: 0.4rem 1rem calc(3rem + env(safe-area-inset-bottom));
            animation: sheet-in 0.28s var(--ease);
          }
          @keyframes sheet-in { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
          .grab { display: flex; justify-content: center; padding: 0.4rem 0 0.8rem; touch-action: none; }
          .grab span { width: 42px; height: 5px; border-radius: 999px; background: var(--border); }
          .act { flex: 1 1 calc(50% - 0.4rem); text-align: center; padding: 0.6rem 0.5rem; font-size: 0.8rem; }
          .actions { gap: 0.4rem; }
          h2 { font-size: 1.15rem; }
        }
      `}</style>
    </div>
  );
}
