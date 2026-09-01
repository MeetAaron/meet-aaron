'use client';

// components/Stories.jsx
//
// Notifications « à la Instagram » (docx « mon avis » d'Alex, 31/08/2026) :
//   - <Stories mode="strip" /> : bandeau de cercles en haut du tableau de
//     bord et de Prospects — un cercle par TYPE de notification en attente
//     (seulement ceux dont le compte est > 0), le nombre dans le cercle, le
//     libellé dessous, anneau coloré selon l'urgence.
//   - <Stories mode="bell" /> : cloche compacte (rail d'icônes / barre du
//     haut sur téléphone) avec pastille rouge, pour les autres pages.
//   Un clic ouvre le lecteur : une notification à la fois, barre de segments
//   en haut (position dans la file, PAS un compte à rebours), flèches /
//   glisser gauche-droite pour passer d'une notif à l'autre, glisser
//   haut-bas ou Échap pour fermer. « Passer » remet la notif en fin de file
//   sans la supprimer : elle ne disparaît que quand l'action est faite.
//   Profil DISC à côté du nom, bouton « Historique des échanges » qui ouvre
//   la fiche contact.
//
// Données : GET /api/notifications (lib/notifications.ts), rafraîchi à
// l'ouverture et toutes les 60 s.

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { frenchTypography } from '@/lib/text-typography';
import { DiscBadge } from '@/components/ContactCard';

const RING = {
  devis_a_faire: 'linear-gradient(135deg, #ef4459, #f5a623)',
  rdv_a_valider: 'linear-gradient(135deg, #f5a623, #ffd166)',
  rdv_aujourdhui: 'linear-gradient(135deg, #4b39ef, #7c6ef5)',
  rdv_manque: 'linear-gradient(135deg, #ef4459, #b07cf5)',
  rdv_annule: 'linear-gradient(135deg, #f5a623, #ef4459)',
  sauvetage_a_valider: 'linear-gradient(135deg, #f0914e, #f5a623)',
  email_a_valider: 'linear-gradient(135deg, #4b9ef0, #7c6ef5)',
  bilan_a_faire: 'linear-gradient(135deg, #b07cf5, #4b39ef)',
  commande_a_confirmer: 'linear-gradient(135deg, #3dd68c, #4b9ef0)',
  a_risque: 'linear-gradient(135deg, #f0914e, #ef4459)',
};

const ICON = {
  devis_a_faire: '📄',
  rdv_a_valider: '📅',
  rdv_aujourdhui: '⏰',
  rdv_manque: '⚠️',
  rdv_annule: '↩️',
  sauvetage_a_valider: '🛟',
  email_a_valider: '✉️',
  bilan_a_faire: '📝',
  commande_a_confirmer: '🏆',
  a_risque: '🔥',
};

export function useNotifications(userId, { refreshMs = 60000 } = {}) {
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/notifications?user_id=${userId}`);
      const body = await res.json();
      if (res.ok) {
        setGroups(body.groups || []);
        setTotal(body.total || 0);
      }
    } catch {}
    setLoaded(true);
  }, [userId]);
  useEffect(() => {
    load();
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);
  return { groups, total, loaded, reload: load };
}

export default function Stories({ userId, locale, mode = 'strip', onOpenContact, onChanged }) {
  const { groups, total, loaded, reload } = useNotifications(userId);
  const [open, setOpen] = useState(null); // { deck: NotificationItem[], index }
  // Panneau « rien à traiter » de la cloche (01/09/2026) — voir openAll.
  const [emptyOpen, setEmptyOpen] = useState(false);

  function openGroup(type) {
    const ordered = [...groups.filter((g) => g.type === type), ...groups.filter((g) => g.type !== type)];
    const deck = ordered.flatMap((g) => g.items);
    if (deck.length === 0) return;
    setOpen({ deck, index: 0 });
  }

  function openAll() {
    const deck = groups.flatMap((g) => g.items);
    // File vide : avant (01/09/2026) le clic ne faisait STRICTEMENT rien —
    // Alex a légitimement cru la cloche cassée. On affiche maintenant un
    // petit panneau « rien à traiter » qui explique ce qui atterrira ici.
    if (deck.length === 0) {
      setEmptyOpen((v) => !v);
      return;
    }
    setEmptyOpen(false);
    setOpen({ deck, index: 0 });
  }

  async function handleChanged() {
    await reload();
    onChanged && onChanged();
  }

  // Après une action (notif résolue) : on retire l'item de la file locale et
  // on passe à la suivante, sans attendre le rechargement.
  function resolveCurrent() {
    setOpen((prev) => {
      if (!prev) return prev;
      const deck = prev.deck.filter((_, i) => i !== prev.index);
      if (deck.length === 0) return null;
      return { deck, index: Math.min(prev.index, deck.length - 1) };
    });
    handleChanged();
  }

  if (mode === 'bell') {
    return (
      <>
        <button type="button" className="bell" onClick={openAll} title={t('stories.bellTitle', locale)} aria-label={t('stories.bellTitle', locale)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          {total > 0 && <span className="bell-badge">{total > 99 ? '99+' : total}</span>}
        </button>
        {emptyOpen && (
          <div className="bell-empty" role="dialog">
            <strong>{t('stories.emptyTitle', locale)}</strong>
            <p>{t('stories.emptyBody', locale)}</p>
          </div>
        )}
        {open && <StoryViewer state={open} setState={setOpen} locale={locale} userId={userId} onResolved={resolveCurrent} onOpenContact={onOpenContact} />}
        <style jsx>{`
          .bell-empty {
            position: absolute;
            z-index: 60;
            left: 100%;
            margin-left: 0.6rem;
            top: 0;
            width: 240px;
            padding: 0.85rem 0.95rem;
            border-radius: 12px;
            border: 1px solid var(--border);
            background: var(--card, var(--bg));
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
          }
          .bell-empty strong {
            display: block;
            font-size: 0.86rem;
            margin-bottom: 0.3rem;
          }
          .bell-empty p {
            margin: 0;
            font-size: 0.78rem;
            line-height: 1.45;
            color: var(--muted);
          }
          @media (max-width: 900px) {
            .bell-empty {
              left: auto;
              right: 0;
              top: 100%;
              margin-left: 0;
              margin-top: 0.5rem;
            }
          }
          .bell {
            position: relative;
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            width: 100%;
            height: 100%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
          }
          .bell-badge {
            position: absolute;
            top: -4px;
            right: -6px;
            min-width: 17px;
            height: 17px;
            padding: 0 4px;
            border-radius: 999px;
            background: var(--accent-red);
            color: #fff;
            font-size: 0.66rem;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 0 2px var(--surface);
          }
        `}</style>
      </>
    );
  }

  if (!loaded || groups.length === 0) return null;

  return (
    <div className="stories">
      {groups.map((g) => (
        <button type="button" key={g.type} className="story" onClick={() => openGroup(g.type)} title={t(`stories.type.${g.type}`, locale)}>
          <span className="ring" style={{ background: RING[g.type] }}>
            <span className="inner">
              <span className="count">{g.count}</span>
              <span className="ic">{ICON[g.type]}</span>
            </span>
          </span>
          <span className="lbl">{t(`stories.type.${g.type}`, locale)}</span>
        </button>
      ))}
      {open && <StoryViewer state={open} setState={setOpen} locale={locale} userId={userId} onResolved={resolveCurrent} onOpenContact={onOpenContact} />}
      <style jsx>{`
        .stories {
          display: flex;
          gap: 0.9rem;
          overflow-x: auto;
          padding: 0.2rem 0.2rem 0.6rem;
          margin: 0 0 1.2rem;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .stories::-webkit-scrollbar { display: none; }
        .story {
          flex: 0 0 auto;
          width: 76px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          color: var(--text);
          font-family: inherit;
        }
        .ring {
          width: 66px;
          height: 66px;
          border-radius: 50%;
          padding: 3px;
          display: inline-flex;
          transition: transform var(--fast);
        }
        .story:hover .ring { transform: scale(1.05); }
        .inner {
          flex: 1;
          border-radius: 50%;
          background: var(--surface);
          border: 2px solid var(--bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .count { font-family: var(--font-display); font-weight: 700; font-size: 1.25rem; }
        .ic { font-size: 0.8rem; margin-top: 2px; }
        .lbl {
          font-size: 0.66rem;
          color: var(--muted);
          text-align: center;
          line-height: 1.15;
          max-width: 76px;
        }
      `}</style>
    </div>
  );
}

function StoryViewer({ state, setState, locale, userId, onResolved, onOpenContact }) {
  const { deck, index } = state;
  const item = deck[index];
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null);
  const touch = useRef(null);

  const close = useCallback(() => setState(null), [setState]);
  const next = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      if (prev.index >= prev.deck.length - 1) return null;
      return { ...prev, index: prev.index + 1 };
    });
  }, [setState]);
  const prev = useCallback(() => {
    setState((p) => (p && p.index > 0 ? { ...p, index: p.index - 1 } : p));
  }, [setState]);
  // « Passer » : remet la notif en fin de file, sans la supprimer.
  const skip = useCallback(() => {
    setState((p) => {
      if (!p) return p;
      if (p.deck.length <= 1) return null;
      const deck = [...p.deck];
      const [cur] = deck.splice(p.index, 1);
      deck.push(cur);
      if (p.index >= deck.length - 1) return null;
      return { deck, index: p.index };
    });
  }, [setState]);

  useEffect(() => {
    setError(null);
  }, [item?.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close, next, prev]);

  function onTouchStart(e) {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) {
      close();
    } else if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
  }

  async function act(url, body, { resolve = true } = {}) {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.conflict) {
        const reasons = (json.reasons || []).join('\n');
        if (window.confirm(`${t('stories.conflictConfirm', locale)}\n${reasons}`)) {
          return act(url, { ...body, force: true }, { resolve });
        }
        return false;
      }
      if (!res.ok) {
        setError(json.error || t('stories.actionError', locale));
        return false;
      }
      if (resolve) onResolved();
      return true;
    } finally {
      setActing(false);
    }
  }

  const [planCall, setPlanCall] = useState(false);
  const [planAt, setPlanAt] = useState('');
  const [replyMode, setReplyMode] = useState(null); // null | 'choose' | 'missing' | 'draft'
  const [missingInfo, setMissingInfo] = useState('');
  const [draft, setDraft] = useState({ subject: '', body: '' });

  useEffect(() => {
    setReplyMode(null);
    setMissingInfo('');
    setDraft({ subject: '', body: '' });
    setPlanCall(false);
  }, [item?.id]);

  async function quoteReply(payload, resolveAfter) {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${item.prospect_id}/quote-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || t('stories.actionError', locale));
        return null;
      }
      if (resolveAfter) {
        setReplyMode(null);
        onResolved();
      }
      return json;
    } finally {
      setActing(false);
    }
  }

  async function draftMissingInfo() {
    const json = await quoteReply({ action: 'draft_missing_info', details: missingInfo }, false);
    if (json && json.subject) {
      setDraft({ subject: json.subject, body: json.body || '' });
      setReplyMode('draft');
    }
  }

  // Crée un RDV téléphonique manuel (validé) pour ce contact ; si l'appel a
  // déjà eu lieu, enchaîne directement sur la page de bilan.
  async function createCall(proposedAtIso, goToBilan) {
    setActing(true);
    setError(null);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, prospect_id: item.prospect_id, type: 'telephonique', proposed_at: proposedAtIso }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || t('stories.actionError', locale));
        return;
      }
      if (goToBilan && json.appointment?.id) {
        window.location.href = `/app/agenda/rdv/${json.appointment.id}/bilan?user_id=${userId}`;
        return;
      }
      setPlanCall(false);
      onResolved();
    } finally {
      setActing(false);
    }
  }

  function openContact() {
    if (!item.prospect_id) return;
    if (onOpenContact) {
      close();
      onOpenContact(item.prospect_id);
    } else {
      window.location.href = `/app/prospects?user_id=${userId}&contact=${item.prospect_id}`;
    }
  }

  if (!item) return null;

  const when = item.at ? new Date(item.at) : null;
  const whenLabel = when ? `${when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · ${when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}` : '';
  const prospectUrl = `/api/prospects/${item.prospect_id}`;
  const apptUrl = `/api/appointments/${item.appointment_id}`;

  let body = null;
  let actions = null;
  switch (item.type) {
    case 'devis_a_faire':
      // Lot 3 « Devis » : « Répondre » → soit Aaron rédige un email pour
      // demander les infos manquantes (modifiable avant envoi), soit « je lui
      // écris moi-même sous 24h » (relance quotidienne en pause).
      body = (
        <>
          <p className="lead">{t('stories.devisLead', locale).replace('{name}', item.prospect_name).replace('{days}', item.days_waiting ?? 0)}</p>
          {item.meta?.paused ? (
            <p className="hint">⏸ {t('stories.devisPausedHint', locale)}</p>
          ) : (
            <p className="advice">💬 {t(`stories.devisAdvice${item.meta?.advice_level ?? 0}`, locale)}</p>
          )}
          {item.meta?.has_draft && !replyMode && <p className="hint">{t('stories.devisDraftHint', locale)}</p>}
          {replyMode === 'choose' && (
            <div className="reply-box">
              <button type="button" className="reply-opt" onClick={() => setReplyMode('missing')}>
                <strong>{t('stories.replyMissingTitle', locale)}</strong>
                <span>{t('stories.replyMissingHint', locale)}</span>
              </button>
              <button type="button" className="reply-opt" disabled={acting} onClick={() => quoteReply({ action: 'pause' }, true)}>
                <strong>{t('stories.replySelfTitle', locale)}</strong>
                <span>{t('stories.replySelfHint', locale)}</span>
              </button>
            </div>
          )}
          {replyMode === 'missing' && (
            <div className="reply-box">
              <textarea rows={3} className="reply-input" placeholder={t('stories.replyMissingPlaceholder', locale)} value={missingInfo} onChange={(e) => setMissingInfo(e.target.value)} />
              <div className="reply-row">
                <button type="button" className="btn-primary" disabled={acting || !missingInfo.trim()} onClick={draftMissingInfo}>{acting ? t('sales.generating', locale) : t('stories.replyDraft', locale)}</button>
                <button type="button" className="btn-secondary" onClick={() => setReplyMode('choose')}>{t('common.back', locale)}</button>
              </div>
            </div>
          )}
          {replyMode === 'draft' && (
            <div className="reply-box">
              <input className="reply-input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              <textarea rows={7} className="reply-input" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              <div className="reply-row">
                <button type="button" className="btn-primary" disabled={acting || !draft.subject.trim() || !draft.body.trim()} onClick={() => quoteReply({ action: 'send', subject: draft.subject, body: draft.body }, true)}>{acting ? t('sales.sending', locale) : t('stories.send', locale)}</button>
                <button type="button" className="btn-secondary" onClick={() => setReplyMode('missing')}>{t('common.back', locale)}</button>
              </div>
            </div>
          )}
        </>
      );
      actions = !replyMode ? (
        <>
          <button type="button" className="btn-primary" onClick={openContact}>{t('stories.openCardQuote', locale)}</button>
          <button type="button" className="btn-secondary" onClick={() => setReplyMode('choose')}>{t('stories.reply', locale)}</button>
        </>
      ) : null;
      break;
    case 'rdv_a_valider':
      body = (
        <>
          <p className="lead">{t('stories.rdvValiderLead', locale).replace('{name}', item.prospect_name)}</p>
          <p className="when">📅 {whenLabel} · {t(`apptType.${item.meta?.appt_type}`, locale)}</p>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(apptUrl, { action: 'valider' })}>{t('stories.validate', locale)}</button>
          <button type="button" className="btn-danger" disabled={acting} onClick={() => window.confirm(t('stories.cancelConfirm', locale)) && act(apptUrl, { action: 'annuler' })}>{t('stories.cancelRdv', locale)}</button>
        </>
      );
      break;
    case 'rdv_aujourdhui':
      body = (
        <>
          <p className="lead">{t('stories.rdvTodayLead', locale).replace('{name}', item.prospect_name)}</p>
          <p className="when">⏰ {when ? when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : ''} · {t(`apptType.${item.meta?.appt_type}`, locale)}</p>
        </>
      );
      actions = (
        <>
          {item.meta?.meet_link && <a className="btn-primary" href={item.meta.meet_link} target="_blank" rel="noopener noreferrer">{t('stories.joinVisio', locale)}</a>}
          <button type="button" className="btn-secondary" onClick={openContact}>{t('stories.openBrief', locale)}</button>
        </>
      );
      break;
    case 'rdv_manque':
      body = (
        <>
          <p className="lead">{t('stories.rdvManqueLead', locale).replace('{name}', item.prospect_name)}</p>
          <p className="when">📅 {whenLabel}</p>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(apptUrl, { action: 'acquitter_manque' })}>{t('stories.seen', locale)}</button>
          <button type="button" className="btn-secondary" onClick={openContact}>{t('stories.openCard', locale)}</button>
        </>
      );
      break;
    case 'rdv_annule':
      body = (
        <>
          <p className="lead">{t(item.meta?.cancelled_by === 'client' ? 'stories.rdvAnnuleClientLead' : 'stories.rdvAnnuleCommercialLead', locale).replace('{name}', item.prospect_name)}</p>
          <p className="when">📅 {whenLabel}</p>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(apptUrl, { action: 'relancer' })}>{t('stories.relancer', locale)}</button>
          <button type="button" className="btn-secondary" disabled={acting} onClick={() => act(apptUrl, { action: 'traiter' })}>{t('stories.treated', locale)}</button>
        </>
      );
      break;
    case 'sauvetage_a_valider':
      body = (
        <>
          <p className="lead">{t('stories.sauvetageLead', locale).replace('{name}', item.prospect_name)}</p>
          <div className="mail"><p className="subject">{item.meta?.subject}</p><p className="mailbody">{item.meta?.body}</p></div>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(prospectUrl, { action: 'approuver_sauvetage' })}>{t('stories.send', locale)}</button>
          <button type="button" className="btn-secondary" disabled={acting} onClick={() => act(prospectUrl, { action: 'rejeter_sauvetage' })}>{t('stories.refuse', locale)}</button>
        </>
      );
      break;
    case 'email_a_valider':
      body = (
        <>
          <p className="lead">{t('stories.emailLead', locale).replace('{name}', item.prospect_name)}</p>
          <div className="mail"><p className="subject">{item.meta?.subject}</p><p className="mailbody">{item.meta?.body}</p></div>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(prospectUrl, { action: 'envoyer_premier_email' })}>{t('stories.sendAsIs', locale)}</button>
          <button type="button" className="btn-secondary" onClick={openContact}>{t('stories.editBeforeSend', locale)}</button>
          <button type="button" className="btn-danger" disabled={acting} onClick={() => act(prospectUrl, { action: 'rejeter_premier_email' })}>{t('stories.refuse', locale)}</button>
        </>
      );
      break;
    case 'bilan_a_faire':
      body = (
        <>
          <p className="lead">{t('stories.bilanLead', locale).replace('{name}', item.prospect_name)}</p>
          <p className="when">📅 {whenLabel} · {t(`apptType.${item.meta?.appt_type}`, locale)}</p>
        </>
      );
      actions = (
        <a className="btn-primary" href={`/app/agenda/rdv/${item.appointment_id}/bilan?user_id=${userId}`}>{t('agenda.bilanTodo', locale)}</a>
      );
      break;
    case 'commande_a_confirmer':
      body = <p className="lead">{t('stories.commandeLead', locale).replace('{name}', item.prospect_name)}</p>;
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => act(prospectUrl, { action: 'confirmer_premiere_commande' })}>{t('prospects.confirmOrderButton', locale)}</button>
          <button type="button" className="btn-secondary" onClick={openContact}>{t('stories.openCard', locale)}</button>
        </>
      );
      break;
    case 'a_risque':
      // Flux « appel de sauvetage » (docx « mon avis ») : le commercial
      // rouvre la notif, dit que l'appel a eu lieu (→ bilan avec les puces)
      // ou qu'il est prévu (→ RDV téléphonique dans l'agenda).
      body = (
        <>
          <p className="lead">{t('stories.risqueLead', locale).replace('{name}', item.prospect_name)}</p>
          {item.meta?.advice && <p className="advice">💬 {frenchTypography(item.meta.advice)}</p>}
          {planCall && (
            <div className="plan-row">
              <input type="datetime-local" value={planAt} onChange={(e) => setPlanAt(e.target.value)} className="plan-input" />
              <button type="button" className="btn-primary" disabled={acting || !planAt} onClick={() => createCall(new Date(planAt).toISOString(), false)}>{t('common.save', locale)}</button>
            </div>
          )}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn-primary" disabled={acting} onClick={() => createCall(new Date(Date.now() - 60000).toISOString(), true)}>📞 {t('stories.callDone', locale)}</button>
          <button type="button" className="btn-secondary" disabled={acting} onClick={() => setPlanCall((v) => !v)}>📅 {t('stories.callPlanned', locale)}</button>
          <button type="button" className="btn-secondary" onClick={openContact}>{t('stories.openCard', locale)}</button>
          <button type="button" className="btn-secondary" disabled={acting} onClick={() => act(prospectUrl, { action: 'set_pipeline_risk', risk: false })}>{t('card.riskOff', locale)}</button>
        </>
      );
      break;
    default:
      body = <p className="lead">{item.prospect_name}</p>;
  }

  return (
    <div className="viewer" onClick={close}>
      <div className="story-card" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ '--ring': RING[item.type] }}>
        <div className="segments">
          {deck.map((d, i) => (
            <span key={d.id} className={`seg${i < index ? ' done' : ''}${i === index ? ' cur' : ''}`} />
          ))}
        </div>
        <div className="head">
          <span className="type-ic">{ICON[item.type]}</span>
          <div className="head-text">
            <p className="type">{t(`stories.type.${item.type}`, locale)} <span className="pos">{index + 1}/{deck.length}</span></p>
            <p className="name">
              {item.prospect_name}
              <DiscBadge type={item.personality_type} locale={locale} />
            </p>
            {item.company_name && <p className="company">{item.company_name}</p>}
          </div>
          <button type="button" className="close" onClick={close} aria-label={t('common.close', locale)}>✕</button>
        </div>
        <div className="body">{body}</div>
        {error && <p className="error">{error}</p>}
        <div className="actions">{actions}</div>
        <div className="foot">
          {item.prospect_id && (
            <button type="button" className="link" onClick={openContact}>{t('stories.history', locale)}</button>
          )}
          <button type="button" className="link skip" onClick={skip}>{t('stories.skip', locale)} →</button>
        </div>
        <button type="button" className="nav prev" onClick={prev} aria-label="←" disabled={index === 0}>‹</button>
        <button type="button" className="nav next" onClick={next} aria-label="→">›</button>
      </div>
      <style jsx>{`
        .viewer {
          position: fixed;
          inset: 0;
          background: rgba(5, 6, 12, 0.82);
          backdrop-filter: blur(6px);
          z-index: 130;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .story-card {
          position: relative;
          width: min(460px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 22px;
          padding: 0.9rem 1.2rem 1.1rem;
          box-sizing: border-box;
          box-shadow: var(--shadow-lg);
          animation: pop 0.22s var(--ease);
        }
        .story-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 22px;
          padding: 2px;
          background: var(--ring);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          opacity: 0.8;
        }
        @keyframes pop { from { transform: scale(0.96); opacity: 0; } to { transform: none; opacity: 1; } }
        .segments { display: flex; gap: 3px; margin-bottom: 0.9rem; }
        .seg { flex: 1; height: 3px; border-radius: 999px; background: rgba(244, 241, 234, 0.18); }
        .seg.done { background: rgba(244, 241, 234, 0.55); }
        .seg.cur { background: #fff; }
        .head { display: flex; align-items: flex-start; gap: 0.7rem; }
        .type-ic {
          width: 2.4rem;
          height: 2.4rem;
          border-radius: 50%;
          background: var(--ring);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 1.1rem;
          flex-shrink: 0;
        }
        .head-text { flex: 1; min-width: 0; }
        .type { margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
        .pos { text-transform: none; letter-spacing: 0; font-family: var(--font-mono); margin-left: 0.3rem; }
        .name { margin: 0.15rem 0 0; font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; display: flex; align-items: center; gap: 0.45rem; }
        .company { margin: 0.1rem 0 0; font-size: 0.8rem; color: var(--muted); }
        .close {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
          padding: 0.2rem 0.4rem;
        }
        .body { margin-top: 1rem; }
        .body :global(.lead) { font-size: 0.95rem; line-height: 1.5; margin: 0 0 0.6rem; }
        .body :global(.when) { font-size: 0.9rem; font-weight: 600; margin: 0 0 0.6rem; }
        .body :global(.advice) {
          background: rgba(75, 57, 239, 0.12);
          border-left: 3px solid var(--accent);
          border-radius: 0 var(--radius-md) var(--radius-md) 0;
          padding: 0.6rem 0.8rem;
          font-size: 0.86rem;
          line-height: 1.5;
          margin: 0 0 0.6rem;
        }
        .body :global(.hint) { font-size: 0.78rem; color: var(--muted); margin: 0; }
        .body :global(.reply-box) { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.6rem; }
        .body :global(.reply-opt) {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.9rem;
          cursor: pointer;
          color: var(--text);
          font-family: inherit;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .body :global(.reply-opt:hover) { border-color: var(--accent); }
        .body :global(.reply-opt strong) { font-size: 0.86rem; }
        .body :global(.reply-opt span) { font-size: 0.76rem; color: var(--muted); }
        .body :global(.reply-input) {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.55rem 0.7rem;
          font-size: 16px;
          font-family: inherit;
          resize: vertical;
        }
        .body :global(.reply-row) { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .body :global(.reply-row .btn-primary), .body :global(.reply-row .btn-secondary) {
          border-radius: var(--radius-md);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border);
          font-family: inherit;
        }
        .body :global(.reply-row .btn-primary) { background: var(--accent); color: #fff; border-color: var(--accent); }
        .body :global(.reply-row .btn-secondary) { background: var(--surface); color: var(--text); }
        .body :global(.reply-row button:disabled) { opacity: 0.6; cursor: not-allowed; }
        .body :global(.plan-row) { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.6rem; flex-wrap: wrap; }
        .body :global(.plan-input) {
          flex: 1;
          min-width: 0;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.7rem;
          font-size: 16px;
          font-family: inherit;
        }
        .body :global(.mail) {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.9rem;
          max-height: 220px;
          overflow-y: auto;
        }
        .body :global(.subject) { font-weight: 600; font-size: 0.86rem; margin: 0 0 0.4rem; }
        .body :global(.mailbody) { font-size: 0.8rem; color: var(--muted); white-space: pre-line; margin: 0; }
        .error { color: var(--accent-red); font-size: 0.8rem; margin: 0.6rem 0 0; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
        .actions :global(.btn-primary), .actions :global(.btn-secondary), .actions :global(.btn-danger) {
          border-radius: var(--radius-md);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border);
          text-decoration: none;
          font-family: inherit;
          display: inline-flex;
          align-items: center;
        }
        .actions :global(.btn-primary) { background: var(--accent); color: #fff; border-color: var(--accent); }
        .actions :global(.btn-secondary) { background: var(--bg); color: var(--text); }
        .actions :global(.btn-danger) { background: transparent; color: var(--accent-red); border-color: var(--accent-red); }
        .actions :global(button:disabled) { opacity: 0.6; cursor: not-allowed; }
        .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; gap: 0.6rem; }
        .link {
          background: none;
          border: none;
          color: var(--accent-light);
          text-decoration: underline;
          font-size: 0.82rem;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
        }
        .link.skip { margin-left: auto; color: var(--muted); }
        .nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 2rem;
          height: 2.6rem;
          background: rgba(244, 241, 234, 0.06);
          border: none;
          color: var(--muted);
          font-size: 1.6rem;
          cursor: pointer;
          border-radius: 8px;
          display: none;
        }
        .nav.prev { left: -2.6rem; }
        .nav.next { right: -2.6rem; }
        .nav:disabled { opacity: 0.25; cursor: default; }
        @media (min-width: 640px) {
          .nav { display: block; }
          .story-card { overflow: visible; }
        }
        @media (max-width: 900px) {
          .viewer { padding: 0; align-items: stretch; }
          .story-card {
            width: 100%;
            max-height: none;
            height: 100%;
            border-radius: 0;
            border: none;
            padding: calc(0.8rem + env(safe-area-inset-top)) 1.1rem calc(1.2rem + env(safe-area-inset-bottom));
            display: flex;
            flex-direction: column;
          }
          .story-card::before { display: none; }
          .body { flex: 1; }
          .actions :global(.btn-primary), .actions :global(.btn-secondary), .actions :global(.btn-danger) { flex: 1 1 45%; justify-content: center; padding: 0.8rem 0.9rem; }
        }
      `}</style>
    </div>
  );
}
