// app/app/customer/page.jsx
// Aaron Client — suivi des clients gagnés : onboarding (plan généré par
// Aaron + email de bienvenue), score de santé, historique des check-ins
// satisfaction/NPS. Voir lib/aaron-customer.ts, lib/customer-health.ts,
// app/api/customers/pipeline, app/api/customers/[id]/onboarding.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import CsvImportModal from '@/components/CsvImportModal';
import ExportFormatMenu from '@/components/ExportFormatMenu';
import CompanyInfoEditor from '@/components/CompanyInfoEditor';
import ContactInfoEditor from '@/components/ContactInfoEditor';
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

const ONBOARDING_ORDER = ['a_demarrer', 'en_cours', 'termine'];

function onboardingMetaFor(locale) {
  return {
    a_demarrer: { label: t('customer.onboardingToStart', locale), color: '#F0914E' },
    en_cours: { label: t('customer.onboardingInProgress', locale), color: '#F0C94E' },
    termine: { label: t('customer.onboardingDone', locale), color: '#3DD68C' },
  };
}

function healthMetaFor(locale) {
  return {
    saine: { label: t('customer.healthGood', locale), color: '#3DD68C' },
    a_surveiller: { label: t('customer.healthWatch', locale), color: '#F0C94E' },
    a_risque: { label: t('customer.healthAtRisk', locale), color: '#E5484D' },
  };
}

function checkinTypeLabelsFor(locale) {
  return { nps: 'NPS', satisfaction: t('customer.checkinSatisfaction', locale) };
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
function exportCustomersToCsv(customers, locale, format) {
  const headers = [
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
    t('customer.colHealth', locale),
    t('prospects.templateColManaged', locale),
  ];
  const rows = customers.map((c) => [
    c.full_name,
    c.email,
    c.job_title || '',
    c.prospect_companies?.name || '',
    c.prospect_companies?.address || '',
    c.prospect_companies?.siret || '',
    c.prospect_companies?.website || '',
    c.prospect_companies?.industry || '',
    c.prospect_companies?.company_size || '',
    c.prospect_companies?.estimated_revenue || '',
    c.customer_health_label || '',
    c.ai_managed === false ? t('common.no', locale) : t('common.yes', locale),
  ]);
  downloadSpreadsheet(headers, rows, `clients-${new Date().toISOString().slice(0, 10)}`, format);
}

function downloadBlankCustomersTemplate(locale, format) {
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
    t('prospects.templateColManaged', locale),
  ];
  downloadSpreadsheet(headers, [], 'modele-clients-vierge', format);
}

export default function CustomerPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const ONBOARDING_META = onboardingMetaFor(locale);
  const HEALTH_META = healthMetaFor(locale);
  const CHECKIN_TYPE_LABELS = checkinTypeLabelsFor(locale);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [changingStatus, setChangingStatus] = useState(false);

  const [onboarding, setOnboarding] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);

  const [renewalDateInput, setRenewalDateInput] = useState('');
  const [renewalSaving, setRenewalSaving] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalError, setRenewalError] = useState(null);
  const [sendingRenewal, setSendingRenewal] = useState(false);

  const [testimonialLoading, setTestimonialLoading] = useState(false);
  const [testimonialError, setTestimonialError] = useState(null);
  const [sendingTestimonial, setSendingTestimonial] = useState(false);

  const [supportDrafts, setSupportDrafts] = useState([]);
  const [supportDraftsLoading, setSupportDraftsLoading] = useState(true);
  const [supportActionId, setSupportActionId] = useState(null);

  // Tâche #141 sous-item 2 (2026-08-20) : facturation client, voir
  // lib/client-invoices.ts, lib/invoice-pdf.ts, migration_invoicing_2026-08-20.sql.
  const [clientInvoices, setClientInvoices] = useState([]);
  const [clientInvoicesLoading, setClientInvoicesLoading] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceLines, setInvoiceLines] = useState([{ designation: '', quantite: '1', prix_unitaire_ht_eur: '' }]);
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceVatRate, setInvoiceVatRate] = useState('');
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [invoiceCreateError, setInvoiceCreateError] = useState(null);
  const [invoiceActionBusyId, setInvoiceActionBusyId] = useState(null);

  async function loadClientInvoices(customerId) {
    setClientInvoicesLoading(true);
    const res = await fetch(`/api/customers/${customerId}/invoices`).then((r) => r.json());
    setClientInvoices(res.invoices || []);
    setClientInvoicesLoading(false);
  }

  async function submitInvoice(customerId, { prefillFromDevis }) {
    setCreatingInvoice(true);
    setInvoiceCreateError(null);
    const payload = prefillFromDevis
      ? { prefill_from_devis: true, due_date: invoiceDueDate || null, vat_rate: invoiceVatRate ? Number(invoiceVatRate) / 100 : null }
      : {
          line_items: invoiceLines
            .filter((l) => l.designation && l.quantite && l.prix_unitaire_ht_eur)
            .map((l) => ({ designation: l.designation, description: l.description || null, quantite: Number(l.quantite), prix_unitaire_ht_eur: Number(l.prix_unitaire_ht_eur) })),
          due_date: invoiceDueDate || null,
          vat_rate: invoiceVatRate ? Number(invoiceVatRate) / 100 : null,
        };
    const res = await fetch(`/api/customers/${customerId}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    setCreatingInvoice(false);
    if (!res.ok) {
      setInvoiceCreateError(body.error || t('customer.invoicesCreateError', locale));
      return;
    }
    setShowInvoiceForm(false);
    setInvoiceLines([{ designation: '', quantite: '1', prix_unitaire_ht_eur: '' }]);
    setInvoiceDueDate('');
    setInvoiceVatRate('');
    await loadClientInvoices(customerId);
  }

  async function handleInvoiceStatusChange(customerId, invoiceId, status) {
    setInvoiceActionBusyId(invoiceId);
    await fetch(`/api/customers/${customerId}/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadClientInvoices(customerId);
    setInvoiceActionBusyId(null);
  }

  async function handleDownloadInvoicePdf(customerId, invoiceId, invoiceNumber) {
    setInvoiceActionBusyId(invoiceId);
    try {
      const res = await fetch(`/api/customers/${customerId}/invoices/${invoiceId}/pdf`);
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // Best-effort — un échec ponctuel de téléchargement ne doit pas bloquer le reste de la page.
    } finally {
      setInvoiceActionBusyId(null);
    }
  }

  function invoiceStatusLabel(status, locale) {
    if (status === 'payee') return t('customer.invoicesStatusPayee', locale);
    if (status === 'en_retard') return t('customer.invoicesStatusEnRetard', locale);
    if (status === 'annulee') return t('customer.invoicesStatusAnnulee', locale);
    return t('customer.invoicesStatusEmise', locale);
  }

  async function load() {
    const res = await fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json());
    const list = res.customers || [];
    setCustomers(list);
    setLoading(false);
    // Fusion pipeline (31/08/2026) : cette page n'est plus dans le menu, on y
    // arrive depuis la fiche contact (bouton « Outils client ») avec
    // ?client_id=… — on présélectionne directement le client demandé.
    try {
      const wanted = new URLSearchParams(window.location.search).get('client_id');
      if (wanted && list.some((c) => c.id === wanted)) setSelectedId(wanted);
    } catch {}
  }

  async function loadSupportDrafts() {
    setSupportDraftsLoading(true);
    const res = await fetch(`/api/support-drafts?user_id=${userId}`).then((r) => r.json());
    setSupportDrafts(res.drafts || []);
    setSupportDraftsLoading(false);
  }

  // docx AJOUT GLOBAL A15 : ajout manuel d'un client — voir AddClientModal
  // plus bas et le flag skip_first_contact dans app/api/prospects/route.ts.
  const [companyId, setCompanyId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);

  useEffect(() => {
    if (!userId) return;
    load();
    loadSupportDrafts();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
      });
  }, [userId]);

  useEffect(() => {
    setOnboarding(null);
    setOnboardingError(null);
    setRenewalError(null);
    setTestimonialError(null);
    setShowInvoiceForm(false);
    setInvoiceCreateError(null);
    const customer = customers.find((c) => c.id === selectedId);
    setRenewalDateInput(customer?.contract_renewal_date || '');
    if (selectedId) {
      loadClientInvoices(selectedId);
    } else {
      setClientInvoices([]);
    }
  }, [selectedId]);

  const selectedCustomer = customers.find((c) => c.id === selectedId) || null;

  async function handleStatusChange(customerId, status) {
    setChangingStatus(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_onboarding_status', onboarding_status: status }),
    });
    await load();
    setChangingStatus(false);
  }

  // CHANGEMENTS A FAIRE — Mon équipe (item 1, 2026-08-16) : donne un vrai
  // sens à la colonne "clients perdus" de Mon équipe (lib/team-stats.ts) —
  // réutilise le champ is_lost déjà présent sur prospects (voir
  // marquer_client_perdu/reactiver_client dans app/api/prospects/[id]/route.ts).
  async function handleToggleClientLost(customerId, currentlyLost) {
    const action = currentlyLost ? 'reactiver_client' : 'marquer_client_perdu';
    if (!currentlyLost && !confirm(t('customer.confirmMarkLost', locale))) return;
    setChangingStatus(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    await load();
    setChangingStatus(false);
  }

  // Bascule "Aaron gère ce client" (emails + devis) par client — voir
  // migration_customer_ai_managed_2026-08-17.sql et handleWonCustomerMessage
  // dans app/api/cron/check-inbox/route.ts, qui n'ouvre plus le message si
  // ai_managed est à false pour ce prospect.
  async function handleToggleAiManaged(customerId, currentlyManaged) {
    setChangingStatus(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_ai_managed', ai_managed: !currentlyManaged }),
    });
    await load();
    setChangingStatus(false);
  }

  async function handleLoadOnboarding(customerId) {
    setOnboardingLoading(true);
    setOnboardingError(null);
    const res = await fetch(`/api/customers/${customerId}/onboarding`);
    const body = await res.json();
    setOnboardingLoading(false);
    if (!res.ok) {
      setOnboardingError(body.error || t('customer.onboardingPlanError', locale));
      return;
    }
    setOnboarding(body);
  }

  async function handleSendWelcome(customerId) {
    setSendingWelcome(true);
    const res = await fetch(`/api/customers/${customerId}/onboarding`, { method: 'POST' });
    const body = await res.json();
    setSendingWelcome(false);
    if (!res.ok) {
      setOnboardingError(body.error || t('customer.sendEmailError', locale));
      return;
    }
    await load();
  }

  async function handleSetRenewalDate(customerId) {
    setRenewalSaving(true);
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_renewal_date', contract_renewal_date: renewalDateInput || null }),
    });
    setRenewalSaving(false);
    await load();
  }

  async function handleGenerateRenewal(customerId, regenerate) {
    setRenewalLoading(true);
    setRenewalError(null);
    const res = await fetch(`/api/prospects/${customerId}/renewal${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setRenewalLoading(false);
    if (!res.ok) {
      setRenewalError(body.error || t('customer.renewalEmailError', locale));
      return;
    }
    await load();
  }

  async function handleSendRenewal(customerId) {
    setSendingRenewal(true);
    setRenewalError(null);
    const res = await fetch(`/api/prospects/${customerId}/renewal`, { method: 'POST' });
    const body = await res.json();
    setSendingRenewal(false);
    if (!res.ok) {
      setRenewalError(body.error || t('customer.sendEmailError', locale));
      return;
    }
    await load();
  }

  async function handleDismissUpsell(customerId) {
    await fetch(`/api/prospects/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss_upsell' }),
    });
    await load();
  }

  async function handleGenerateTestimonial(customerId, regenerate) {
    setTestimonialLoading(true);
    setTestimonialError(null);
    const res = await fetch(`/api/prospects/${customerId}/testimonial${regenerate ? '?regenerate=1' : ''}`);
    const body = await res.json();
    setTestimonialLoading(false);
    if (!res.ok) {
      setTestimonialError(body.error || t('customer.testimonialGenerateError', locale));
      return;
    }
    await load();
  }

  async function handleSendTestimonial(customerId) {
    setSendingTestimonial(true);
    setTestimonialError(null);
    const res = await fetch(`/api/prospects/${customerId}/testimonial`, { method: 'POST' });
    const body = await res.json();
    setSendingTestimonial(false);
    if (!res.ok) {
      setTestimonialError(body.error || t('customer.testimonialSendError', locale));
      return;
    }
    await load();
  }

  async function handleSupportDraftAction(draftId, action) {
    setSupportActionId(draftId);
    await fetch(`/api/support-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setSupportActionId(null);
    await loadSupportDrafts();
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
    <Shell active={t('nav.client', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('customer.eyebrow', locale)}</p>
        <h1>{t('nav.client', locale)}</h1>
        <p className="subtitle">
          {t('customer.subtitle', locale)}
        </p>
        <div className="header-actions">
          {/* Voir le même correctif dans app/app/prospects/page.jsx : bouton
              toujours visible (désactivé plutôt que masqué si rien à
              exporter), pour ne plus donner l'impression qu'il manque. */}
          <ExportFormatMenu
            label={t('customer.exportCsv', locale)}
            disabled={customers.length === 0}
            onChoose={(format) => exportCustomersToCsv(customers, locale, format)}
          />
          <ExportFormatMenu
            label={t('customer.downloadTemplate', locale)}
            onChoose={(format) => downloadBlankCustomersTemplate(locale, format)}
          />
          <button className="btn-secondary" onClick={() => setShowCsvImport(true)}>
            {t('csvImport.button', locale)}
          </button>
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            {t('customer.addButton', locale)}
          </button>
        </div>
      </header>

      {showAddForm && (
        <AddClientModal
          userId={userId}
          companyId={companyId}
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
          context="customer"
          module="ac"
          onClose={() => setShowCsvImport(false)}
          onImported={() => {
            load();
          }}
        />
      )}

      {!supportDraftsLoading && supportDrafts.length > 0 && (
        <section className="support-inbox">
          <h3>{t('customer.supportInboxTitle', locale).replace('{count}', supportDrafts.length)}</h3>
          <p className="muted">{t('customer.supportInboxSubtitle', locale)}</p>
          <div className="support-list">
            {supportDrafts.map((draft) => (
              <div className="support-card" key={draft.id}>
                <p className="support-from">
                  <strong>{draft.prospect_full_name}</strong>
                  {draft.is_simple && <span className="badge-simple">{t('customer.simpleFaqBadge', locale)}</span>}
                </p>
                {draft.inbound_excerpt && <p className="support-excerpt">« {draft.inbound_excerpt} »</p>}
                <div className="email-preview">
                  <p className="email-subject">{draft.suggested_subject}</p>
                  <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{draft.suggested_body}</p>
                </div>
                <div className="support-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => handleSupportDraftAction(draft.id, 'ecarter')}
                    disabled={supportActionId === draft.id}
                  >
                    {t('customer.dismiss', locale)}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => handleSupportDraftAction(draft.id, 'envoyer')}
                    disabled={supportActionId === draft.id}
                  >
                    {supportActionId === draft.id ? t('customer.sending', locale) : t('customer.send', locale)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : customers.length === 0 ? (
        <p className="muted">
          {t('customer.emptyList', locale)}
        </p>
      ) : (
        <div className="board-layout">
          <div className="list">
            {customers.map((customer) => {
              const health = customer.customer_health_label ? HEALTH_META[customer.customer_health_label] : null;
              return (
                <button
                  key={customer.id}
                  type="button"
                  className={`customer-card ${selectedId === customer.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(customer.id)}
                >
                  <div className="customer-card-top">
                    <span className="customer-name">{customer.full_name}</span>
                    {customer.is_lost ? (
                      <span className="health-badge" style={{ color: '#E5484D', borderColor: '#E5484D' }}>
                        {t('customer.lostBadge', locale)}
                      </span>
                    ) : (
                      health && (
                        <span className="health-badge" style={{ color: health.color, borderColor: health.color }}>
                          {health.label}
                        </span>
                      )
                    )}
                  </div>
                  {customer.prospect_companies?.name && <span className="customer-company">{customer.prospect_companies.name}</span>}
                  <span className="customer-meta">
                    {t('customer.clientSince', locale).replace('{days}', daysSince(customer.won_at))}
                    {!customer.is_lost && customer.customer_health_updated_at && (
                      <span
                        className="health-since"
                        title={new Date(customer.customer_health_updated_at).toLocaleString(locale)}
                      >
                        {' · '}
                        {t('customer.healthSince', locale).replace('{days}', daysSince(customer.customer_health_updated_at))}
                      </span>
                    )}
                    {customer.onboarding_status && (
                      <span className="onboarding-dot" style={{ background: ONBOARDING_META[customer.onboarding_status].color }}>
                        {ONBOARDING_META[customer.onboarding_status].label}
                      </span>
                    )}
                    {customer.ai_managed === false && (
                      <span className="onboarding-dot" style={{ background: 'var(--muted)' }}>
                        {t('customer.aiManagedBadge', locale)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="detail">
            {!selectedCustomer ? (
              <p className="muted">{t('customer.selectPrompt', locale)}</p>
            ) : (
              <>
                <h2>{selectedCustomer.full_name}</h2>
                {selectedCustomer.prospect_companies?.name && (
                  <p className="muted">{selectedCustomer.prospect_companies.name}{selectedCustomer.job_title ? ` — ${selectedCustomer.job_title}` : ''}</p>
                )}

                <section className="block">
                  <ContactInfoEditor prospect={selectedCustomer} locale={locale} onSaved={load} />
                  <CompanyInfoEditor prospect={selectedCustomer} locale={locale} onSaved={load} />
                </section>

                {selectedCustomer.won_reason && (
                  <p className="won-reason-line">
                    {t('customer.wonReasonLabel', locale).replace('{reason}', selectedCustomer.won_reason)}
                  </p>
                )}

                {selectedCustomer.is_lost ? (
                  <div className="health-row">
                    <span className="health-badge large" style={{ color: '#E5484D', borderColor: '#E5484D' }}>
                      {t('customer.lostBadge', locale)}
                    </span>
                  </div>
                ) : (
                  selectedCustomer.customer_health_label && (
                    <div className="health-row">
                      <span
                        className="health-badge large"
                        style={{ color: HEALTH_META[selectedCustomer.customer_health_label].color, borderColor: HEALTH_META[selectedCustomer.customer_health_label].color }}
                      >
                        {HEALTH_META[selectedCustomer.customer_health_label].label} — {selectedCustomer.customer_health_score}/100
                      </span>
                    </div>
                  )
                )}

                <div className="stage-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={changingStatus}
                    onClick={() => handleToggleClientLost(selectedCustomer.id, selectedCustomer.is_lost)}
                  >
                    {selectedCustomer.is_lost ? t('customer.reactivate', locale) : t('customer.markLost', locale)}
                  </button>
                </div>

                <label className="toggle-inactive ai-managed-toggle">
                  <input
                    type="checkbox"
                    checked={selectedCustomer.ai_managed !== false}
                    disabled={changingStatus}
                    onChange={() => handleToggleAiManaged(selectedCustomer.id, selectedCustomer.ai_managed !== false)}
                  />
                  {t('customer.aiManagedLabel', locale)}
                </label>
                <p className="muted ai-managed-hint">{t('customer.aiManagedHint', locale)}</p>

                <div className="stage-row">
                  <label htmlFor="onboarding-select">{t('customer.onboardingLabel', locale)}</label>
                  <select
                    id="onboarding-select"
                    value={selectedCustomer.onboarding_status || 'a_demarrer'}
                    disabled={changingStatus}
                    onChange={(e) => handleStatusChange(selectedCustomer.id, e.target.value)}
                  >
                    {ONBOARDING_ORDER.map((s) => (
                      <option key={s} value={s}>{ONBOARDING_META[s].label}</option>
                    ))}
                  </select>
                </div>

                <section className="block">
                  <h3>{t('customer.onboardingPlanTitle', locale)}</h3>

                  {!onboarding && !selectedCustomer.onboarding_plan && (
                    <button className="btn-secondary" onClick={() => handleLoadOnboarding(selectedCustomer.id)} disabled={onboardingLoading}>
                      {onboardingLoading ? t('customer.generating', locale) : t('customer.generatePlan', locale)}
                    </button>
                  )}
                  {!onboarding && selectedCustomer.onboarding_plan && (
                    <button className="btn-secondary" onClick={() => handleLoadOnboarding(selectedCustomer.id)} disabled={onboardingLoading}>
                      {onboardingLoading ? t('common.loading', locale) : t('customer.viewPlan', locale)}
                    </button>
                  )}
                  {onboardingError && <p className="error">{onboardingError}</p>}

                  {onboarding && (
                    <div className="brief-box">
                      <ul>
                        {onboarding.plan.map((step, i) => (
                          <li key={i}><strong>{step.titre}</strong> — {step.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {onboarding?.welcome_email && (
                    <div className="email-preview">
                      <p className="email-subject">{onboarding.welcome_email.subject}</p>
                      <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{onboarding.welcome_email.body}</p>
                      {selectedCustomer.welcome_email_sent_at ? (
                        <p className="sent-note">{t('customer.sentOn', locale).replace('{date}', new Date(selectedCustomer.welcome_email_sent_at).toLocaleDateString(locale, { dateStyle: 'medium' }))}</p>
                      ) : (
                        <button className="btn-primary" onClick={() => handleSendWelcome(selectedCustomer.id)} disabled={sendingWelcome}>
                          {sendingWelcome ? t('customer.sending', locale) : t('customer.sendWelcomeEmail', locale)}
                        </button>
                      )}
                    </div>
                  )}
                </section>

                <section className="block">
                  <h3>{t('customer.lastCheckinTitle', locale)}</h3>
                  {!selectedCustomer.latest_checkin ? (
                    <p className="muted">{t('customer.noCheckinYet', locale)}</p>
                  ) : (
                    <div className="brief-box">
                      <p>
                        <strong>{CHECKIN_TYPE_LABELS[selectedCustomer.latest_checkin.type] || selectedCustomer.latest_checkin.type}</strong>
                        {t('customer.sentOnSeparator', locale)}
                        {new Date(selectedCustomer.latest_checkin.sent_at).toLocaleDateString(locale, { dateStyle: 'medium' })}
                      </p>
                      {selectedCustomer.latest_checkin.responded_at ? (
                        <>
                          <p><strong>{t('customer.scoreLabel', locale)}</strong> {selectedCustomer.latest_checkin.response_score != null ? `${selectedCustomer.latest_checkin.response_score}/10` : t('customer.notProvided', locale)}</p>
                          {selectedCustomer.latest_checkin.response_comment && (
                            <p><strong>{t('customer.commentLabel', locale)}</strong> {selectedCustomer.latest_checkin.response_comment}</p>
                          )}
                        </>
                      ) : (
                        <p className="muted">{t('customer.awaitingResponse', locale)}</p>
                      )}
                    </div>
                  )}
                </section>

                {selectedCustomer.upsell_suggestion && !selectedCustomer.upsell_dismissed_at && (
                  <section className="block">
                    <h3>{t('customer.upsellTitle', locale)}</h3>
                    <div className="brief-box">
                      <p>{selectedCustomer.upsell_suggestion}</p>
                    </div>
                    <button className="btn-secondary" onClick={() => handleDismissUpsell(selectedCustomer.id)}>
                      {t('customer.dismiss', locale)}
                    </button>
                  </section>
                )}

                <section className="block">
                  <h3>{t('customer.renewalTitle', locale)}</h3>
                  <div className="stage-row">
                    <label htmlFor="renewal-date">{t('customer.renewalDateLabel', locale)}</label>
                    <input
                      id="renewal-date"
                      type="date"
                      value={renewalDateInput || ''}
                      onChange={(e) => setRenewalDateInput(e.target.value)}
                      className="date-input"
                    />
                    <button className="btn-secondary" onClick={() => handleSetRenewalDate(selectedCustomer.id)} disabled={renewalSaving}>
                      {renewalSaving ? '…' : t('common.save', locale)}
                    </button>
                  </div>

                  {selectedCustomer.contract_renewal_date && (
                    <>
                      {selectedCustomer.renewal_email_sent_at ? (
                        <p className="sent-note">{t('customer.renewalEmailSent', locale)}</p>
                      ) : selectedCustomer.renewal_email_subject ? (
                        <div className="email-preview">
                          <p className="email-subject">{selectedCustomer.renewal_email_subject}</p>
                          <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{selectedCustomer.renewal_email_body}</p>
                          {renewalError && <p className="error">{renewalError}</p>}
                          <button className="btn-secondary" onClick={() => handleGenerateRenewal(selectedCustomer.id, true)} disabled={renewalLoading}>
                            {renewalLoading ? t('customer.regenerating', locale) : t('customer.regenerate', locale)}
                          </button>
                          <button className="btn-primary" onClick={() => handleSendRenewal(selectedCustomer.id)} disabled={sendingRenewal}>
                            {sendingRenewal ? t('customer.sending', locale) : t('customer.sendToCustomer', locale)}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button className="btn-secondary" onClick={() => handleGenerateRenewal(selectedCustomer.id, false)} disabled={renewalLoading}>
                            {renewalLoading ? t('customer.generating', locale) : t('customer.generateRenewalEmail', locale)}
                          </button>
                          {renewalError && <p className="error">{renewalError}</p>}
                        </>
                      )}
                    </>
                  )}
                </section>

                <section className="block">
                  <h3>{t('customer.testimonialTitle', locale)}</h3>
                  {selectedCustomer.testimonial_email_sent_at ? (
                    <p className="sent-note">{t('customer.testimonialSent', locale)}</p>
                  ) : selectedCustomer.testimonial_email_subject ? (
                    <div className="email-preview">
                      <p className="email-subject">{selectedCustomer.testimonial_email_subject}</p>
                      <p className="email-body" style={{ whiteSpace: 'pre-line' }}>{selectedCustomer.testimonial_email_body}</p>
                      {testimonialError && <p className="error">{testimonialError}</p>}
                      <button className="btn-secondary" onClick={() => handleGenerateTestimonial(selectedCustomer.id, true)} disabled={testimonialLoading}>
                        {testimonialLoading ? t('customer.regenerating', locale) : t('customer.regenerate', locale)}
                      </button>
                      <button className="btn-primary" onClick={() => handleSendTestimonial(selectedCustomer.id)} disabled={sendingTestimonial}>
                        {sendingTestimonial ? t('customer.sending', locale) : t('customer.sendToCustomer', locale)}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="muted">{t('customer.testimonialAutoInfo', locale)}</p>
                      <button className="btn-secondary" onClick={() => handleGenerateTestimonial(selectedCustomer.id, false)} disabled={testimonialLoading}>
                        {testimonialLoading ? t('customer.generating', locale) : t('customer.generateTestimonialRequest', locale)}
                      </button>
                      {testimonialError && <p className="error">{testimonialError}</p>}
                    </>
                  )}
                </section>

                <section className="block">
                  <h3>{t('customer.invoicesTitle', locale)}</h3>

                  {clientInvoicesLoading ? (
                    <p className="muted">…</p>
                  ) : (
                    <>
                      {clientInvoices.length === 0 && <p className="muted">{t('customer.invoicesEmpty', locale)}</p>}
                      {clientInvoices.map((inv) => (
                        <div key={inv.id} className="email-preview">
                          <p className="email-subject">
                            {inv.invoice_number} — {(inv.total_ttc_eur || 0).toFixed(2)} € — {invoiceStatusLabel(inv.status, locale)}
                          </p>
                          <div className="actions-row">
                            {(inv.status === 'emise' || inv.status === 'en_retard') && (
                              <>
                                <button
                                  className="btn-secondary"
                                  disabled={invoiceActionBusyId === inv.id}
                                  onClick={() => handleInvoiceStatusChange(selectedCustomer.id, inv.id, 'payee')}
                                >
                                  {t('customer.invoicesMarkPaidButton', locale)}
                                </button>
                                <button
                                  className="btn-secondary"
                                  disabled={invoiceActionBusyId === inv.id}
                                  onClick={() => handleInvoiceStatusChange(selectedCustomer.id, inv.id, 'annulee')}
                                >
                                  {t('customer.invoicesCancelButton', locale)}
                                </button>
                              </>
                            )}
                            <button
                              className="btn-secondary"
                              disabled={invoiceActionBusyId === inv.id}
                              onClick={() => handleDownloadInvoicePdf(selectedCustomer.id, inv.id, inv.invoice_number)}
                            >
                              {t('customer.invoicesDownloadButton', locale)}
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {!showInvoiceForm && (
                    <div className="actions-row">
                      <button className="btn-secondary" onClick={() => setShowInvoiceForm(true)}>
                        {t('customer.invoicesNewButton', locale)}
                      </button>
                      {selectedCustomer.devis_recap && (
                        <button
                          className="btn-secondary"
                          disabled={creatingInvoice}
                          onClick={() => submitInvoice(selectedCustomer.id, { prefillFromDevis: true })}
                        >
                          {creatingInvoice ? t('customer.invoicesCreating', locale) : t('customer.invoicesPrefillButton', locale)}
                        </button>
                      )}
                    </div>
                  )}

                  {showInvoiceForm && (
                    <div className="email-preview">
                      {invoiceLines.map((line, idx) => (
                        <div key={idx} className="actions-row">
                          <input
                            type="text"
                            className="invoice-input"
                            placeholder={t('customer.invoicesDesignationPlaceholder', locale)}
                            value={line.designation}
                            onChange={(e) => {
                              const next = [...invoiceLines];
                              next[idx] = { ...next[idx], designation: e.target.value };
                              setInvoiceLines(next);
                            }}
                          />
                          <input
                            type="number"
                            min="1"
                            className="invoice-input invoice-input-narrow"
                            placeholder={t('customer.invoicesQuantityPlaceholder', locale)}
                            value={line.quantite}
                            onChange={(e) => {
                              const next = [...invoiceLines];
                              next[idx] = { ...next[idx], quantite: e.target.value };
                              setInvoiceLines(next);
                            }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="invoice-input invoice-input-narrow"
                            placeholder={t('customer.invoicesUnitPricePlaceholder', locale)}
                            value={line.prix_unitaire_ht_eur}
                            onChange={(e) => {
                              const next = [...invoiceLines];
                              next[idx] = { ...next[idx], prix_unitaire_ht_eur: e.target.value };
                              setInvoiceLines(next);
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setInvoiceLines([...invoiceLines, { designation: '', quantite: '1', prix_unitaire_ht_eur: '' }])}
                      >
                        {t('customer.invoicesAddLineButton', locale)}
                      </button>

                      <label>{t('customer.invoicesDueDateLabel', locale)}</label>
                      <input type="date" className="date-input" value={invoiceDueDate} onChange={(e) => setInvoiceDueDate(e.target.value)} />

                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="invoice-input invoice-input-narrow"
                        placeholder={t('customer.invoicesVatRatePlaceholder', locale)}
                        value={invoiceVatRate}
                        onChange={(e) => setInvoiceVatRate(e.target.value)}
                      />

                      <div className="actions-row">
                        <button className="btn-secondary" onClick={() => setShowInvoiceForm(false)}>
                          {t('customer.invoicesCancelCreate', locale)}
                        </button>
                        <button className="btn-primary" disabled={creatingInvoice} onClick={() => submitInvoice(selectedCustomer.id, { prefillFromDevis: false })}>
                          {creatingInvoice ? t('customer.invoicesCreating', locale) : t('customer.invoicesCreateButton', locale)}
                        </button>
                      </div>
                    </div>
                  )}

                  {invoiceCreateError && <p className="error">{invoiceCreateError}</p>}
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
          grid-template-columns: 1fr 380px;
          gap: 1.5rem;
          align-items: start;
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .customer-card {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          text-align: left;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.8rem 1rem;
          cursor: pointer;
          color: var(--text);
          font-family: inherit;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .customer-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .customer-card.selected {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.12);
        }
        .customer-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
        }
        .customer-name {
          font-size: 0.92rem;
          font-weight: 600;
        }
        .customer-company {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .customer-meta {
          font-size: 0.74rem;
          color: var(--muted);
          margin-top: 0.2rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .onboarding-dot {
          font-size: 0.68rem;
          padding: 0.1rem 0.45rem;
          border-radius: 999px;
          color: var(--bg);
          font-weight: 600;
        }
        .won-reason-line {
          font-size: 0.82rem;
          line-height: 1.5;
          color: var(--muted);
          background: rgba(75, 57, 239, 0.1);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.7rem;
          margin: 0.4rem 0 0.8rem;
        }
        .health-badge {
          font-size: 0.68rem;
          font-weight: 600;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.15rem 0.5rem;
          white-space: nowrap;
        }
        .health-badge.large {
          font-size: 0.8rem;
          padding: 0.3rem 0.7rem;
        }
        .health-row {
          margin: 0.8rem 0;
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
        .toggle-inactive {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: var(--muted);
          font-size: 0.82rem;
          cursor: pointer;
        }
        .ai-managed-toggle {
          margin-top: 0.6rem;
          color: var(--text);
          font-weight: 500;
        }
        .ai-managed-hint {
          font-size: 0.78rem;
          margin: 0.2rem 0 0;
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
          margin: 0;
          padding-left: 1.1rem;
        }
        .brief-box li {
          margin-bottom: 0.4rem;
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
        .date-input {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.6rem;
          font-size: 0.82rem;
          font-family: inherit;
        }
        .actions-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
          margin-top: 0.6rem;
        }
        .actions-row .btn-secondary,
        .actions-row .btn-primary {
          margin-top: 0;
        }
        .invoice-input {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.6rem;
          font-size: 0.82rem;
          font-family: inherit;
          flex: 1 1 160px;
        }
        .invoice-input-narrow {
          flex: 0 1 100px;
        }
        .support-inbox {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.2rem 1.4rem;
          margin-bottom: 1.8rem;
        }
        .support-inbox h3 {
          font-size: 0.95rem;
          margin: 0 0 0.3rem;
        }
        .support-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.8rem;
          margin-top: 0.9rem;
        }
        .support-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
        }
        .support-from {
          font-size: 0.84rem;
          margin: 0 0 0.4rem;
        }
        .badge-simple {
          display: inline-block;
          margin-left: 0.5rem;
          padding: 0.1rem 0.5rem;
          border-radius: var(--radius-sm);
          background: rgba(61, 214, 140, 0.15);
          color: var(--accent-green);
          font-size: 0.68rem;
          font-weight: 600;
          vertical-align: middle;
        }
        .support-excerpt {
          font-size: 0.78rem;
          color: var(--muted);
          font-style: italic;
          margin: 0 0 0.6rem;
        }
        .support-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.8rem;
        }
        @media (max-width: 1100px) {
          .board-layout {
            grid-template-columns: 1fr;
          }
          .detail {
            position: static;
            max-height: none;
          }
          .support-list {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId, onNotificationsChanged, onNotificationContact }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  // Docx « derniers ajouts » (05/09/2026) : « Mon équipe » disparaissait
  // 1–2 s à chaque changement de rubrique, le temps que /api/preferences
  // réponde, puis réapparaissait. On relit d'abord le rôle mémorisé lors de
  // la dernière réponse (par utilisateur), puis la réponse le confirme : la
  // rubrique est là dès le premier rendu et ne bouge plus.
  useEffect(() => {
    if (!userId) return;
    try {
      const cached = window.localStorage.getItem(`aaron_role:${userId}`);
      if (cached) setUserRole(cached);
    } catch {
      // stockage indisponible : on attend simplement la réponse réseau
    }
  }, [userId]);
  // Docx Modifs Aaron (30/08/2026) : la rubrique Clients est réservée au
  // compte aaron@meetaaron.app (supprimée pour tous les autres comptes,
  // fondateur comme commercial) — même logique "fermé par défaut" que
  // userRole ci-dessus. Produits est retiré pour tout le monde, et
  // Suggestions devient un onglet de Mon équipe (voir app/app/team/page.jsx).
  const [userEmail, setUserEmail] = useState(null);
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
        try {
          window.localStorage.setItem(`aaron_role:${userId}`, prefs.role || '');
        } catch {
          // idem : best effort
        }
        setUserEmail(prefs.email || null);
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
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
  ];
  return (
    <div className="shell">
      {/* Habillage téléphone/tablette : barre du haut + barre d'onglets du
          bas (components/MobileChrome.jsx, styles dans app/globals.css) —
          remplace l'ancien bouton hamburger flottant (docx 30/08, item 8). */}
      <MobileChrome
        title={active}
        items={NAV_ITEMS}
        userId={userId}
        onMenu={() => setMobileOpen(true)}
        menuLabel={t('shell.openMenu', locale)}
        moreLabel={t('shell.more', locale)}
        locale={locale}
      />
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        {/* Rail replié (≥901px) : le nom de la langue ne tient pas dans 78 px
            (« França… », capture Alex 05/09) — .lang-wrap affiche le code (FR)
            par-dessus le select, qui garde les noms complets dans sa liste. */}
        <div className="lang-wrap" data-code={locale.toUpperCase()}>
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
            <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
          ))}
        </select>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel"><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon"><NavIcon slug="logout" /></span>
            <span className="nav-label">{t('common.logout', locale)}</span>
          </button>
        </div>
      </nav>
      <main className="content">
        {/* Notifications « bulles » en haut de CHAQUE page, toujours au même
            endroit (demande Alex, 03/09/2026). Avant, le bandeau n'existait
            que sur Tableau de bord et Contacts, et la cloche du rail était
            invisible sous 901px : sur téléphone, un commercial ne voyait donc
            AUCUNE notification tant qu'il n'était pas sur l'une de ces deux
            pages. Placé ici, dans le Shell, la position est identique partout
            et sur tous les écrans.
            Coût nul quand il n'y a rien à traiter : Stories rend `null` si
            aucun groupe n'est en attente (voir components/Stories.jsx), donc
            aucune page ne perd de hauteur utile. */}
        <Stories userId={userId} locale={locale} onChanged={onNotificationsChanged} onOpenContact={onNotificationContact} />
        {children}
      </main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: var(--tint-7);
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
          box-shadow: 0 0 0 1px var(--tint-8), 0 4px 14px rgba(75, 57, 239, 0.35);
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
          background: var(--tint-4);
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

// docx AJOUT GLOBAL A15 : "ajouter manuellement" un client — pour une
// relation déjà cliente hors Meet Aaron (reprise de base existante). Crée le
// prospect sans déclencher le 1er email de prospection à froid
// (skip_first_contact, voir app/api/prospects/route.ts), puis le marque
// directement gagné + 1ère commande confirmée via l'action existante
// marquer_gagne (app/api/prospects/[id]/route.ts) — ce qui déclenche
// l'onboarding automatique normal (docx Clients A1a), comme pour un vrai
// nouveau client.
function AddClientModal({ userId, companyId, onClose, onCreated }) {
  const [locale] = useLocale();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
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
      setError(body.error || t('customer.addModalErrorFallback', locale));
      return;
    }

    const patchRes = await fetch(`/api/prospects/${body.prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'marquer_gagne', first_order_confirmed: true }),
    });

    setSubmitting(false);

    if (!patchRes.ok) {
      const patchBody = await patchRes.json();
      setError(patchBody.error || t('customer.addModalErrorFallback', locale));
      return;
    }

    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t('customer.addModalTitle', locale)}</h2>
        <p className="hint">{t('customer.addModalHint', locale)}</p>

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
            {submitting ? t('customer.addModalSubmitting', locale) : t('customer.addModalSubmit', locale)}
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
        input {
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
