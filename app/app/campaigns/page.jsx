// app/app/campaigns/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

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

const STATUS_COLORS = {
  en_attente: '#8B90A8',
  en_cours: '#4B9EF0',
  terminee: '#3DD68C',
  en_pause: '#F0914E',
};

function statusLabelsFor(locale) {
  return {
    en_attente: { label: t('campaigns.statusEnAttente', locale), color: STATUS_COLORS.en_attente },
    en_cours: { label: t('campaigns.statusEnCours', locale), color: STATUS_COLORS.en_cours },
    terminee: { label: t('campaigns.statusTerminee', locale), color: STATUS_COLORS.terminee },
    en_pause: { label: t('campaigns.statusEnPause', locale), color: STATUS_COLORS.en_pause },
  };
}

function zoneTypeOptionsFor(locale) {
  return [
    { key: 'ville', label: t('campaigns.zoneTypeCity', locale), icon: '🏙️', placeholder: t('campaigns.zoneTypeCityPlaceholder', locale), hint: t('campaigns.zoneTypeCityHint', locale) },
    { key: 'departement', label: t('campaigns.zoneTypeDepartment', locale), icon: '🗺️', placeholder: t('campaigns.zoneTypeDepartmentPlaceholder', locale), hint: t('campaigns.zoneTypeDepartmentHint', locale) },
    { key: 'region', label: t('campaigns.zoneTypeRegion', locale), icon: '🌍', placeholder: t('campaigns.zoneTypeRegionPlaceholder', locale), hint: t('campaigns.zoneTypeRegionHint', locale) },
  ];
}

// Doit rester synchronisé avec COMPANY_SIZE_LABELS dans lib/sourcing.ts —
// les clés stockées en base (company_sizes) sont ces mêmes clés courtes.
function companySizeOptionsFor(locale) {
  return [
    { key: 'artisan_tpe', label: t('campaigns.sizeArtisanTpe', locale), desc: t('campaigns.sizeArtisanTpeDesc', locale), icon: '🔨' },
    { key: 'pme', label: t('campaigns.sizePme', locale), desc: t('campaigns.sizePmeDesc', locale), icon: '🏢' },
    { key: 'eti', label: t('campaigns.sizeEti', locale), desc: t('campaigns.sizeEtiDesc', locale), icon: '🏭' },
    { key: 'grand_compte', label: t('campaigns.sizeGrandCompte', locale), desc: t('campaigns.sizeGrandCompteDesc', locale), icon: '🏛️' },
  ];
}

function quickSectorsFor(locale) {
  return [
    t('campaigns.sectorPlomberie', locale),
    t('campaigns.sectorChauffagiste', locale),
    t('campaigns.sectorElectricite', locale),
    t('campaigns.sectorBatiment', locale),
    t('campaigns.sectorRestauration', locale),
    t('campaigns.sectorCoiffure', locale),
    t('campaigns.sectorImmobilier', locale),
    t('campaigns.sectorComptabilite', locale),
  ];
}

export default function CampaignsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const STATUS_LABELS = statusLabelsFor(locale);
  const COMPANY_SIZE_OPTIONS = companySizeOptionsFor(locale);
  const ROLE_SUGGESTIONS = roleSuggestionsFor(locale);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [companyId, setCompanyId] = useState(null);
  const [globalAdvice, setGlobalAdvice] = useState(null); // { scope, loading, text, empty, error }
  const [generatingAdviceFor, setGeneratingAdviceFor] = useState(null);
  const [changingStatusFor, setChangingStatusFor] = useState(null);
  const [confirmEndId, setConfirmEndId] = useState(null);

  async function loadCampaigns() {
    setLoading(true);
    const res = await fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json());
    setCampaigns(res.campaigns || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadCampaigns();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
      });
  }, [userId]);

  // #14 — avis global (campagnes en cours ou bilan des campagnes passées).
  async function openGlobalAdvice(scope) {
    setGlobalAdvice({ scope, loading: true, text: null, empty: false, error: null });
    try {
      const res = await fetch('/api/campaigns/advice-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, scope }),
      });
      const body = await res.json();
      if (!res.ok) {
        setGlobalAdvice({ scope, loading: false, text: null, empty: false, error: body.error || t('campaigns.chatErrorRetry', locale) });
        return;
      }
      setGlobalAdvice({ scope, loading: false, text: body.advice, empty: !!body.empty, error: null });
    } catch {
      setGlobalAdvice({ scope, loading: false, text: null, empty: false, error: t('campaigns.chatErrorRetry', locale) });
    }
  }

  // #14 — avis d'Aaron par campagne (générer/régénérer, mis en cache côté serveur).
  async function generateAdvice(campaignId) {
    setGeneratingAdviceFor(campaignId);
    const res = await fetch(`/api/campaigns/${campaignId}/advice`, { method: 'POST' });
    const body = await res.json();
    setGeneratingAdviceFor(null);
    if (!res.ok) return;
    setCampaigns((prev) =>
      prev.map((c) => (c.id === campaignId ? { ...c, advice: body.advice, advice_generated_at: body.advice_generated_at } : c))
    );
  }

  // #16 — pause/reprise/fin manuelle d'une campagne.
  async function changeCampaignStatus(campaignId, action) {
    setChangingStatusFor(campaignId);
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setChangingStatusFor(null);
    setConfirmEndId(null);
    if (!res.ok) return;
    const body = await res.json();
    setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? { ...c, status: body.status } : c)));
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            color: var(--muted);
            font-family: 'Inter', sans-serif;
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
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            color: var(--accent-red);
            font-family: 'Inter', sans-serif;
            text-align: center;
            padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active={t('nav.campaigns', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('campaigns.eyebrow', locale)}</p>
          <h1>{t('campaigns.pageTitle', locale)}</h1>
        </div>
        <button className="btn-primary" onClick={() => setShowChat(true)}>
          + {t('campaigns.newCampaign', locale)}
        </button>
      </header>

      {!loading && campaigns.length > 0 && (
        <div className="global-advice-row">
          <button type="button" className="btn-ghost" onClick={() => openGlobalAdvice('ongoing')}>
            💡 {t('campaigns.globalAdviceOngoingBtn', locale)}
          </button>
          <button type="button" className="btn-ghost" onClick={() => openGlobalAdvice('past')}>
            📊 {t('campaigns.globalAdvicePastBtn', locale)}
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title={t('campaigns.emptyTitle', locale)} body={t('campaigns.emptyBody', locale)} />
      ) : (
        <div className="cards">
          {campaigns.map((c) => {
            const status = STATUS_LABELS[c.status] || STATUS_LABELS.en_attente;
            const progress = c.target_count > 0 ? Math.min(100, Math.round((c.contacts_found / c.target_count) * 100)) : 0;
            const isTerminee = c.status === 'terminee';
            return (
              <div className="card" key={c.id}>
                <div className="card-top">
                  <div>
                    <h3>{c.zone_label}</h3>
                    <p className="muted">{c.sector_keywords?.join(', ')}</p>
                    {c.company_sizes?.length > 0 && (
                      <p className="muted">
                        {c.company_sizes.map((k) => COMPANY_SIZE_OPTIONS.find((o) => o.key === k)?.label || k).join(', ')}
                        {c.target_role && ` · ${ROLE_SUGGESTIONS.find((r) => r.key === c.target_role)?.label || c.target_role}`}
                      </p>
                    )}
                    {c.context_notes && <p className="context-notes">💬 {c.context_notes}</p>}
                  </div>
                  <span className="status-pill" style={{ color: status.color, borderColor: status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="card-bottom">
                  <span>{c.contacts_found} / {c.target_count} {t('campaigns.contactsFoundSuffix', locale)}</span>
                  <span className="muted">{c.companies_found} {t('campaigns.companiesAnalyzedSuffix', locale)}</span>
                </div>
                {(c.stats?.won > 0 || c.stats?.lost > 0 || c.stats?.active > 0) && (
                  <div className="campaign-outcome">
                    <span className="outcome-won">🏆 {c.stats.won} {t('campaigns.outcomeWon', locale)}</span>
                    <span className="outcome-lost">❌ {c.stats.lost} {t('campaigns.outcomeLost', locale)}</span>
                    <span className="outcome-active muted">🎯 {c.stats.active} {t('campaigns.outcomeActive', locale)}</span>
                  </div>
                )}

                <div className="advice-box">
                  <p className="advice-label">🤖 {t('campaigns.adviceTitle', locale)}</p>
                  {c.advice ? (
                    <>
                      <p className="advice-text">{c.advice}</p>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={generatingAdviceFor === c.id}
                        onClick={() => generateAdvice(c.id)}
                      >
                        {generatingAdviceFor === c.id ? t('campaigns.adviceGenerating', locale) : t('campaigns.adviceRegenerate', locale)}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={generatingAdviceFor === c.id}
                      onClick={() => generateAdvice(c.id)}
                    >
                      {generatingAdviceFor === c.id ? t('campaigns.adviceGenerating', locale) : t('campaigns.adviceGenerate', locale)}
                    </button>
                  )}
                </div>

                {!isTerminee && (
                  <div className="status-actions">
                    {c.status === 'en_pause' ? (
                      <button
                        type="button"
                        className="status-btn"
                        disabled={changingStatusFor === c.id}
                        onClick={() => changeCampaignStatus(c.id, 'reprendre')}
                      >
                        ▶ {t('campaigns.resumeCampaign', locale)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="status-btn"
                        disabled={changingStatusFor === c.id}
                        onClick={() => changeCampaignStatus(c.id, 'pause')}
                      >
                        ⏸ {t('campaigns.pauseCampaign', locale)}
                      </button>
                    )}
                    <button type="button" className="status-btn danger" onClick={() => setConfirmEndId(c.id)}>
                      ⏹ {t('campaigns.endCampaign', locale)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {globalAdvice && (
        <div className="overlay" onClick={() => setGlobalAdvice(null)}>
          <div className="advice-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close-btn" onClick={() => setGlobalAdvice(null)}>✕</button>
            <h2>{globalAdvice.scope === 'ongoing' ? t('campaigns.globalAdviceOngoingTitle', locale) : t('campaigns.globalAdvicePastTitle', locale)}</h2>
            {globalAdvice.loading ? (
              <p className="muted">{t('campaigns.adviceGenerating', locale)}</p>
            ) : globalAdvice.error ? (
              <p className="error">{globalAdvice.error}</p>
            ) : globalAdvice.empty ? (
              <p className="muted">
                {globalAdvice.scope === 'ongoing' ? t('campaigns.globalAdviceEmptyOngoing', locale) : t('campaigns.globalAdviceEmptyPast', locale)}
              </p>
            ) : (
              <p className="advice-modal-text">{globalAdvice.text}</p>
            )}
          </div>
        </div>
      )}

      {confirmEndId && (
        <div className="overlay" onClick={() => setConfirmEndId(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('campaigns.endCampaignConfirmTitle', locale)}</h2>
            <p>{t('campaigns.endCampaignConfirmBody', locale)}</p>
            <div className="confirm-actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmEndId(null)}>
                {t('common.cancel', locale)}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={changingStatusFor === confirmEndId}
                onClick={() => changeCampaignStatus(confirmEndId, 'terminer')}
              >
                {t('common.confirm', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {showChat && (
        <ChatCampaignModal
          userId={userId}
          companyId={companyId}
          onClose={() => setShowChat(false)}
          onSwitchToForm={() => {
            setShowChat(false);
            setShowForm(true);
          }}
          onCreated={() => {
            setShowChat(false);
            loadCampaigns();
          }}
        />
      )}

      {showForm && (
        <NewCampaignModal
          userId={userId}
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            loadCampaigns();
          }}
        />
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.5rem;
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
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.7rem 1.1rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.2rem;
        }
        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }
        .card-top h3 {
          margin: 0 0 0.2rem;
          font-family: var(--font-display);
          font-size: 1.05rem;
        }
        .status-pill {
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.6rem;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .progress-track {
          height: 6px;
          background: var(--border);
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 0.6rem;
        }
        .progress-fill {
          height: 100%;
          background: var(--accent);
          border-radius: 999px;
        }
        .card-bottom {
          display: flex;
          justify-content: space-between;
          font-size: 0.78rem;
        }
        .context-notes {
          font-size: 0.78rem;
          color: var(--muted);
          margin: 0.4rem 0 0;
          line-height: 1.35;
        }
        .muted {
          color: var(--muted);
        }
        .campaign-outcome {
          display: flex;
          gap: 0.7rem;
          flex-wrap: wrap;
          margin-top: 0.6rem;
          padding-top: 0.6rem;
          border-top: 1px solid var(--border);
          font-size: 0.76rem;
        }
        .outcome-won {
          color: var(--accent-green);
        }
        .outcome-lost {
          color: var(--accent-red);
        }
        .global-advice-row {
          display: flex;
          gap: 0.6rem;
          margin-bottom: 1.2rem;
          flex-wrap: wrap;
        }
        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.45rem 0.9rem;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .btn-ghost:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .advice-box {
          margin-top: 0.7rem;
          padding-top: 0.7rem;
          border-top: 1px solid var(--border);
        }
        .advice-label {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.35rem;
        }
        .advice-text {
          font-size: 0.82rem;
          line-height: 1.45;
          color: var(--text);
          margin: 0 0 0.4rem;
        }
        .link-btn {
          background: transparent;
          border: none;
          color: var(--accent);
          font-size: 0.76rem;
          padding: 0;
          cursor: pointer;
          text-decoration: underline;
        }
        .link-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .status-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border);
        }
        .status-btn {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.7rem;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .status-btn:hover {
          border-color: var(--accent);
        }
        .status-btn.danger {
          color: var(--accent-red);
        }
        .status-btn.danger:hover {
          border-color: var(--accent-red);
        }
        .status-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
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
        .advice-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
          width: 520px;
          max-width: 100%;
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
        }
        .advice-modal h2 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0 0 0.8rem;
          padding-right: 1.5rem;
        }
        .advice-modal .close-btn {
          position: absolute;
          top: 1rem;
          right: 1.2rem;
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .advice-modal-text {
          font-size: 0.88rem;
          line-height: 1.55;
          color: var(--text);
          white-space: pre-line;
        }
        .confirm-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
          width: 420px;
          max-width: 100%;
        }
        .confirm-modal h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.6rem;
        }
        .confirm-modal p {
          font-size: 0.86rem;
          color: var(--muted);
          line-height: 1.45;
          margin: 0 0 1rem;
        }
        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .btn-danger {
          background: var(--accent-red);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </Shell>
  );
}

function zoneSuggestionsFor(locale) {
  return [
    { flag: '🇫🇷', label: t('campaigns.zoneCountryFrance', locale) },
    { flag: '🇧🇪', label: t('campaigns.zoneCountryBelgium', locale) },
    { flag: '🇨🇭', label: t('campaigns.zoneCountrySwitzerland', locale) },
    { flag: '🇩🇪', label: t('campaigns.zoneCountryGermany', locale) },
    { flag: '🇬🇧', label: t('campaigns.zoneCountryUk', locale) },
    { flag: '🇪🇸', label: t('campaigns.zoneCountrySpain', locale) },
    { flag: '🇺🇸', label: t('campaigns.zoneCountryUs', locale) },
    { flag: '🌍', label: t('campaigns.zoneCountryOther', locale) },
  ];
}

// Doit rester synchronisé avec TARGET_ROLE_LABELS dans lib/sourcing.ts — la clé
// "peu_importe" n'est volontairement pas une valeur JSON (elle insère juste du
// texte libre : Aaron comprend qu'aucun rôle précis n'est demandé).
function roleSuggestionsFor(locale) {
  return [
    { key: 'fondateur_dirigeant', label: t('campaigns.roleFondateur', locale) },
    { key: 'responsable_commercial', label: t('campaigns.roleCommercial', locale) },
    { key: 'responsable_achats', label: t('campaigns.roleAchats', locale) },
    { key: 'rh', label: t('campaigns.roleRh', locale) },
    { key: 'peu_importe', label: t('campaigns.rolePeuImporte', locale) },
  ];
}

function communicationSuggestionsFor(locale) {
  return [
    t('campaigns.commDirect', locale),
    t('campaigns.commFactual', locale),
    t('campaigns.commWarm', locale),
    t('campaigns.commReassurance', locale),
  ];
}

function objectiveSuggestionsFor(locale) {
  const unit = t('campaigns.contactsUnit', locale);
  return [10, 20, 50, 100].map((n) => `${n} ${unit}`);
}

// Extrait la ligne cachée <!--topic:XXX--> (voir system prompt côté API) qui
// indique le sujet de la question en cours, pour afficher les bonnes chips.
function extractTopic(text) {
  const match = text.match(/<!--topic:(\w+)-->/);
  return match ? match[1] : null;
}

function extractCampaignJson(text) {
  const withoutTopic = text.replace(/<!--topic:\w+-->/, '').trim();
  const topic = extractTopic(text);
  const match = withoutTopic.match(/```campaign_json\s*([\s\S]*?)```/);
  if (!match) return { displayText: withoutTopic, recap: null, topic };
  const displayText = withoutTopic.slice(0, match.index).trim();
  try {
    const recap = JSON.parse(match[1].trim());
    return { displayText, recap, topic: null };
  } catch {
    return { displayText, recap: null, topic };
  }
}

function ChatCampaignModal({ userId, companyId, onClose, onSwitchToForm, onCreated }) {
  const [locale] = useLocale();
  const COMPANY_SIZE_OPTIONS = companySizeOptionsFor(locale);
  const ROLE_SUGGESTIONS = roleSuggestionsFor(locale);
  const ZONE_SUGGESTIONS = zoneSuggestionsFor(locale);
  const COMMUNICATION_SUGGESTIONS = communicationSuggestionsFor(locale);
  const OBJECTIVE_SUGGESTIONS = objectiveSuggestionsFor(locale);
  const QUICK_SECTORS = quickSectorsFor(locale);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      topic: 'secteur',
      content:
        t('campaigns.chatWelcome1', locale) + '\n\n' +
        t('campaigns.chatWelcome2', locale),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState(null);
  const [launching, setLaunching] = useState(false);

  async function sendMessage(text) {
    if (!text.trim() || sending) return;
    const history = messages;
    const userMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);
    setError(null);

    const res = await fetch('/api/campaigns/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, message: text, history }),
    });
    const body = await res.json();
    setSending(false);

    if (!res.ok) {
      setError(body.error || t('campaigns.chatErrorRetry', locale));
      return;
    }

    const { displayText, recap: newRecap, topic } = extractCampaignJson(body.reply);
    setMessages((prev) => [...prev, { role: 'assistant', content: displayText, topic }]);
    setRecap(newRecap);
  }

  function handleSend(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function addChip(text) {
    setInput((prev) => (prev.trim() ? `${prev.trim()}, ${text}` : text));
  }

  // Sujet de la dernière question posée par Aaron — détermine les suggestions
  // cliquables affichées (voir le marqueur <!--topic:...--> côté system prompt).
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
  const currentTopic = recap ? null : lastAssistantMessage?.topic || null;

  async function handleLaunch() {
    if (!recap) return;
    setLaunching(true);
    setError(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        assigned_user_id: userId,
        zone_label: recap.zone_label || t('campaigns.zoneUnspecified', locale),
        zone_type: 'zone',
        zone_codes: [recap.zone_label || t('campaigns.zoneUnspecified', locale)],
        sector_keywords: Array.isArray(recap.sector_keywords) && recap.sector_keywords.length ? recap.sector_keywords : [t('campaigns.allSectorsFallback', locale)],
        company_sizes: Array.isArray(recap.company_sizes) ? recap.company_sizes : [],
        target_count: Number(recap.target_count) || 20,
        context_notes: recap.context_notes || null,
        target_role: recap.target_role || null,
      }),
    });
    setLaunching(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || t('campaigns.createError', locale));
      return;
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <h2>{t('campaigns.chatModalTitle', locale)}</h2>
          <button type="button" className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content.split('\n').map((line, j) => <p key={j}>{line}</p>)}
            </div>
          ))}
          {sending && <div className="bubble assistant"><p className="typing">{t('campaigns.aaronThinking', locale)}</p></div>}
        </div>

        {currentTopic === 'secteur' && (
          <div className="chip-row">
            {QUICK_SECTORS.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => addChip(s)}>+ {s}</button>
            ))}
          </div>
        )}

        {currentTopic === 'zone' && (
          <div className="chip-row">
            {ZONE_SUGGESTIONS.map((z) => (
              <button type="button" key={z.label} className="chip" onClick={() => addChip(z.label)}>
                {z.flag} {z.label}
              </button>
            ))}
          </div>
        )}

        {currentTopic === 'taille' && (
          <div className="chip-row">
            {COMPANY_SIZE_OPTIONS.map((o) => (
              <button type="button" key={o.key} className="chip" onClick={() => addChip(o.label)}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        )}

        {currentTopic === 'role' && (
          <div className="chip-row">
            {ROLE_SUGGESTIONS.map((r) => (
              <button type="button" key={r.key} className="chip" onClick={() => addChip(r.label)}>{r.label}</button>
            ))}
          </div>
        )}

        {currentTopic === 'communication' && (
          <div className="chip-row">
            {COMMUNICATION_SUGGESTIONS.map((c) => (
              <button type="button" key={c} className="chip" onClick={() => addChip(c)}>{c}</button>
            ))}
          </div>
        )}

        {currentTopic === 'objectif' && (
          <div className="chip-row">
            {OBJECTIVE_SUGGESTIONS.map((o) => (
              <button type="button" key={o} className="chip" onClick={() => addChip(o)}>{o}</button>
            ))}
          </div>
        )}

        {recap && (
          <div className="recap-box">
            <p className="recap-title">{t('campaigns.recapTitleChat', locale)}</p>
            <p><strong>{t('campaigns.recapZone', locale)}</strong> {recap.zone_label || '—'}</p>
            <p><strong>{t('campaigns.recapSectors', locale)}</strong> {(recap.sector_keywords || []).join(', ') || '—'}</p>
            <p><strong>{t('campaigns.recapSizes', locale)}</strong> {(recap.company_sizes || []).length ? recap.company_sizes.map((k) => COMPANY_SIZE_OPTIONS.find((o) => o.key === k)?.label || k).join(', ') : t('campaigns.allSizes', locale)}</p>
            <p><strong>{t('campaigns.recapTarget', locale)}</strong> {recap.target_role ? (ROLE_SUGGESTIONS.find((r) => r.key === recap.target_role)?.label || recap.target_role) : t('campaigns.rolePeuImporte', locale)}</p>
            <p><strong>{t('campaigns.recapObjective', locale)}</strong> {recap.target_count || 20} {t('campaigns.contactsUnit', locale)}</p>
            <p className="recap-hint">{t('campaigns.targetCountHint', locale)}</p>
            {recap.context_notes && <p><strong>{t('campaigns.recapNotes', locale)}</strong> {recap.context_notes}</p>}
            <p className="recap-hint">{t('campaigns.recapHint', locale)}</p>
            <button type="button" className="btn-primary" onClick={handleLaunch} disabled={launching}>
              {launching ? t('campaigns.launching', locale) : t('campaigns.launchCampaign', locale)}
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <form className="chat-input-row" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('campaigns.chatInputPlaceholder', locale)}
            disabled={sending}
          />
          <button type="submit" className="btn-secondary" disabled={sending || !input.trim()}>{t('campaigns.send', locale)}</button>
        </form>

        <p className="switch-link" onClick={onSwitchToForm}>{t('campaigns.switchToFormLink', locale)}</p>
      </div>

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
        .chat-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
          width: 560px;
          max-width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.8rem;
        }
        .chat-header h2 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0;
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .chat-messages {
          overflow-y: auto;
          flex: 1;
          min-height: 200px;
          max-height: 40vh;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          margin-bottom: 0.8rem;
        }
        .bubble {
          border-radius: var(--radius-md);
          padding: 0.6rem 0.85rem;
          font-size: 0.86rem;
          line-height: 1.45;
          max-width: 88%;
          overflow-wrap: break-word;
        }
        .bubble p {
          margin: 0;
        }
        .bubble p + p {
          margin-top: 0.4rem;
        }
        .bubble.assistant {
          background: var(--bg);
          border: 1px solid var(--border);
          align-self: flex-start;
        }
        .bubble.user {
          background: rgba(75, 57, 239, 0.18);
          align-self: flex-end;
        }
        .typing {
          color: var(--muted);
          font-style: italic;
        }
        .chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-bottom: 0.8rem;
        }
        .chip {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.35rem 0.7rem;
          font-size: 0.78rem;
          color: var(--muted);
          cursor: pointer;
        }
        .chip:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .recap-box {
          background: var(--bg);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
          margin-bottom: 0.8rem;
          font-size: 0.84rem;
        }
        .recap-title {
          font-weight: 600;
          margin: 0 0 0.5rem;
          font-size: 0.76rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--accent);
        }
        .recap-box p {
          margin: 0.25rem 0;
          color: var(--text);
        }
        .recap-hint {
          color: var(--muted) !important;
          font-size: 0.78rem;
          margin: 0.5rem 0 0.7rem !important;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0 0 0.6rem;
        }
        .chat-input-row {
          display: flex;
          gap: 0.5rem;
        }
        .chat-input-row input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.88rem;
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
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .switch-link {
          text-align: center;
          font-size: 0.76rem;
          color: var(--muted);
          text-decoration: underline;
          cursor: pointer;
          margin: 0.8rem 0 0;
        }
      `}</style>
    </div>
  );
}

function wizardStepsFor(locale) {
  return [
    t('campaigns.stepZone', locale),
    t('campaigns.stepSize', locale),
    t('campaigns.stepSector', locale),
    t('campaigns.stepTargeting', locale),
    t('campaigns.stepObjective', locale),
  ];
}

function NewCampaignModal({ userId, companyId, onClose, onCreated }) {
  const [locale] = useLocale();
  const WIZARD_STEPS = wizardStepsFor(locale);
  const ZONE_SUGGESTIONS = zoneSuggestionsFor(locale);
  const COMPANY_SIZE_OPTIONS = companySizeOptionsFor(locale);
  const QUICK_SECTORS = quickSectorsFor(locale);
  const ROLE_SUGGESTIONS = roleSuggestionsFor(locale);
  const COMMUNICATION_SUGGESTIONS = communicationSuggestionsFor(locale);
  const [step, setStep] = useState(0);
  // docx #17 : la zone était auparavant scindée en un "type" (ville/département/
  // région — des notions propres à la France) + des codes, alors que zone_type
  // et zone_codes ne sont en réalité JAMAIS lus par le moteur de sourcing
  // (lib/sourcing.ts ne se base que sur zone_label) — uniquement stockés sans
  // jamais être réaffichés nulle part. Simplifié en un seul champ texte libre,
  // exactement comme le fait déjà le formulaire en conversation avec Aaron
  // (qui gère nativement n'importe quelle zone dans le monde) — pour une vraie
  // parité entre les deux formulaires plutôt qu'un formulaire classique limité
  // à la France.
  const [zoneLabel, setZoneLabel] = useState('');
  const [companySizes, setCompanySizes] = useState([]);
  const [sectors, setSectors] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [contextNotes, setContextNotes] = useState('');
  const [targetCount, setTargetCount] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isLastStep = step === WIZARD_STEPS.length - 1;
  const canGoNext =
    (step === 0 && zoneLabel.trim()) ||
    step === 1 ||
    (step === 2 && sectors.trim()) ||
    step === 3 ||
    (step === 4 && Number(targetCount) > 0);

  function toggleCompanySize(key) {
    setCompanySizes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function addZoneSuggestion(label) {
    setZoneLabel((prev) => (prev.trim() ? `${prev.trim()}, ${label}` : label));
  }

  function addQuickSector(sector) {
    const current = sectors.split(',').map((s) => s.trim()).filter(Boolean);
    if (current.some((s) => s.toLowerCase() === sector.toLowerCase())) return;
    setSectors(current.length ? `${sectors}, ${sector}` : sector);
  }

  function addContextChip(text) {
    setContextNotes((prev) => (prev.trim() ? `${prev.trim()}, ${text}` : text));
  }

  function handleNext() {
    if (!canGoNext) return;
    setError(null);
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }

  function handleBack() {
    if (step === 0) {
      onClose();
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isLastStep && !canGoNext) return;
    if (!isLastStep) {
      handleNext();
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        assigned_user_id: userId,
        zone_label: zoneLabel,
        // zone_type/zone_codes ne sont plus utilisés que pour satisfaire le
        // schéma existant (voir commentaire sur zoneLabel plus haut) — même
        // valeur fixe que le formulaire en conversation avec Aaron.
        zone_type: 'zone',
        zone_codes: [zoneLabel],
        sector_keywords: sectors.split(',').map((s) => s.trim()).filter(Boolean),
        company_sizes: companySizes,
        target_role: targetRole || null,
        context_notes: contextNotes.trim() || null,
        target_count: Number(targetCount),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || t('campaigns.createError', locale));
      return;
    }
    onCreated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t('campaigns.wizardModalTitle', locale)}</h2>

        <div className="steps-track">
          {WIZARD_STEPS.map((label, i) => (
            <div key={label} className={`step-dot-wrap${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
              <span className="step-dot">{i < step ? '✓' : i + 1}</span>
              <span className="step-label">{label}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="step-body">
            <p className="step-title">{t('campaigns.stepZoneTitle', locale)}</p>
            <p className="step-subtitle">{t('campaigns.zoneNameHint', locale)}</p>

            <label>
              {t('campaigns.zoneNameLabel', locale)}
              <input
                value={zoneLabel}
                onChange={(e) => setZoneLabel(e.target.value)}
                placeholder={t('campaigns.zoneNamePlaceholder', locale)}
                required
              />
            </label>

            <div className="quick-chips">
              {ZONE_SUGGESTIONS.map((z) => (
                <button type="button" key={z.label} className="chip" onClick={() => addZoneSuggestion(z.label)}>
                  {z.flag} {z.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="step-body">
            <p className="step-title">{t('campaigns.stepSizeTitle', locale)}</p>
            <p className="step-subtitle">{t('campaigns.stepSizeSubtitle', locale)}</p>
            <div className="size-grid">
              {COMPANY_SIZE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  className={`size-btn${companySizes.includes(opt.key) ? ' active' : ''}`}
                  onClick={() => toggleCompanySize(opt.key)}
                >
                  <span className="size-icon">{opt.icon}</span>
                  <span className="size-label">{opt.label}</span>
                  <span className="size-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="step-body">
            <p className="step-title">{t('campaigns.stepSectorTitle', locale)}</p>
            <label>
              {t('campaigns.sectorsLabel', locale)}
              <input
                value={sectors}
                onChange={(e) => setSectors(e.target.value)}
                placeholder={t('campaigns.sectorsPlaceholder', locale)}
                required
              />
            </label>
            <div className="quick-chips">
              {QUICK_SECTORS.map((s) => (
                <button type="button" key={s} className="chip" onClick={() => addQuickSector(s)}>
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="step-body">
            <p className="step-title">{t('campaigns.stepTargetingTitle', locale)}</p>
            <label>{t('campaigns.targetRoleLabel', locale)}</label>
            <div className="role-grid">
              {ROLE_SUGGESTIONS.map((r) => (
                <button
                  type="button"
                  key={r.key}
                  className={`role-btn${targetRole === r.key ? ' active' : ''}`}
                  onClick={() => setTargetRole((prev) => (prev === r.key ? '' : r.key))}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <label>
              {t('campaigns.contextNotesLabel', locale)}
              <input
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder={t('campaigns.contextNotesPlaceholder', locale)}
              />
            </label>
            <div className="quick-chips">
              {COMMUNICATION_SUGGESTIONS.map((c) => (
                <button type="button" key={c} className="chip" onClick={() => addContextChip(c)}>
                  + {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="step-body">
            <p className="step-title">{t('campaigns.stepObjectiveTitle', locale)}</p>
            <label>
              {t('campaigns.targetCountLabel', locale)}
              <input
                type="number"
                min="1"
                value={targetCount}
                onChange={(e) => setTargetCount(e.target.value)}
              />
            </label>
            <p className="hint">{t('campaigns.targetCountHint', locale)}</p>

            <div className="recap">
              <p className="recap-title">{t('campaigns.recapTitle', locale)}</p>
              <p><strong>{t('campaigns.recapZone', locale)}</strong> {zoneLabel || '—'}</p>
              <p><strong>{t('campaigns.recapSizes', locale)}</strong> {companySizes.length ? companySizes.map((k) => COMPANY_SIZE_OPTIONS.find((o) => o.key === k)?.label).join(', ') : t('campaigns.allSizes', locale)}</p>
              <p><strong>{t('campaigns.recapSectors', locale)}</strong> {sectors || '—'}</p>
              <p><strong>{t('campaigns.recapTarget', locale)}</strong> {targetRole ? (ROLE_SUGGESTIONS.find((r) => r.key === targetRole)?.label || targetRole) : t('campaigns.rolePeuImporte', locale)}</p>
              {contextNotes.trim() && <p><strong>{t('campaigns.recapNotes', locale)}</strong> {contextNotes}</p>}
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={handleBack}>
            {step === 0 ? t('common.cancel', locale) : `← ${t('common.back', locale)}`}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !canGoNext}>
            {submitting ? t('campaigns.creating', locale) : isLastStep ? t('campaigns.launchCampaign', locale) : `${t('campaigns.next', locale)} →`}
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
          width: 480px;
          max-width: 100%;
          max-height: 90vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          margin: 0 0 1.2rem;
        }
        .steps-track {
          display: flex;
          justify-content: space-between;
          margin-bottom: 1.6rem;
        }
        .step-dot-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          flex: 1;
          position: relative;
        }
        .step-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.74rem;
          font-weight: 600;
        }
        .step-dot-wrap.active .step-dot {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }
        .step-dot-wrap.done .step-dot {
          background: var(--accent-green);
          border-color: var(--accent-green);
          color: #0b0e1a;
        }
        .step-label {
          font-size: 0.62rem;
          color: var(--muted);
          text-align: center;
          line-height: 1.2;
        }
        .step-dot-wrap.active .step-label {
          color: var(--text);
        }
        .step-body {
          min-height: 180px;
        }
        .step-title {
          font-weight: 600;
          font-size: 0.96rem;
          margin: 0 0 0.3rem;
        }
        .step-subtitle {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0 0 1rem;
        }
        .zone-type-picker {
          display: flex;
          gap: 0.6rem;
          margin-bottom: 1.1rem;
        }
        .zone-type-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .zone-type-btn.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.12);
        }
        .zone-icon {
          font-size: 1.2rem;
        }
        .size-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.6rem;
        }
        .size-btn {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.15rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.8rem;
          cursor: pointer;
          text-align: left;
          transition: border-color var(--fast), background var(--fast), transform var(--fast), box-shadow var(--fast);
        }
        .size-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .size-btn.active {
          border-color: var(--accent);
          background: rgba(75, 57, 239, 0.12);
        }
        .size-icon {
          font-size: 1.1rem;
        }
        .size-label {
          color: var(--text);
          font-weight: 600;
          font-size: 0.84rem;
        }
        .size-desc {
          color: var(--muted);
          font-size: 0.72rem;
        }
        .quick-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-top: 0.8rem;
        }
        .chip {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          color: var(--muted);
          cursor: pointer;
        }
        .chip:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .role-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1.1rem;
        }
        .role-btn {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.5rem 0.9rem;
          color: var(--muted);
          font-size: 0.8rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .role-btn.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.12);
        }
        .hint {
          color: var(--muted);
          font-size: 0.76rem;
          line-height: 1.4;
          margin: -0.4rem 0 0.8rem;
        }
        .recap {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem 1rem;
          margin-top: 1rem;
          font-size: 0.82rem;
        }
        .recap-title {
          font-weight: 600;
          margin: 0 0 0.5rem;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--accent);
        }
        .recap p {
          margin: 0.25rem 0;
          color: var(--text);
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 1rem;
        }
        input, select {
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
          justify-content: space-between;
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
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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

function EmptyState({ title, body }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: 4rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
        }
        .empty-title {
          font-weight: 600;
          margin: 0 0 0.35rem;
        }
        .empty-body {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0;
        }
      `}</style>
    </div>
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
        aria-label={t('shell.openMenu', locale)}
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
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}>🔒</span>}</li>
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
