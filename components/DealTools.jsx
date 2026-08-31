'use client';

// components/DealTools.jsx
//
// Fusion Prospects + Opportunités (docx « mon avis » d'Alex, 31/08/2026) :
// les outils de l'ancienne page Opportunités (brief avant RDV, compte-rendu
// + relance après RDV, devis, signature électronique) vivent désormais dans
// la fiche contact (components/ContactCard.jsx), affichés dès qu'un contact
// est au moins au stade « RDV obtenu ». Code repris tel quel de
// app/app/sales/page.jsx (mêmes endpoints, mêmes clés i18n `sales.*`),
// style auto-contenu comme les autres composants partagés.

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { frenchTypography } from '@/lib/text-typography';

export default function DealTools({ prospect, locale, userId, onChanged }) {
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState(null);

  const [debriefNotes, setDebriefNotes] = useState('');
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [debriefError, setDebriefError] = useState(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [devis, setDevis] = useState(null);
  const [devisLoading, setDevisLoading] = useState(false);
  const [devisError, setDevisError] = useState(null);
  const [sendingDevis, setSendingDevis] = useState(false);

  const [signatureInput, setSignatureInput] = useState('');
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureSending, setSignatureSending] = useState(false);
  const [signatureSendError, setSignatureSendError] = useState(null);

  useEffect(() => {
    setBrief(null);
    setBriefError(null);
    setDebriefNotes('');
    setDebriefError(null);
    setDevis(null);
    setDevisError(null);
    setSignatureInput('');
  }, [prospect.id]);

  const appt = prospect.latest_appointment || null;

  async function handleLoadBrief(appointmentId) {
    setBriefLoading(true);
    setBriefError(null);
    const res = await fetch(`/api/appointments/${appointmentId}/brief`);
    const body = await res.json();
    setBriefLoading(false);
    if (!res.ok) {
      setBriefError(body.error || t('sales.briefError', locale));
      return;
    }
    setBrief(body.brief);
  }

  async function handleGenerateDebrief(appointmentId) {
    if (!debriefNotes.trim()) {
      setDebriefError(t('sales.debriefNotesRequired', locale));
      return;
    }
    setDebriefLoading(true);
    setDebriefError(null);
    const res = await fetch(`/api/appointments/${appointmentId}/debrief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: debriefNotes }),
    });
    const body = await res.json();
    setDebriefLoading(false);
    if (!res.ok) {
      setDebriefError(body.error || t('sales.debriefGenError', locale));
      return;
    }
    onChanged && onChanged();
  }

  async function handleSendDebriefEmail(appointmentId) {
    setSendingEmail(true);
    const res = await fetch(`/api/appointments/${appointmentId}/debrief/send`, { method: 'POST' });
    const body = await res.json();
    setSendingEmail(false);
    if (!res.ok) {
      setDebriefError(body.error || t('sales.debriefSendError', locale));
      return;
    }
    onChanged && onChanged();
  }

  async function handleLoadDevis(regenerate) {
    setDevisLoading(true);
    setDevisError(null);
    const res = await fetch(`/api/prospects/${prospect.id}/devis${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setDevisLoading(false);
    if (!res.ok) {
      setDevisError(body.error || t('sales.quoteGenError', locale));
      return;
    }
    setDevis(body);
  }

  async function handleSendDevis() {
    setSendingDevis(true);
    setDevisError(null);
    const res = await fetch(`/api/prospects/${prospect.id}/devis`, { method: 'POST' });
    const body = await res.json();
    setSendingDevis(false);
    if (!res.ok) {
      setDevisError(body.error || t('sales.quoteSendError', locale));
      return;
    }
    onChanged && onChanged();
  }

  async function handleSetSignatureLink() {
    if (!signatureInput.trim()) return;
    setSignatureSaving(true);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_signature_link', signature_link: signatureInput.trim() }),
    });
    setSignatureSaving(false);
    setSignatureInput('');
    onChanged && onChanged();
  }

  async function handleClearSignatureLink() {
    setSignatureSaving(true);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_signature_link' }),
    });
    setSignatureSaving(false);
    onChanged && onChanged();
  }

  async function handleSendSignatureRequest() {
    setSignatureSending(true);
    setSignatureSendError(null);
    const res = await fetch(`/api/prospects/${prospect.id}/signature-request`, { method: 'POST' }).then((r) => r.json());
    setSignatureSending(false);
    if (res.error) {
      setSignatureSendError(res.error);
      return;
    }
    onChanged && onChanged();
  }

  const sigColor = prospect.signature_status === 'signe' ? '#3ECF8E' : prospect.signature_status === 'refuse' ? '#E5484D' : '#F5A623';

  return (
    <div className="deal-tools">
      {appt ? (
        <>
          <section className="block">
            <h3>{t('sales.latestApptTitle', locale)}</h3>
            <p className="muted">
              {new Date(appt.proposed_at).toLocaleDateString(locale, { dateStyle: 'medium' })}
              {' — '}
              {t(`apptType.${appt.type}`, locale)}
            </p>
            {!brief && (
              <button type="button" className="btn-secondary" onClick={() => handleLoadBrief(appt.id)} disabled={briefLoading}>
                {briefLoading ? t('sales.generating', locale) : t('sales.viewBrief', locale)}
              </button>
            )}
            {briefError && <p className="error">{briefError}</p>}
            {brief && (
              <div className="brief-box">
                <p><strong>{t('sales.briefSummaryLabel', locale)}</strong> {frenchTypography(brief.resume_historique)}</p>
                {brief.profil_personnalite && <p><strong>{t('sales.briefPersonalityLabel', locale)}</strong> {frenchTypography(brief.profil_personnalite)}</p>}
                {brief.objections_deja_soulevees?.length > 0 && (
                  <p><strong>{t('sales.briefObjectionsLabel', locale)}</strong> {frenchTypography(brief.objections_deja_soulevees.join(' · '))}</p>
                )}
                {brief.info_entreprise && <p><strong>{t('sales.briefCompanyLabel', locale)}</strong> {frenchTypography(brief.info_entreprise)}</p>}
                <p><strong>{t('sales.briefAngleLabel', locale)}</strong> {frenchTypography(brief.angle_approche_suggere)}</p>
                {brief.points_attention?.length > 0 && (
                  <ul>
                    {brief.points_attention.map((point, i) => <li key={i}>{frenchTypography(point)}</li>)}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="block">
            <h3>{t('sales.debriefTitle', locale)}</h3>
            {appt.debrief_summary ? (
              <>
                <div className="brief-box">
                  <p style={{ whiteSpace: 'pre-line' }}>{appt.debrief_summary}</p>
                </div>
                {appt.debrief_email_subject && (
                  <div className="email-preview">
                    <p className="email-subject">{appt.debrief_email_subject}</p>
                    <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{appt.debrief_email_body}</p>
                    {appt.debrief_email_sent_at ? (
                      <p className="sent-note">{t('sales.sentOn', locale)} {new Date(appt.debrief_email_sent_at).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
                    ) : (
                      <button type="button" className="btn-primary" onClick={() => handleSendDebriefEmail(appt.id)} disabled={sendingEmail}>
                        {sendingEmail ? t('sales.sending', locale) : t('sales.sendEmailToProspect', locale)}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="muted">{t('sales.debriefPrompt', locale)}</p>
                <textarea
                  value={debriefNotes}
                  onChange={(e) => setDebriefNotes(e.target.value)}
                  placeholder={t('sales.debriefPlaceholder', locale)}
                  rows={4}
                />
                <button type="button" className="btn-secondary" onClick={() => handleGenerateDebrief(appt.id)} disabled={debriefLoading}>
                  {debriefLoading ? t('sales.generating', locale) : t('sales.generateDebrief', locale)}
                </button>
                {debriefError && <p className="error">{debriefError}</p>}
              </>
            )}
          </section>
        </>
      ) : (
        <p className="muted small">{t('sales.noApptForDeal', locale)}</p>
      )}

      <section className="block">
        <h3>{t('sales.quoteTitle', locale)}</h3>
        {prospect.devis_sent_at ? (
          <p className="sent-note">{t('sales.quoteSentNote', locale)}</p>
        ) : devis ? (
          <div className="email-preview">
            <p className="email-subject">{devis.objet}</p>
            <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{devis.corps_email}</p>
            {devis.recapitulatif?.length > 0 && (
              <>
                {devis.a_des_postes_sans_prix && (
                  <p className="recap-note">{t('sales.missingPricesPrefix', locale)} <a href={`/app/products?user_id=${userId}`}>{t('sales.missingPricesLinkText', locale)}</a> {t('sales.missingPricesSuffix', locale)}</p>
                )}
                <ul className="recap-list">
                  {devis.recapitulatif.map((r, i) => (
                    <li key={i}>
                      <div className="recap-label">
                        <strong>{r.poste}</strong>{r.quantite > 1 && <span className="muted"> × {r.quantite}</span>} — {r.description}
                      </div>
                      <div className="recap-price">
                        {r.total_ligne_eur != null ? `${r.total_ligne_eur.toFixed(2)} €` : <span className="muted">{t('sales.priceToDefine', locale)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {devis.total_eur != null && (
                  <p className="recap-total">{t('sales.totalLabel', locale)}{devis.a_des_postes_sans_prix ? ` ${t('sales.totalPartialNote', locale)}` : ''} : {devis.total_eur.toFixed(2)} €</p>
                )}
              </>
            )}
            {devisError && <p className="error">{devisError}</p>}
            <div className="row">
              <button type="button" className="btn-secondary" onClick={() => handleLoadDevis(true)} disabled={devisLoading}>
                {devisLoading ? t('sales.regenerating', locale) : t('sales.regenerate', locale)}
              </button>
              <button type="button" className="btn-primary" onClick={handleSendDevis} disabled={sendingDevis}>
                {sendingDevis ? t('sales.sending', locale) : t('sales.sendQuoteToProspect', locale)}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">{t('sales.quotePrepPrefix', locale)} <a href={`/app/products?user_id=${userId}`}>{t('sales.quotePrepLinkText', locale)}</a> {t('sales.quotePrepSuffix', locale)}</p>
            <button type="button" className="btn-secondary" onClick={() => handleLoadDevis(false)} disabled={devisLoading}>
              {devisLoading ? t('sales.generating', locale) : prospect.devis_generated_at ? t('sales.viewQuote', locale) : t('sales.generateQuote', locale)}
            </button>
            {devisError && <p className="error">{devisError}</p>}
          </>
        )}
      </section>

      <section className="block">
        <h3>{t('sales.signatureTitle', locale)}</h3>
        <p className="muted">{t('sales.signatureIntro', locale)}</p>
        {prospect.signature_status && (
          <span className="signature-status-badge" style={{ color: sigColor, borderColor: sigColor }}>
            {t(`sales.signatureStatus.${prospect.signature_status}`, locale)}
          </span>
        )}
        {prospect.signature_external_link ? (
          <div className="email-preview">
            <p className="email-body">
              <a href={prospect.signature_external_link} target="_blank" rel="noopener noreferrer">{prospect.signature_external_link}</a>
            </p>
            {prospect.signature_requested_at && (
              <p className="sent-note">{t('sales.requestedOn', locale)} {new Date(prospect.signature_requested_at).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
            )}
            <button type="button" className="btn-secondary" onClick={handleClearSignatureLink} disabled={signatureSaving}>
              {t('sales.remove', locale)}
            </button>
          </div>
        ) : (
          <>
            <div className="row">
              <button type="button" className="btn-primary" onClick={handleSendSignatureRequest} disabled={signatureSending || !prospect.devis_generated_at}>
                {signatureSending ? t('sales.signatureSending', locale) : t('sales.signatureSendViaYoutrust', locale)}
              </button>
            </div>
            {signatureSendError && <p className="error">{signatureSendError}</p>}
            <p className="muted signature-fallback-hint">{t('sales.signatureFallbackHint', locale)}</p>
            <div className="row">
              <input
                type="text"
                value={signatureInput}
                onChange={(e) => setSignatureInput(e.target.value)}
                placeholder="https://..."
                className="signature-input"
              />
              <button type="button" className="btn-secondary" onClick={handleSetSignatureLink} disabled={signatureSaving || !signatureInput.trim()}>
                {signatureSaving ? t('sales.saving', locale) : t('common.save', locale)}
              </button>
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        .deal-tools { min-width: 0; }
        .muted { color: var(--muted); }
        .small { font-size: 0.82rem; }
        .block {
          margin-top: 1.1rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .block h3 { font-size: 0.9rem; margin: 0 0 0.5rem; }
        .block p { font-size: 0.84rem; line-height: 1.5; margin: 0 0 0.5rem; }
        .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
        .btn-secondary, .btn-primary {
          border-radius: var(--radius-md);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          border: 1px solid var(--border);
          font-family: inherit;
        }
        .btn-secondary { background: var(--bg); color: var(--text); }
        .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .btn-secondary:disabled, .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .error { color: var(--accent-red); font-size: 0.8rem; margin-top: 0.5rem; }
        .brief-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
          margin-top: 0.6rem;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .brief-box p { margin: 0 0 0.5rem; }
        .brief-box ul { margin: 0.4rem 0 0; padding-left: 1.1rem; }
        textarea {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.7rem;
          font-size: 16px;
          font-family: inherit;
          margin-bottom: 0.6rem;
          resize: vertical;
        }
        .email-preview {
          margin-top: 0.6rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
          overflow-wrap: anywhere;
        }
        .email-subject { font-weight: 600; font-size: 0.84rem; margin: 0 0 0.5rem; }
        .email-body { font-size: 0.82rem; color: var(--muted); margin: 0; }
        .email-body a { color: var(--accent-light); }
        .sent-note { color: var(--accent-green); font-size: 0.8rem; margin: 0.6rem 0 0; }
        .signature-status-badge {
          display: inline-block;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 0.15rem 0.55rem;
          border: 1px solid;
          border-radius: 999px;
          margin: 0.2rem 0 0.6rem;
        }
        .signature-fallback-hint { font-size: 0.76rem; margin: 0.6rem 0 0.4rem; }
        .recap-note { color: #f0914e; font-size: 0.78rem; margin: 0.6rem 0 0.4rem; }
        .recap-note a, .block p a { color: inherit; text-decoration: underline; }
        .recap-list { list-style: none; margin: 0 0 0.5rem; padding: 0; }
        .recap-list li {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.8rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.82rem;
        }
        .recap-list li:last-child { border-bottom: none; }
        .recap-label { color: var(--muted); }
        .recap-label strong { color: var(--text); }
        .recap-price { flex-shrink: 0; font-weight: 600; white-space: nowrap; }
        .recap-total { text-align: right; font-weight: 600; font-size: 0.86rem; margin: 0.4rem 0 0.6rem; }
        .signature-input {
          flex: 1;
          min-width: 0;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.6rem;
          font-size: 16px;
          font-family: inherit;
        }
      `}</style>
    </div>
  );
}
