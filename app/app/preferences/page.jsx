// app/app/preferences/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import PushNotificationManager from '@/components/PushNotificationManager';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
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
        setAuthError(body.error || 'Accès refusé');
        setAuthLoading(false);
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

function channelOptionsFor(locale) {
  return [
    { value: 'email', label: t('preferences.channel.email', locale) },
    { value: 'push', label: t('preferences.channel.push', locale) },
    { value: 'both', label: t('preferences.channel.both', locale) },
  ];
}

const DELAY_OPTIONS = [15, 30, 60];

function firstEmailOptionsFor(locale) {
  return [
    { value: false, label: t('preferences.firstEmail.auto', locale) },
    { value: true, label: t('preferences.firstEmail.manual', locale) },
  ];
}

function collaborationLevelsFor(locale) {
  return [
    { value: 0, label: t('preferences.crm.level0Label', locale), desc: t('preferences.crm.level0Desc', locale) },
    { value: 1, label: t('preferences.crm.level1Label', locale), desc: t('preferences.crm.level1Desc', locale) },
    { value: 2, label: t('preferences.crm.level2Label', locale), desc: t('preferences.crm.level2Desc', locale) },
    { value: 3, label: t('preferences.crm.level3Label', locale), desc: t('preferences.crm.level3Desc', locale) },
  ];
}

function crmProvidersFor(locale) {
  return [
    { value: '', label: t('preferences.crm.selectPlaceholder', locale) },
    { value: 'divalto', label: 'Divalto' },
    { value: 'salesforce', label: 'Salesforce' },
    { value: 'hubspot', label: 'HubSpot' },
    { value: 'pipedrive', label: 'Pipedrive' },
    { value: 'axonaut', label: 'Axonaut' },
    { value: 'sellsy', label: 'Sellsy' },
    { value: 'jobber', label: 'Jobber' },
    { value: 'housecallpro', label: 'Housecall Pro' },
    { value: 'capsulecrm', label: 'Capsule CRM' },
    { value: 'servicem8', label: 'ServiceM8' },
    { value: 'autre', label: t('preferences.crm.otherProvider', locale) },
  ];
}

function offersFor(locale) {
  return [
    { value: 'AP', label: t('preferences.offers.apLabel', locale), desc: t('preferences.offers.apDesc', locale), available: true },
    { value: 'AS', label: t('nav.opportunity', locale), desc: t('preferences.offers.asDesc', locale), available: true },
    { value: 'AC', label: t('nav.client', locale), desc: t('preferences.offers.acDesc', locale), available: true },
  ];
}

export default function PreferencesPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const CHANNEL_OPTIONS = channelOptionsFor(locale);
  const FIRST_EMAIL_OPTIONS = firstEmailOptionsFor(locale);
  const COLLABORATION_LEVELS = collaborationLevelsFor(locale);
  const CRM_PROVIDERS = crmProvidersFor(locale);
  const OFFERS = offersFor(locale);
  const TABS = [
    { key: 'profile', label: t('preferences.tabs.profile', locale) },
    { key: 'preferences', label: t('preferences.tabs.preferences', locale) },
    { key: 'subscription', label: t('preferences.tabs.subscription', locale) },
  ];
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [offerError, setOfferError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [businessSummary, setBusinessSummary] = useState('');
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [signature, setSignature] = useState('');
  const [signatureLoaded, setSignatureLoaded] = useState(false);
  const [detectingSignature, setDetectingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState(null);
  const [savingSignature, setSavingSignature] = useState(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [buyingCredits, setBuyingCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [openingBillingPortal, setOpeningBillingPortal] = useState(false);
  const [billingPortalError, setBillingPortalError] = useState(null);
  // CHANGEMENTS A FAIRE #91-93 (2026-08-16, items 28-32) : page renommée et
  // restructurée en 3 onglets (Mon profil / Préférences / Abonnement) — voir
  // tableau TABS plus bas. `handleSave` reste unique et sauvegarde tous les
  // champs "Préférences" quel que soit l'onglet actif (bouton toujours visible
  // en bas du panneau), pour ne rien changer au comportement de sauvegarde.
  const [activeTab, setActiveTab] = useState('profile');
  const [customCredits, setCustomCredits] = useState('');
  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — état dédié pour le bouton activer/désactiver de chaque
  // module (séparé de `saving`, qui reste réservé au bouton "Enregistrer"
  // générique : activer/désactiver un module a un effet Stripe immédiat, pas
  // besoin d'attendre le clic sur "Enregistrer").
  const [moduleBusy, setModuleBusy] = useState(null);
  const [moduleError, setModuleError] = useState(null);

  function loadPrefs() {
    if (!userId) return;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setPrefs(res.preferences);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!userId) return;
    loadPrefs();
    fetch(`/api/api-usage?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => setUsage(res))
      .catch(() => {});
    fetch(`/api/business-summary?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setBusinessSummary(res.summary || '');
        setSummaryLoaded(true);
      })
      .catch(() => setSummaryLoaded(true));
    fetch(`/api/signature?user_id=${userId}`)
      .then((r) => r.json())
      .then((res) => {
        setSignature(res.signature || '');
        setSignatureLoaded(true);
      })
      .catch(() => setSignatureLoaded(true));
  }, [userId]);

  async function handleDetectSignature() {
    setDetectingSignature(true);
    setSignatureError(null);
    const res = await fetch('/api/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await res.json();
    setDetectingSignature(false);
    if (!res.ok || !body.signature) {
      setSignatureError(body.error || t('preferences.signatureNotDetected', locale));
      return;
    }
    setSignature(body.signature);
  }

  async function handleSaveSignature() {
    setSavingSignature(true);
    setSignatureSaved(false);
    const res = await fetch('/api/signature', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, signature }),
    });
    setSavingSignature(false);
    if (res.ok) {
      setSignatureSaved(true);
      setTimeout(() => setSignatureSaved(false), 2500);
    }
  }

  async function handleSaveSummary() {
    setSavingSummary(true);
    setSummarySaved(false);
    const res = await fetch('/api/business-summary', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, summary: businessSummary }),
    });
    setSavingSummary(false);
    if (res.ok) {
      setSummarySaved(true);
      setTimeout(() => setSummarySaved(false), 2500);
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('user_id', userId);
    formData.append('description', 'Historique clients gagnés/perdus (niveau 1 CRM)');
    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    setUploading(false);
    if (res.ok) {
      setUploadDone(true);
      setUploadFile(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setOfferError(null);
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        notify_channel: prefs.notify_channel,
        notify_before_appointment_minutes: prefs.notify_before_appointment_minutes,
        require_first_email_approval: prefs.require_first_email_approval,
        daily_prospecting_email_cap: prefs.daily_prospecting_email_cap,
        collaboration_level: prefs.collaboration_level,
        crm_provider: prefs.crm_provider,
        crm_connection_notes: prefs.crm_connection_notes,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json();
      setOfferError(body.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : active ou
  // désactive un module d'abonnement (docx : "un bouton à côté de chacun pour
  // résilier l'abonnement ou activer l'abonnement"). Effet Stripe immédiat
  // (voir app/api/subscription/modules/route.ts) — recharge les préférences
  // ensuite pour refléter le nouvel état réel plutôt que de deviner
  // localement ce que Stripe a fait.
  async function handleToggleModule(moduleValue, isActive) {
    if (isActive) {
      const activeCount = ['AP', 'AS', 'AC'].filter((m) => prefs[`offer_${m.toLowerCase()}_active`]).length;
      const warningKey = activeCount <= 1
        ? 'preferences.subscription.confirmDeactivateLastTemplate'
        : 'preferences.subscription.confirmDeactivateTemplate';
      const moduleLabel = OFFERS.find((o) => o.value === moduleValue)?.label || moduleValue;
      if (!confirm(t(warningKey, locale).replace('{module}', moduleLabel))) return;
    }

    setModuleBusy(moduleValue);
    setModuleError(null);
    try {
      const res = await fetch('/api/subscription/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleValue, action: isActive ? 'deactivate' : 'activate' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setModuleError(body.error || t('common.error', locale));
        return;
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return;
      }
      loadPrefs();
    } catch (err) {
      setModuleError(t('common.error', locale));
    } finally {
      setModuleBusy(null);
    }
  }

  // CHANGEMENTS A FAIRE #91-93 (item 31) : "booster Aaron" prend désormais un
  // nombre de crédits (20/40/60/80/100 ou un montant personnalisé) plutôt
  // qu'un montant en euros — le tarif (30€ pour 20 crédits, soit 1,50€/crédit)
  // est calculé côté serveur dans /api/checkout/credits, jamais côté client.
  async function handleBuyCredits(credits) {
    setBuyingCredits(credits);
    setCreditsError(null);
    try {
      const res = await fetch('/api/checkout/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setCreditsError(body.error || t('common.error', locale));
        setBuyingCredits(null);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setCreditsError(t('common.error', locale));
      setBuyingCredits(null);
    }
  }

  function handleBuyCustomCredits() {
    const credits = Number(customCredits);
    if (!Number.isFinite(credits) || credits < 1 || credits > 5000 || !Number.isInteger(credits)) {
      setCreditsError(t('preferences.credits.invalidCustom', locale));
      return;
    }
    handleBuyCredits(credits);
  }

  // Ouvre le portail de facturation Stripe (factures téléchargeables — avec
  // TVA/GST/sales tax quand Stripe Tax est activé côté Dashboard, moyen de
  // paiement, résiliation) dans un nouvel onglet, réservé au patron.
  async function handleOpenBillingPortal() {
    setOpeningBillingPortal(true);
    setBillingPortalError(null);
    try {
      const res = await fetch('/api/billing-portal', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setBillingPortalError(body.error || t('common.error', locale));
        setOpeningBillingPortal(false);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setBillingPortalError(t('common.error', locale));
      setOpeningBillingPortal(false);
    }
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
    <Shell active={t('nav.preferences', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('preferences.eyebrow', locale)}</p>
        <h1>{t('nav.preferences', locale)}</h1>
      </header>

      {loading || !prefs ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <div className="panel">
          {/* CHANGEMENTS A FAIRE #91-93 (2026-08-16, items 28-32) : page
              restructurée en 3 onglets. */}
          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'profile' && (
            <>
              {summaryLoaded && (
                <div className="field">
                  <label>{t('preferences.businessProfileLabel', locale)}</label>
                  <textarea
                    rows={6}
                    value={businessSummary}
                    onChange={(e) => setBusinessSummary(e.target.value)}
                    placeholder={t('preferences.businessProfilePlaceholder', locale)}
                  />
                  <div className="actions">
                    <button className="btn-secondary" onClick={handleSaveSummary} disabled={savingSummary}>
                      {savingSummary ? t('preferences.savingEllipsis', locale) : t('preferences.saveSummaryButton', locale)}
                    </button>
                    {summarySaved && <span className="saved-msg">{t('preferences.summarySavedMsg', locale)}</span>}
                    {/* Demande d'Alex (2026-08-19) : reprendre le questionnaire de
                        découverte guidé (app/app/chat/page.jsx) depuis Préférences,
                        pour quelqu'un qui l'a manqué/interrompu la première fois —
                        voir restartRequested dans chat/page.jsx. N'écrase pas la
                        conversation existante, l'ajoute à la suite. */}
                    <Link href={`/app/chat?user_id=${userId}&restart_questionnaire=1`} className="btn-secondary link-btn">
                      {t('preferences.retakeQuestionnaireButton', locale)}
                    </Link>
                  </div>
                </div>
              )}

              {signatureLoaded && (
                <div className="field">
                  <label>{t('preferences.signatureLabel', locale)}</label>
                  <textarea
                    rows={4}
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder={t('preferences.signaturePlaceholder', locale)}
                  />
                  {signatureError && <p className="error">{signatureError}</p>}
                  <div className="actions">
                    <button type="button" className="btn-secondary" onClick={handleDetectSignature} disabled={detectingSignature}>
                      {detectingSignature ? t('preferences.detectingEllipsis', locale) : t('preferences.detectSignatureButton', locale)}
                    </button>
                    <button className="btn-secondary" onClick={handleSaveSignature} disabled={savingSignature}>
                      {savingSignature ? t('preferences.savingEllipsis', locale) : t('preferences.saveSignatureButton', locale)}
                    </button>
                    {signatureSaved && <span className="saved-msg">{t('preferences.signatureSavedMsg', locale)}</span>}
                  </div>
                  <p className="collab-extra-hint">
                    {t('preferences.signatureDetectHint', locale)}
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === 'preferences' && (
            <>
              <div className="field">
                <label>{t('preferences.notifyChannelLabel', locale)}</label>
                <div className="options">
                  {CHANNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={prefs.notify_channel === opt.value ? 'option active' : 'option'}
                      onClick={() => setPrefs({ ...prefs, notify_channel: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {(prefs.notify_channel === 'push' || prefs.notify_channel === 'both') && (
                  <PushNotificationManager />
                )}
              </div>

              <div className="field">
                <label>{t('preferences.notifyDelayLabel', locale)}</label>
                <div className="options">
                  {DELAY_OPTIONS.map((minutes) => (
                    <button
                      key={minutes}
                      className={prefs.notify_before_appointment_minutes === minutes ? 'option active' : 'option'}
                      onClick={() => setPrefs({ ...prefs, notify_before_appointment_minutes: minutes })}
                    >
                      {minutes} {t('preferences.minutesUnit', locale)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>{t('preferences.firstEmailLabel', locale)}</label>
                <div className="options">
                  {FIRST_EMAIL_OPTIONS.map((opt) => (
                    <button
                      key={String(opt.value)}
                      className={prefs.require_first_email_approval === opt.value ? 'option active' : 'option'}
                      onClick={() => setPrefs({ ...prefs, require_first_email_approval: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="collab-extra-hint">
                  {t('preferences.firstEmailHint', locale)}
                </p>
              </div>

              <div className="field">
                <label>{t('preferences.dailyCapLabel', locale)}</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  className="cap-input"
                  value={prefs.daily_prospecting_email_cap}
                  onChange={(e) => setPrefs({ ...prefs, daily_prospecting_email_cap: e.target.value === '' ? '' : Number(e.target.value) })}
                />
                <p className="collab-extra-hint">
                  {t('preferences.dailyCapHint', locale)}
                </p>
              </div>

              <div className="field">
                <label>{t('preferences.crm.collabLevelLabel', locale)}</label>
                <div className="collab-options">
                  {COLLABORATION_LEVELS.map((lvl) => (
                    <button
                      key={lvl.value}
                      className={prefs.collaboration_level === lvl.value ? 'collab-card active' : 'collab-card'}
                      onClick={() => setPrefs({ ...prefs, collaboration_level: lvl.value })}
                    >
                      <span className="collab-title">{lvl.label}</span>
                      <span className="collab-desc">{lvl.desc}</span>
                    </button>
                  ))}
                </div>

                {prefs.collaboration_level === 1 && (
                  <div className="collab-extra">
                    <p className="collab-extra-hint">
                      {t('preferences.crm.uploadHint', locale)}
                    </p>
                    <div className="upload-row">
                      <input type="file" accept=".xls,.xlsx,.csv,.pdf,.txt" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                      <button type="button" className="btn-secondary" onClick={handleUpload} disabled={!uploadFile || uploading}>
                        {uploading ? t('preferences.crm.uploadingEllipsis', locale) : t('preferences.crm.uploadButton', locale)}
                      </button>
                    </div>
                    {uploadDone && <p className="saved-msg">{t('preferences.crm.uploadDoneMsg', locale)}</p>}
                  </div>
                )}

                {(prefs.collaboration_level === 2 || prefs.collaboration_level === 3) && (
                  <div className="collab-extra">
                    <label className="sub-label">{t('preferences.crm.whichCrmLabel', locale)}</label>
                    <select
                      value={prefs.crm_provider || ''}
                      onChange={(e) => setPrefs({ ...prefs, crm_provider: e.target.value || null })}
                    >
                      {CRM_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <label className="sub-label">{t('preferences.crm.notesLabel', locale)}</label>
                    <textarea
                      rows={3}
                      value={prefs.crm_connection_notes || ''}
                      onChange={(e) => setPrefs({ ...prefs, crm_connection_notes: e.target.value })}
                      placeholder={t('preferences.crm.notesPlaceholder', locale)}
                    />
                    <p className="collab-extra-hint">
                      {t('preferences.crm.setupHint', locale)}
                    </p>

                    {['hubspot', 'salesforce', 'pipedrive', 'axonaut', 'sellsy', 'jobber', 'housecallpro', 'capsulecrm', 'servicem8'].includes(prefs.crm_provider) && (
                      // CHANGEMENTS A FAIRE #90 (2026-08-16) : la connexion HubSpot
                      // elle-même (connecter/déconnecter/synchroniser) se gère
                      // désormais depuis Connexions, nouvelle catégorie "CRMs et
                      // bases de données" — cette page ne garde que le choix du
                      // fournisseur et le niveau de collaboration (voir item #30).
                      // Généralisé (2026-08-16) à Salesforce et Pipedrive, mêmes
                      // connexions OAuth directes que HubSpot. Axonaut ajouté suite
                      // 15 : pas d'OAuth (clé API statique, voir Connexions) mais se
                      // gère depuis la même page.
                      <p className="collab-extra-hint">
                        {t('preferences.crm.manageInConnexionsHint', locale)}{' '}
                        <Link href={`/app/connexions${userId ? `?user_id=${userId}` : ''}`}>
                          {t('nav.connections', locale)}
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'subscription' && (
            <>
              {/* CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) :
                  l'ancien sélecteur "une seule offre à la fois" est remplacé
                  par 3 modules indépendamment actifs/inactifs, chacun avec son
                  propre bouton activer/désactiver — voir handleToggleModule
                  et app/api/subscription/modules/route.ts. */}
              <div className="field">
                <label>{t('preferences.subscriptionLabel', locale)}</label>
                <div className="offer-options">
                  {OFFERS.map((o) => {
                    const isActive = Boolean(prefs[`offer_${o.value.toLowerCase()}_active`]);
                    return (
                      <div key={o.value} className={`offer-card ${isActive ? 'active' : ''}`}>
                        <span className="offer-title">
                          {o.label}
                          <span className={`status-pill ${isActive ? 'on' : 'off'}`}>
                            {isActive ? t('preferences.subscription.activeLabel', locale) : t('preferences.subscription.inactiveLabel', locale)}
                          </span>
                        </span>
                        <span className="offer-desc">{o.desc}</span>
                        {prefs.role === 'patron' && (
                          <button
                            type="button"
                            className={isActive ? 'btn-danger' : 'btn-primary'}
                            disabled={moduleBusy === o.value}
                            onClick={() => handleToggleModule(o.value, isActive)}
                          >
                            {moduleBusy === o.value
                              ? '…'
                              : isActive
                                ? t('preferences.subscription.deactivateButton', locale)
                                : t('preferences.subscription.activateButton', locale)}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {moduleError && <p className="error">{moduleError}</p>}
                {!moduleError && offerError && <p className="error">{offerError}</p>}
              </div>

              {usage && (
                <div className="field credits-field">
                  <label>{t('preferences.credits.label', locale)}</label>
                  <div className="usage-box">
                    <div className="usage-row">
                      <span>{t('preferences.credits.currentBalance', locale)}</span>
                      <strong>{Number(usage.credit_balance_eur || 0).toFixed(2)} €</strong>
                    </div>
                    <p className="usage-hint">
                      {t('preferences.credits.includedHint', locale)}
                    </p>
                    <p className="usage-hint">
                      {t('preferences.credits.sharedPoolHint', locale)}
                    </p>
                    {prefs.role === 'patron' ? (
                      <>
                        <div className="credits-buy-row">
                          {[20, 40, 60, 80, 100].map((credits) => (
                            <button
                              key={credits}
                              type="button"
                              className="btn-secondary"
                              disabled={buyingCredits !== null}
                              onClick={() => handleBuyCredits(credits)}
                            >
                              {buyingCredits === credits ? '…' : `+${credits} (${(credits * 1.5).toFixed(0)} €)`}
                            </button>
                          ))}
                        </div>
                        <div className="upload-row">
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            className="cap-input"
                            placeholder={t('preferences.credits.customPlaceholder', locale)}
                            value={customCredits}
                            onChange={(e) => setCustomCredits(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={buyingCredits !== null || !customCredits}
                            onClick={handleBuyCustomCredits}
                          >
                            {t('preferences.credits.customButton', locale)}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="usage-hint">{t('preferences.credits.ownerOnlyHint', locale)}</p>
                    )}
                    {creditsError && <p className="error">{creditsError}</p>}
                  </div>
                </div>
              )}

              {prefs?.role === 'patron' && (
                <div className="field credits-field">
                  <label>{t('preferences.billing.label', locale)}</label>
                  <div className="usage-box">
                    <p className="usage-hint">
                      {t('preferences.billing.hint', locale)}
                    </p>
                    <div className="credits-buy-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={openingBillingPortal}
                        onClick={handleOpenBillingPortal}
                      >
                        {openingBillingPortal ? '…' : t('preferences.billing.manageButton', locale)}
                      </button>
                    </div>
                    {billingPortalError && <p className="error">{billingPortalError}</p>}
                  </div>
                </div>
              )}

              {/* CHANGEMENTS A FAIRE #91-93 (item 32) : "Suivi des coûts API"
                  réservé au compte aaron@meetaaron.app désormais, plus visible
                  pour les autres sociétés/comptes. */}
              {usage && prefs.email === 'aaron@meetaaron.app' && (
                <div className="field usage-field">
                  <label>{t('preferences.usage.apiCostLabel', locale)}</label>
                  <div className="usage-box">
                    <div className="usage-row">
                      <span>{t('preferences.usage.thisMonth', locale)}</span>
                      <strong>
                        {usage.month_cost_usd.toFixed(2)} $
                        {usage.monthly_cap_usd !== null && t('preferences.usage.capSuffixTemplate', locale).replace('{cap}', usage.monthly_cap_usd)}
                      </strong>
                    </div>
                    <div className="usage-row">
                      <span>{t('preferences.usage.today', locale)}</span>
                      <strong>{usage.today_cost_usd.toFixed(2)} $</strong>
                    </div>
                    <div className="usage-bars">
                      {usage.last_7_days.map((d) => (
                        <div key={d.date} className="usage-bar-wrap" title={`${d.date} : ${d.cost_usd.toFixed(2)} $`}>
                          <div
                            className="usage-bar"
                            style={{ height: `${Math.min(100, (d.cost_usd / (usage.daily_cap_usd || 1)) * 100)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="usage-hint">
                      {t('preferences.usage.hint', locale)}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="actions">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t('preferences.savingEllipsis', locale) : t('common.save', locale)}
            </button>
            {saved && <span className="saved-msg">{t('preferences.prefsSavedMsg', locale)}</span>}
          </div>
        </div>
      )}

      <footer className="page-footer">
        <a href={`/app/tour${userId ? `?user_id=${userId}` : ''}`}>{t('preferences.footer.tourLink', locale)}</a>
        <span className="footer-sep">·</span>
        <a href="/privacy" target="_blank" rel="noreferrer">{t('preferences.footer.privacyLink', locale)}</a>
        <span className="footer-sep">·</span>
        <a href="/unsubscribe" className="unsubscribe-link">{t('preferences.footer.unsubscribeLink', locale)}</a>
      </footer>

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
          margin: 0;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          max-width: 640px;
        }
        .tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-bottom: 1.8rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 1rem;
        }
        .tab-btn {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.9rem;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .tab-btn.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .field {
          margin-bottom: 1.8rem;
        }
        .field label {
          display: block;
          font-size: 0.9rem;
          margin-bottom: 0.7rem;
        }
        .options {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .option {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.9rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .option.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .offer-options {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .offer-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          align-items: flex-start;
        }
        .offer-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .offer-card.disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .offer-title {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .soon-badge {
          font-size: 0.66rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          background: rgba(240, 145, 78, 0.16);
          color: #f0914e;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
        }
        .status-pill {
          font-size: 0.66rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
        }
        .status-pill.on {
          background: rgba(52, 199, 89, 0.16);
          color: var(--accent-green, #34c759);
        }
        .status-pill.off {
          background: rgba(139, 144, 168, 0.16);
          color: var(--muted);
        }
        .offer-desc {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .offer-card > button {
          margin-top: 0.4rem;
        }
        .collab-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
        }
        .collab-card {
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.8rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .collab-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .collab-card.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .collab-title {
          font-weight: 600;
          font-size: 0.86rem;
          color: var(--text);
        }
        .collab-desc {
          font-size: 0.76rem;
          color: var(--muted);
          line-height: 1.35;
        }
        .collab-extra {
          margin-top: 0.9rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
        }
        .collab-extra-hint {
          font-size: 0.8rem;
          color: var(--muted);
          margin: 0 0 0.7rem;
          line-height: 1.4;
        }
        .sub-label {
          display: block;
          font-size: 0.8rem;
          color: var(--muted);
          margin: 0.6rem 0 0.35rem;
        }
        .upload-row {
          display: flex;
          gap: 0.6rem;
          align-items: center;
          flex-wrap: wrap;
        }
        select, textarea {
          width: 100%;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }
        .cap-input {
          width: 100%;
          max-width: 140px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }
        .usage-field {
          margin-top: 0.5rem;
        }
        .usage-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1rem;
        }
        .usage-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.86rem;
          margin-bottom: 0.5rem;
        }
        .usage-bars {
          display: flex;
          align-items: flex-end;
          gap: 0.4rem;
          height: 48px;
          margin: 0.8rem 0 0.4rem;
        }
        .usage-bar-wrap {
          flex: 1;
          height: 100%;
          display: flex;
          align-items: flex-end;
          background: var(--surface);
          border-radius: 3px;
          overflow: hidden;
        }
        .usage-bar {
          width: 100%;
          background: var(--accent);
          min-height: 2px;
        }
        .usage-hint {
          font-size: 0.74rem;
          color: var(--muted);
          margin: 0;
          line-height: 1.4;
        }
        .credits-field {
          margin-top: 1rem;
        }
        .credits-buy-row {
          display: flex;
          gap: 0.6rem;
          margin-top: 0.7rem;
          flex-wrap: wrap;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.8rem;
          margin-top: 0.5rem;
          overflow-wrap: break-word;
        }
        .crm-connect {
          margin-top: 0.9rem;
          padding-top: 0.9rem;
          border-top: 1px solid var(--border);
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          margin-top: 0.5rem;
        }
        .btn-primary, .btn-secondary {
          border-radius: var(--radius-sm);
          padding: 0.65rem 1.2rem;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          font-weight: 600;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        /* .link-btn : le bouton "Relancer le questionnaire de découverte" est un
           <Link> (donc un <a>), pas un <button> — sans ce reset il apparaît en
           lien bleu souligné au lieu de matcher les autres boutons .btn-secondary
           de cette même rangée d'actions. */
        .link-btn {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }
        .saved-msg {
          color: var(--accent-green);
          font-size: 0.84rem;
        }
        .page-footer {
          margin-top: 2rem;
          padding-top: 1.2rem;
          border-top: 1px solid var(--border);
        }
        .page-footer a {
          color: var(--muted);
          font-size: 0.78rem;
          text-decoration: underline;
        }
        .footer-sep {
          color: var(--muted);
          font-size: 0.78rem;
          margin: 0 0.4rem;
        }
        .unsubscribe-link {
          color: var(--accent-red);
        }
        .muted {
          color: var(--muted);
        }
        @media (max-width: 600px) {
          .collab-options {
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.preferences', locale), slug: 'preferences', icon: '⚙️' },
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
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title="Non inclus dans votre abonnement actuel">🔒</span>}</li>
            </Link>
          ))}
        </ul>
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
