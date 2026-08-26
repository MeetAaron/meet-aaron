// app/app/sales/page.jsx
// Aaron Opportunité — pipeline de vente : liste les affaires (prospects ayant
// dépassé le premier RDV) groupées par étape, avec pour l'affaire
// sélectionnée : le brief pré-RDV généré par Aaron, et le compte-rendu +
// email de relance post-RDV. Voir lib/aaron-sales.ts, app/api/sales/pipeline,
// app/api/appointments/[id]/brief, app/api/appointments/[id]/debrief(/send).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import CsvImportModal from '@/components/CsvImportModal';
import ExportFormatMenu from '@/components/ExportFormatMenu';
import CompanyInfoEditor from '@/components/CompanyInfoEditor';
import { downloadSpreadsheet } from '@/lib/xlsx-io';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

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
      const body = await res.json();

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }

      setUserId(body.user.id);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, authLoading, authError };
}

const STAGE_ORDER = ['rdv_fait', 'devis_envoye', 'en_negociation', 'signe', 'perdu'];
const NON_TERMINAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];
// Doit rester cohérent avec STALE_DAYS dans app/api/cron/stale-deals-alert/route.ts
const STALE_DAYS = 5;

const STAGE_COLORS = {
  rdv_fait: '#4B9EF0',
  devis_envoye: '#F0914E',
  en_negociation: '#F0C94E',
  signe: '#3DD68C',
  perdu: '#E5484D',
};

// Libellés traduits via t(`dealStage.<clé>`, locale) — voir stageMetaFor ci-dessous.
function stageMetaFor(locale) {
  return Object.fromEntries(
    Object.entries(STAGE_COLORS).map(([key, color]) => [key, { label: t(`dealStage.${key}`, locale), color }])
  );
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// docx AJOUT GLOBAL A15 : export + modèle vierge, même principe que
// exportProspectsToCsv/downloadBlankProspectsTemplate dans
// app/app/prospects/page.jsx. Choix CSV (recommandé) / Excel (demande Alex
// 2026-08-25, voir components/ExportFormatMenu.jsx et lib/xlsx-io.js) :
// `format` vaut 'csv' ou 'xlsx'.
function exportDealsToCsv(deals, stageMeta, locale, format) {
  const headers = [
    t('sales.colStage', locale),
    t('prospects.colName', locale),
    t('modal.email', locale),
    t('prospects.colJobTitle', locale),
    t('prospects.colCompany', locale),
    t('prospects.colAddress', locale),
    t('prospects.colSiret', locale),
    t('prospects.colWebsite', locale),
    t('prospects.colIndustry', locale),
    t('prospects.colCompanySize', locale),
    t('prospects.colEstimatedRevenue', locale),
    t('prospects.templateColManaged', locale),
  ];
  const rows = deals.map((d) => [
    stageMeta[d.deal_stage]?.label || d.deal_stage,
    d.full_name,
    d.email,
    d.job_title || '',
    d.prospect_companies?.name || '',
    d.prospect_companies?.address || '',
    d.prospect_companies?.siret || '',
    d.prospect_companies?.website || '',
    d.prospect_companies?.industry || '',
    d.prospect_companies?.company_size || '',
    d.prospect_companies?.estimated_revenue || '',
    d.ai_managed === false ? t('common.no', locale) : t('common.yes', locale),
  ]);
  downloadSpreadsheet(headers, rows, `opportunites-${new Date().toISOString().slice(0, 10)}`, format);
}

function downloadBlankDealsTemplate(locale, format) {
  const headers = [
    t('prospects.colName', locale),
    t('prospects.colCompany', locale),
    t('prospects.colJobTitle', locale),
    t('modal.email', locale),
    t('modal.phone', locale),
    t('prospects.colAddress', locale),
    t('prospects.colSiret', locale),
    t('prospects.colWebsite', locale),
    t('prospects.colIndustry', locale),
    t('prospects.colCompanySize', locale),
    t('prospects.colEstimatedRevenue', locale),
    t('sales.colStage', locale),
    t('prospects.templateColManaged', locale),
  ];
  downloadSpreadsheet(headers, [], 'modele-opportunites-vierge', format);
}

export default function SalesPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const STAGE_META = stageMetaFor(locale);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [changingStage, setChangingStage] = useState(false);

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

  // docx AJOUT GLOBAL A15 : ajout manuel d'une opportunité (relation déjà
  // établie hors Meet Aaron, ex. reprise d'une base existante) — voir
  // AddDealModal plus bas et le flag skip_first_contact dans
  // app/api/prospects/route.ts.
  const [companyId, setCompanyId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  // "Aaron s'en charge" (demande Alex, 26/08/2026) : étendu depuis Prospects
  // à Aaron Opportunité — même toggle, même action PATCH set_ai_managed déjà
  // ouverte à tout prospect (voir app/api/prospects/[id]/route.ts).
  const [togglingAiManaged, setTogglingAiManaged] = useState(false);

  async function load() {
    const res = await fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json());
    setDeals(res.deals || []);
    setLoading(false);
  }

  async function handleToggleAiManaged(deal) {
    const nextManaged = deal.ai_managed === false;
    setTogglingAiManaged(true);
    await fetch(`/api/prospects/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_ai_managed', ai_managed: nextManaged }),
    });
    setTogglingAiManaged(false);
    load();
  }

  useEffect(() => {
    if (!userId) return;
    load();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
      });
  }, [userId]);

  // Réinitialise les états liés au brief/debrief à chaque changement de
  // sélection — ils sont propres au RDV de l'affaire affichée.
  useEffect(() => {
    setBrief(null);
    setBriefError(null);
    setDebriefNotes('');
    setDebriefError(null);
    setDevis(null);
    setDevisError(null);
    setSignatureInput('');
  }, [selectedId]);

  const selectedDeal = deals.find((d) => d.id === selectedId) || null;

  async function handleStageChange(dealId, stage) {
    setChangingStage(true);
    await fetch(`/api/prospects/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_deal_stage', deal_stage: stage }),
    });
    await load();
    setChangingStage(false);
  }

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
    await load();
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
    await load();
  }

  async function handleLoadDevis(dealId) {
    setDevisLoading(true);
    setDevisError(null);
    const res = await fetch(`/api/prospects/${dealId}/devis`);
    const body = await res.json();
    setDevisLoading(false);
    if (!res.ok) {
      setDevisError(body.error || t('sales.quoteGenError', locale));
      return;
    }
    setDevis(body);
  }

  async function handleSendDevis(dealId) {
    setSendingDevis(true);
    setDevisError(null);
    const res = await fetch(`/api/prospects/${dealId}/devis`, { method: 'POST' });
    const body = await res.json();
    setSendingDevis(false);
    if (!res.ok) {
      setDevisError(body.error || t('sales.quoteSendError', locale));
      return;
    }
    await load();
    await handleLoadDevis(dealId);
  }

  async function handleSetSignatureLink(dealId) {
    if (!signatureInput.trim()) return;
    setSignatureSaving(true);
    await fetch(`/api/prospects/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_signature_link', signature_link: signatureInput.trim() }),
    });
    setSignatureSaving(false);
    setSignatureInput('');
    await load();
  }

  async function handleClearSignatureLink(dealId) {
    setSignatureSaving(true);
    await fetch(`/api/prospects/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_signature_link' }),
    });
    setSignatureSaving(false);
    await load();
  }

  async function handleSendSignatureRequest(dealId) {
    setSignatureSending(true);
    setSignatureSendError(null);
    const res = await fetch(`/api/prospects/${dealId}/signature-request`, { method: 'POST' }).then((r) => r.json());
    setSignatureSending(false);
    if (res.error) {
      setSignatureSendError(res.error);
      return;
    }
    await load();
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: var(--bg); color: var(--muted); font-family: 'Inter', sans-serif;
          }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: var(--bg); color: var(--accent-red); font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active={t('nav.opportunity', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('sales.eyebrow', locale)}</p>
        <h1>{t('nav.opportunity', locale)}</h1>
        <p className="subtitle">
          {t('sales.subtitle', locale)}
        </p>
        <div className="header-actions">
          {/* Voir le même correctif dans app/app/prospects/page.jsx : bouton
              toujours visible (désactivé plutôt que masqué si rien à
              exporter), pour ne plus donner l'impression qu'il manque. */}
          <ExportFormatMenu
            label={t('sales.exportCsv', locale)}
            disabled={deals.length === 0}
            onChoose={(format) => exportDealsToCsv(deals, STAGE_META, locale, format)}
          />
          <ExportFormatMenu
            label={t('sales.downloadTemplate', locale)}
            onChoose={(format) => downloadBlankDealsTemplate(locale, format)}
          />
          <button className="btn-secondary" onClick={() => setShowCsvImport(true)}>
            {t('csvImport.button', locale)}
          </button>
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            {t('sales.addButton', locale)}
          </button>
        </div>
      </header>

      {showAddForm && (
        <AddDealModal
          userId={userId}
          companyId={companyId}
          stageOrder={STAGE_ORDER}
          stageMeta={STAGE_META}
          onClose={() => setShowAddForm(false)}
          onCreated={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}

      {showCsvImport && (
        <CsvImportModal
          userId={userId}
          companyId={companyId}
          context="sales"
          module="as"
          stageOrder={STAGE_ORDER}
          stageMeta={STAGE_META}
          onClose={() => setShowCsvImport(false)}
          onImported={() => {
            load();
          }}
        />
      )}

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : deals.length === 0 ? (
        <p className="muted">
          {t('sales.emptyBody', locale)}
        </p>
      ) : (
        <div className="board-layout">
          <div className="board">
            {STAGE_ORDER.map((stage) => {
              const stageDeals = deals.filter((d) => d.deal_stage === stage);
              return (
                <div className="column" key={stage}>
                  <div className="column-header">
                    <span className="dot" style={{ background: STAGE_META[stage].color }} />
                    <span>{STAGE_META[stage].label}</span>
                    <span className="count">{stageDeals.length}</span>
                  </div>
                  <div className="column-body">
                    {stageDeals.length === 0 && <p className="empty-col">—</p>}
                    {stageDeals.map((deal) => {
                      const stale = NON_TERMINAL_STAGES.includes(deal.deal_stage) && daysSince(deal.deal_stage_updated_at) >= STALE_DAYS;
                      return (
                        <button
                          key={deal.id}
                          type="button"
                          className={`deal-card ${selectedId === deal.id ? 'selected' : ''}`}
                          onClick={() => setSelectedId(deal.id)}
                        >
                          <span className="deal-name">{deal.full_name}</span>
                          {deal.prospect_companies?.name && <span className="deal-company">{deal.prospect_companies.name}</span>}
                          <span className="deal-meta">
                            {daysSince(deal.deal_stage_updated_at)} {t('sales.daysSuffix', locale)}
                            {stale && <span className="stale-badge">{t('sales.staleBadge', locale)}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="detail">
            {!selectedDeal ? (
              <p className="muted">{t('sales.selectDealPrompt', locale)}</p>
            ) : (
              <>
                <div className="detail-header-row">
                  <div>
                    <h2>{selectedDeal.full_name}</h2>
                    {selectedDeal.prospect_companies?.name && <p className="muted">{selectedDeal.prospect_companies.name}{selectedDeal.job_title ? ` — ${selectedDeal.job_title}` : ''}</p>}
                  </div>
                  <button
                    type="button"
                    className={`ai-managed-toggle${selectedDeal.ai_managed === false ? ' off' : ' on'}`}
                    disabled={togglingAiManaged}
                    onClick={() => handleToggleAiManaged(selectedDeal)}
                    title={selectedDeal.ai_managed === false ? t('prospects.aiManagedOffTitle', locale) : t('prospects.aiManagedOnTitle', locale)}
                  >
                    {selectedDeal.ai_managed === false ? `⏸️ ${t('prospects.aiManagedOffLabel', locale)}` : `🤖 ${t('prospects.aiManagedOnLabel', locale)}`}
                  </button>
                </div>

                <section className="block">
                  <CompanyInfoEditor prospect={selectedDeal} locale={locale} onSaved={load} />
                </section>

                <div className="stage-row">
                  <label htmlFor="stage-select">{t('sales.stageLabel', locale)}</label>
                  <select
                    id="stage-select"
                    value={selectedDeal.deal_stage}
                    disabled={changingStage}
                    onChange={(e) => handleStageChange(selectedDeal.id, e.target.value)}
                  >
                    {STAGE_ORDER.map((s) => (
                      <option key={s} value={s}>{STAGE_META[s].label}</option>
                    ))}
                  </select>
                </div>

                {selectedDeal.latest_appointment ? (
                  <>
                    <section className="block">
                      <h3>{t('sales.latestApptTitle', locale)}</h3>
                      <p className="muted">
                        {new Date(selectedDeal.latest_appointment.proposed_at).toLocaleDateString(locale, { dateStyle: 'medium' })}
                        {' — '}
                        {t(`apptType.${selectedDeal.latest_appointment.type}`, locale)}
                      </p>

                      {!brief && (
                        <button className="btn-secondary" onClick={() => handleLoadBrief(selectedDeal.latest_appointment.id)} disabled={briefLoading}>
                          {briefLoading ? t('sales.generating', locale) : t('sales.viewBrief', locale)}
                        </button>
                      )}
                      {briefError && <p className="error">{briefError}</p>}

                      {brief && (
                        <div className="brief-box">
                          <p><strong>{t('sales.briefSummaryLabel', locale)}</strong> {brief.resume_historique}</p>
                          {brief.profil_personnalite && <p><strong>{t('sales.briefPersonalityLabel', locale)}</strong> {brief.profil_personnalite}</p>}
                          {brief.objections_deja_soulevees?.length > 0 && (
                            <p><strong>{t('sales.briefObjectionsLabel', locale)}</strong> {brief.objections_deja_soulevees.join(' · ')}</p>
                          )}
                          {brief.info_entreprise && <p><strong>{t('sales.briefCompanyLabel', locale)}</strong> {brief.info_entreprise}</p>}
                          <p><strong>{t('sales.briefAngleLabel', locale)}</strong> {brief.angle_approche_suggere}</p>
                          {brief.points_attention?.length > 0 && (
                            <ul>
                              {brief.points_attention.map((point, i) => <li key={i}>{point}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </section>

                    <section className="block">
                      <h3>{t('sales.debriefTitle', locale)}</h3>

                      {selectedDeal.latest_appointment.debrief_summary ? (
                        <>
                          <div className="brief-box">
                            <p style={{ whiteSpace: 'pre-line' }}>{selectedDeal.latest_appointment.debrief_summary}</p>
                          </div>
                          {selectedDeal.latest_appointment.debrief_email_subject && (
                            <div className="email-preview">
                              <p className="email-subject">{selectedDeal.latest_appointment.debrief_email_subject}</p>
                              <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{selectedDeal.latest_appointment.debrief_email_body}</p>
                              {selectedDeal.latest_appointment.debrief_email_sent_at ? (
                                <p className="sent-note">{t('sales.sentOn', locale)} {new Date(selectedDeal.latest_appointment.debrief_email_sent_at).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
                              ) : (
                                <button className="btn-primary" onClick={() => handleSendDebriefEmail(selectedDeal.latest_appointment.id)} disabled={sendingEmail}>
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
                          <button className="btn-secondary" onClick={() => handleGenerateDebrief(selectedDeal.latest_appointment.id)} disabled={debriefLoading}>
                            {debriefLoading ? t('sales.generating', locale) : t('sales.generateDebrief', locale)}
                          </button>
                          {debriefError && <p className="error">{debriefError}</p>}
                        </>
                      )}
                    </section>
                  </>
                ) : (
                  <p className="muted">{t('sales.noApptForDeal', locale)}</p>
                )}

                <section className="block">
                  <h3>{t('sales.quoteTitle', locale)}</h3>
                  {selectedDeal.devis_sent_at ? (
                    <p className="sent-note">{t('sales.quoteSentNote', locale)}</p>
                  ) : devis ? (
                    <div className="email-preview">
                      <p className="email-subject">{devis.objet}</p>
                      <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{devis.corps_email}</p>
                      {devis.recapitulatif?.length > 0 && (
                        <>
                          {devis.a_des_postes_sans_prix && (
                            <p className="recap-note">{t('sales.missingPricesPrefix', locale)} <Link href={`/app/products?user_id=${userId}`}>{t('sales.missingPricesLinkText', locale)}</Link> {t('sales.missingPricesSuffix', locale)}</p>
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
                      <button className="btn-secondary" onClick={() => handleLoadDevis(selectedDeal.id)} disabled={devisLoading}>
                        {devisLoading ? t('sales.regenerating', locale) : t('sales.regenerate', locale)}
                      </button>
                      <button className="btn-primary" onClick={() => handleSendDevis(selectedDeal.id)} disabled={sendingDevis}>
                        {sendingDevis ? t('sales.sending', locale) : t('sales.sendQuoteToProspect', locale)}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="muted">{t('sales.quotePrepPrefix', locale)} <Link href={`/app/products?user_id=${userId}`}>{t('sales.quotePrepLinkText', locale)}</Link> {t('sales.quotePrepSuffix', locale)}</p>
                      <button className="btn-secondary" onClick={() => handleLoadDevis(selectedDeal.id)} disabled={devisLoading}>
                        {devisLoading ? t('sales.generating', locale) : t('sales.generateQuote', locale)}
                      </button>
                      {devisError && <p className="error">{devisError}</p>}
                    </>
                  )}
                </section>

                <section className="block">
                  <h3>{t('sales.signatureTitle', locale)}</h3>
                  <p className="muted">{t('sales.signatureIntro', locale)}</p>
                  {selectedDeal.signature_status && (
                    <span
                      className="signature-status-badge"
                      style={{
                        color: selectedDeal.signature_status === 'signe' ? '#3ECF8E' : selectedDeal.signature_status === 'refuse' ? '#E5484D' : '#F5A623',
                        borderColor: selectedDeal.signature_status === 'signe' ? '#3ECF8E' : selectedDeal.signature_status === 'refuse' ? '#E5484D' : '#F5A623',
                      }}
                    >
                      {t(`sales.signatureStatus.${selectedDeal.signature_status}`, locale)}
                    </span>
                  )}
                  {selectedDeal.signature_external_link ? (
                    <div className="email-preview">
                      <p className="email-body">
                        <a href={selectedDeal.signature_external_link} target="_blank" rel="noopener noreferrer">{selectedDeal.signature_external_link}</a>
                      </p>
                      {selectedDeal.signature_requested_at && (
                        <p className="sent-note">{t('sales.requestedOn', locale)} {new Date(selectedDeal.signature_requested_at).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
                      )}
                      <button className="btn-secondary" onClick={() => handleClearSignatureLink(selectedDeal.id)} disabled={signatureSaving}>
                        {t('sales.remove', locale)}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="stage-row">
                        <button
                          className="btn-primary"
                          onClick={() => handleSendSignatureRequest(selectedDeal.id)}
                          disabled={signatureSending || !selectedDeal.devis_generated_at}
                        >
                          {signatureSending ? t('sales.signatureSending', locale) : t('sales.signatureSendViaYoutrust', locale)}
                        </button>
                      </div>
                      {signatureSendError && <p className="error">{signatureSendError}</p>}
                      <p className="muted signature-fallback-hint">{t('sales.signatureFallbackHint', locale)}</p>
                      <div className="stage-row">
                        <input
                          type="text"
                          value={signatureInput}
                          onChange={(e) => setSignatureInput(e.target.value)}
                          placeholder="https://..."
                          className="signature-input"
                        />
                        <button className="btn-secondary" onClick={() => handleSetSignatureLink(selectedDeal.id)} disabled={signatureSaving || !signatureInput.trim()}>
                          {signatureSaving ? t('sales.saving', locale) : t('common.save', locale)}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.8rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0 0 0.5rem;
        }
        .subtitle {
          color: var(--muted);
          font-size: 0.88rem;
          max-width: 720px;
          margin: 0;
        }
        .header-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.6rem;
          margin-top: 0.9rem;
        }
        .muted {
          color: var(--muted);
        }
        .board-layout {
          display: grid;
          grid-template-columns: 1fr 360px;
          gap: 1.5rem;
          align-items: start;
        }
        .board {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0.8rem;
        }
        .column {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 0.9rem;
          min-height: 200px;
        }
        .column-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.78rem;
          font-weight: 600;
          margin-bottom: 0.8rem;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .count {
          margin-left: auto;
          color: var(--muted);
          font-family: var(--font-mono);
          font-weight: 400;
        }
        .column-body {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .empty-col {
          color: var(--muted);
          font-size: 0.8rem;
          opacity: 0.6;
          margin: 0;
        }
        .deal-card {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.7rem;
          cursor: pointer;
          color: var(--text);
          font-family: inherit;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .deal-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .deal-card.selected {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.12);
        }
        .deal-name {
          font-size: 0.86rem;
          font-weight: 600;
        }
        .deal-company {
          font-size: 0.76rem;
          color: var(--muted);
        }
        .deal-meta {
          font-size: 0.7rem;
          color: var(--muted);
          margin-top: 0.2rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .stale-badge {
          color: #f0914e;
        }
        .detail {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.2rem;
          position: sticky;
          top: 1.5rem;
          max-height: calc(100vh - 3rem);
          overflow-y: auto;
        }
        .detail h2 {
          font-family: var(--font-display);
          font-size: 1.15rem;
          margin: 0 0 0.2rem;
        }
        .detail-header-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.6rem;
        }
        .ai-managed-toggle {
          flex-shrink: 0;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.7rem;
          font-size: 0.76rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .ai-managed-toggle.on {
          border-color: var(--accent);
          color: var(--accent);
        }
        .ai-managed-toggle.off {
          border-color: var(--muted);
          color: var(--muted);
        }
        .ai-managed-toggle:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .stage-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 1rem 0;
        }
        .stage-row label {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .stage-row select {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.6rem;
          font-size: 0.84rem;
        }
        .block {
          margin-top: 1.4rem;
          padding-top: 1.2rem;
          border-top: 1px solid var(--border);
        }
        .block h3 {
          font-size: 0.9rem;
          margin: 0 0 0.6rem;
        }
        .btn-secondary, .btn-primary {
          border-radius: var(--radius-md);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          border: 1px solid var(--border);
        }
        .btn-secondary {
          background: var(--bg);
          color: var(--text);
        }
        .btn-primary {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
          margin-top: 0.6rem;
        }
        .btn-secondary:disabled, .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.8rem;
          margin-top: 0.5rem;
        }
        .brief-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
          margin-top: 0.8rem;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .brief-box p {
          margin: 0 0 0.5rem;
        }
        .brief-box ul {
          margin: 0.4rem 0 0;
          padding-left: 1.1rem;
        }
        textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.7rem;
          font-size: 0.84rem;
          font-family: inherit;
          margin-bottom: 0.6rem;
          resize: vertical;
        }
        .email-preview {
          margin-top: 0.8rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
        }
        .email-subject {
          font-weight: 600;
          font-size: 0.84rem;
          margin: 0 0 0.5rem;
        }
        .email-body {
          font-size: 0.82rem;
          color: var(--muted);
          margin: 0;
        }
        .sent-note {
          color: var(--accent-green);
          font-size: 0.8rem;
          margin: 0.6rem 0 0;
        }
        .signature-status-badge {
          display: inline-block;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 0.15rem 0.55rem;
          border: 1px solid;
          border-radius: 999px;
          margin: 0.2rem 0 0.6rem;
        }
        .signature-fallback-hint {
          font-size: 0.76rem;
          margin: 0.6rem 0 0.4rem;
        }
        .recap-note {
          color: #f0914e;
          font-size: 0.78rem;
          margin: 0.6rem 0 0.4rem;
        }
        .recap-note :global(a) {
          color: inherit;
          text-decoration: underline;
        }
        .recap-list {
          list-style: none;
          margin: 0 0 0.5rem;
          padding: 0;
        }
        .recap-list li {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.8rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.82rem;
        }
        .recap-list li:last-child {
          border-bottom: none;
        }
        .recap-label {
          color: var(--muted);
        }
        .recap-label strong {
          color: var(--text);
        }
        .recap-price {
          flex-shrink: 0;
          font-weight: 600;
          white-space: nowrap;
        }
        .recap-total {
          text-align: right;
          font-weight: 600;
          font-size: 0.86rem;
          margin: 0.4rem 0 0.6rem;
        }
        .signature-input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.6rem;
          font-size: 0.82rem;
          font-family: inherit;
        }
        @media (max-width: 1100px) {
          .board-layout {
            grid-template-columns: 1fr;
          }
          .board {
            grid-template-columns: repeat(2, 1fr);
          }
          .detail {
            position: static;
            max-height: none;
          }
        }
        @media (max-width: 600px) {
          .board {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
        setUserRole(prefs.role || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
    { label: t('nav.suggestions', locale), slug: 'suggestions', icon: '💡' },
  ];
  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Ouvrir le menu"
        onClick={() => setMobileOpen(true)}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' && item.slug !== 'suggestions') || userRole === 'patron').map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel"><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            {t('shell.connected', locale)}
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            {t('common.logout', locale)}
          </button>
        </div>
      </nav>
      <main className="content">{children}</main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          min-width: 0;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mobile-menu-btn {
          display: none;
        }
        .sidebar-overlay {
          display: none;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .mobile-menu-btn {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 60;
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
          }
          .mobile-menu-btn .bar {
            display: block;
            width: 18px;
            height: 2px;
            margin: 0 auto;
            background: var(--text);
            border-radius: 1px;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
            z-index: 65;
          }
          .content {
            padding: 1.5rem;
            padding-top: 4.5rem;
          }
        }
      `}</style>
    </div>
  );
}

// docx AJOUT GLOBAL A15 : "ajouter manuellement" une opportunité — pour une
// relation déjà entamée hors Meet Aaron (reprise d'une base existante,
// affaire en cours ailleurs). Crée le prospect sans déclencher le 1er email
// de prospection à froid (skip_first_contact, voir app/api/prospects/route.ts),
// puis le place directement à l'étape de pipeline choisie via l'action déjà
// existante set_deal_stage (app/api/prospects/[id]/route.ts) — même chemin
// que quand un commercial fait glisser une affaire d'une colonne à l'autre.
function AddDealModal({ userId, companyId, stageOrder, stageMeta, onClose, onCreated }) {
  const [locale] = useLocale();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [stage, setStage] = useState(stageOrder[0]);
  const [showCompanyFields, setShowCompanyFields] = useState(false);
  const [address, setAddress] = useState('');
  const [siret, setSiret] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [estimatedRevenue, setEstimatedRevenue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    const res = await fetch('/api/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        assigned_user_id: userId,
        full_name: fullName,
        email,
        job_title: jobTitle || null,
        company_name: companyName || null,
        skip_first_contact: true,
        address: address || null,
        siret: siret || null,
        website: website || null,
        industry: industry || null,
        company_size: companySize || null,
        estimated_revenue: estimatedRevenue || null,
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSubmitting(false);
      setError(body.error || t('sales.addModalErrorFallback', locale));
      return;
    }

    const patchRes = await fetch(`/api/prospects/${body.prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_deal_stage', deal_stage: stage }),
    });

    setSubmitting(false);

    if (!patchRes.ok) {
      const patchBody = await patchRes.json();
      setError(patchBody.error || t('sales.addModalErrorFallback', locale));
      return;
    }

    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t('sales.addModalTitle', locale)}</h2>
        <p className="hint">{t('sales.addModalHint', locale)}</p>

        <div className="name-row">
          <label>
            {t('prospects.firstNameLabel', locale)}
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>
          <label>
            {t('prospects.lastNameLabel', locale)}
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
        </div>

        <label>
          {t('modal.email', locale)}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          {t('prospects.colCompany', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>

        <label>
          {t('prospects.colJobTitle', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </label>

        <label>
          {t('sales.addModalStageLabel', locale)}
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {stageOrder.map((s) => (
              <option key={s} value={s}>{stageMeta[s].label}</option>
            ))}
          </select>
        </label>

        {!showCompanyFields ? (
          <button type="button" className="toggle-company-fields" onClick={() => setShowCompanyFields(true)}>
            + {t('prospects.companyInfoTitle', locale)} {t('prospects.optionalSuffix', locale)}
          </button>
        ) : (
          <div className="company-fields">
            <label>
              {t('prospects.colAddress', locale)}
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label>
              {t('prospects.colSiret', locale)}
              <input value={siret} onChange={(e) => setSiret(e.target.value)} />
            </label>
            <label>
              {t('prospects.colWebsite', locale)}
              <input value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <label>
              {t('prospects.colIndustry', locale)}
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </label>
            <label>
              {t('prospects.colCompanySize', locale)}
              <input value={companySize} onChange={(e) => setCompanySize(e.target.value)} />
            </label>
            <label>
              {t('prospects.colEstimatedRevenue', locale)}
              <input value={estimatedRevenue} onChange={(e) => setEstimatedRevenue(e.target.value)} />
            </label>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', locale)}</button>
          <button type="submit" className="btn-primary" disabled={submitting || !companyId}>
            {submitting ? t('sales.addModalSubmitting', locale) : t('sales.addModalSubmit', locale)}
          </button>
        </div>
      </form>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 420px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          margin: 0 0 0.6rem;
        }
        .hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0 0 1.2rem;
          line-height: 1.4;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 1rem;
        }
        .name-row {
          display: flex;
          gap: 0.8rem;
        }
        .name-row label {
          flex: 1;
          min-width: 0;
        }
        .toggle-company-fields {
          background: none;
          border: none;
          color: var(--accent);
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          margin-bottom: 1rem;
        }
        .company-fields {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.8rem 0.8rem;
          margin-bottom: 0.2rem;
          padding: 0.9rem;
          background: var(--bg);
          border-radius: var(--radius-sm);
        }
        .company-fields label {
          margin-bottom: 0;
        }
        @media (max-width: 480px) {
          .company-fields {
            grid-template-columns: 1fr;
          }
        }
        input, select {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.88rem;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.82rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 1.2rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
