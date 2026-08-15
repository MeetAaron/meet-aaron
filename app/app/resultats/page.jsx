// app/app/resultats/page.jsx
// CHANGEMENTS A FAIRE #88 : page renommée "Mes résultats", les sections
// "Détail par campagne" et "Clients gagnés" (avec leur export CSV/email)
// sont supprimées, la page est restructurée en 3 catégories (Prospects /
// Opportunités / Clients) avec des stats complètes, et un sélecteur de
// période (7j / 30j / 3 mois / depuis toujours) filtre l'ensemble des
// chiffres affichés.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
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

// Sélecteur de période (#88) — 4 fenêtres possibles, 'all' par défaut pour
// ne rien changer au comportement précédent (qui montrait toujours l'ensemble
// de l'historique) tant que le commercial n'a pas explicitement resserré.
const PERIODS = ['7d', '30d', '3m', 'all'];
const PERIOD_KEYS = { '7d': 'results.period7d', '30d': 'results.period30d', '3m': 'results.period3m', all: 'results.periodAll' };

function periodStartFor(period) {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function withinPeriod(dateValue, periodStart) {
  if (!periodStart) return true;
  if (!dateValue) return false;
  return new Date(dateValue) >= periodStart;
}

const TYPE_ICONS = { telephonique: '📞', physique: '🤝', visio: '💻' };

// Catégorie "Opportunités" — mêmes codes couleur/logique que le tableau de
// bord (voir opportunityBucketFor/OPPORTUNITY_BUCKET_COLORS dans
// app/app/dashboard/page.jsx), dupliqués ici par convention (chaque page
// garde ses propres helpers, voir Agenda/#86 pour le même choix).
const STALE_DEAL_DAYS = 5;

const OPPORTUNITY_BUCKET_COLORS = {
  signe: '#4B9EF0',
  bonneVoie: '#3DD68C',
  enCours: '#8B90A8',
  risque: '#F0914E',
  perdu: '#E5484D',
};

function opportunityBucketMetaFor(locale) {
  return {
    signe: { label: t('dash.devisSigne', locale), color: OPPORTUNITY_BUCKET_COLORS.signe },
    bonneVoie: { label: t('status.vert', locale), color: OPPORTUNITY_BUCKET_COLORS.bonneVoie },
    enCours: { label: t('status.jaune', locale), color: OPPORTUNITY_BUCKET_COLORS.enCours },
    risque: { label: t('status.orange', locale), color: OPPORTUNITY_BUCKET_COLORS.risque },
    perdu: { label: t('status.rouge', locale), color: OPPORTUNITY_BUCKET_COLORS.perdu },
  };
}

function opportunityBucketFor(deal) {
  if (deal.deal_stage === 'perdu') return 'perdu';
  if (deal.deal_stage === 'signe') return 'signe';
  const days = deal.deal_stage_updated_at
    ? (Date.now() - new Date(deal.deal_stage_updated_at).getTime()) / (24 * 60 * 60 * 1000)
    : null;
  if (days !== null && days >= STALE_DEAL_DAYS) return 'risque';
  if (deal.deal_stage === 'en_negociation') return 'bonneVoie';
  return 'enCours';
}

// Catégorie "Clients" — même logique que le tableau de bord, basée sur le
// score de santé client déjà calculé pour Aaron Customer.
const HEALTH_BUCKET_COLORS = {
  saine: '#3DD68C',
  non_evalue: '#8B90A8',
  a_surveiller: '#F0C94E',
  a_risque: '#E5484D',
};

function healthBucketMetaFor(locale) {
  return {
    saine: { label: t('customer.healthGood', locale), color: HEALTH_BUCKET_COLORS.saine },
    non_evalue: { label: t('dash.healthUnknown', locale), color: HEALTH_BUCKET_COLORS.non_evalue },
    a_surveiller: { label: t('customer.healthWatch', locale), color: HEALTH_BUCKET_COLORS.a_surveiller },
    a_risque: { label: t('customer.healthAtRisk', locale), color: HEALTH_BUCKET_COLORS.a_risque },
  };
}

function healthBucketFor(customer) {
  return customer.customer_health_label || 'non_evalue';
}

export default function ResultatsPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [prospects, setProspects] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [deals, setDeals] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [replyRate, setReplyRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    const periodStart = periodStartFor(period);
    const sinceParam = periodStart ? `&since=${encodeURIComponent(periodStart.toISOString())}` : '';
    Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/reply-rate?user_id=${userId}${sinceParam}`).then((r) => r.json()),
    ]).then(([pRes, aRes, cRes, dRes, cuRes, rRes]) => {
      setProspects(pRes.prospects || []);
      setAppointments(aRes.appointments || []);
      setCampaigns(cRes.campaigns || []);
      setDeals(dRes.deals || []);
      setCustomers(cuRes.customers || []);
      setReplyRate(rRes.reply_rate ?? null);
      setLoading(false);
    });
  }, [userId, period]);

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif;
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
            background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  const TYPE_LABELS = {
    telephonique: t('results.typePhone', locale),
    physique: t('results.typeInPerson', locale),
    visio: t('results.typeVideo', locale),
  };

  const OPPORTUNITY_META = opportunityBucketMetaFor(locale);
  const HEALTH_META = healthBucketMetaFor(locale);
  const periodStart = periodStartFor(period);

  // Catégorie Prospects — prospects contactés pendant la période (via leur
  // date de création, avec repli sur la dernière mise à jour si l'historique
  // ne connaît pas encore la vraie date de création) et RDV associés,
  // filtrés par la date proposée du RDV.
  const prospectsInPeriod = prospects.filter((p) => withinPeriod(p.created_at || p.updated_at, periodStart));
  const appointmentsInPeriod = appointments.filter((a) => withinPeriod(a.proposed_at, periodStart));
  const totalProspects = prospectsInPeriod.length;
  const rdvConfirmes = appointmentsInPeriod.filter((a) => a.status === 'validé' || a.status === 'terminé');
  const rdvObtenus = rdvConfirmes.length;
  const rdvEnAttente = appointmentsInPeriod.filter((a) => a.status === 'proposé').length;
  const tauxRdv = totalProspects > 0 ? Math.round((rdvObtenus / totalProspects) * 100) : 0;
  const rdvParType = Object.keys(TYPE_LABELS).map((type) => ({
    type,
    label: TYPE_LABELS[type],
    count: rdvConfirmes.filter((a) => a.type === type).length,
  }));

  const campaignsInPeriod = campaigns.filter((c) => withinPeriod(c.created_at, periodStart));
  const contactsSources = campaignsInPeriod.reduce((sum, c) => sum + (c.contacts_found || 0), 0);
  const entreprisesAnalysees = campaignsInPeriod.reduce((sum, c) => sum + (c.companies_found || 0), 0);
  const tauxContact = entreprisesAnalysees > 0 ? Math.round((contactsSources / entreprisesAnalysees) * 100) : 0;

  // Catégorie Opportunités — filtrée sur la date de dernière mise à jour
  // d'étape, pour ne compter que les affaires ayant bougé sur la période.
  const dealsInPeriod = deals.filter((d) => withinPeriod(d.deal_stage_updated_at, periodStart));
  const opportunityCounts = Object.keys(OPPORTUNITY_META).reduce((acc, key) => {
    acc[key] = dealsInPeriod.filter((d) => opportunityBucketFor(d) === key).length;
    return acc;
  }, {});

  // Catégorie Clients — filtrée sur la date de gain (won_at), pour ne
  // compter que les clients gagnés sur la période, répartis par santé
  // actuelle.
  const customersInPeriod = customers.filter((c) => withinPeriod(c.won_at, periodStart));
  const healthCounts = Object.keys(HEALTH_META).reduce((acc, key) => {
    acc[key] = customersInPeriod.filter((c) => healthBucketFor(c) === key).length;
    return acc;
  }, {});

  return (
    <Shell active={t('nav.results', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('results.eyebrow', locale)}</p>
        <h1>{t('results.title', locale)}</h1>
      </header>

      <div className="period-picker">
        <span className="period-label">{t('results.periodLabel', locale)}</span>
        <div className="period-buttons">
          {PERIODS.map((p) => (
            <button
              key={p}
              className={`period-btn${period === p ? ' active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {t(PERIOD_KEYS[p], locale)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          <section className="panel category-panel">
            <h2>{t('results.categoryProspects', locale)}</h2>
            <div className="stat-grid">
              <StatCard label={t('results.statContactedProspects', locale)} value={totalProspects} />
              <StatCard
                label={t('results.statAppointmentsWon', locale)}
                value={rdvObtenus}
                accent
                hint={rdvObtenus > 0 ? rdvParType.filter((x) => x.count > 0).map((x) => `${TYPE_ICONS[x.type]} ${x.count} ${x.label.toLowerCase()}`).join(' · ') : undefined}
              />
              <StatCard label={t('results.statAppointmentsPending', locale)} value={rdvEnAttente} />
              <StatCard label={t('results.statConversionRate', locale)} value={`${tauxRdv}%`} hint={t('results.statConversionRateHint', locale)} />
              <StatCard
                label={t('results.statReplyRate', locale)}
                value={replyRate !== null ? `${replyRate}%` : '—'}
                hint={t('results.statReplyRateHint', locale)}
              />
            </div>

            <div className="sourcing-row">
              <p className="sourcing-title">{t('results.sourcingTitle', locale)}</p>
              <div className="sourcing-numbers">
                <div>
                  <span className="big-number">{entreprisesAnalysees}</span>
                  <span className="muted"> {t('results.sourcingCompaniesAnalyzed', locale)}</span>
                </div>
                <div>
                  <span className="big-number">{contactsSources}</span>
                  <span className="muted"> {t('results.sourcingContactsFound', locale)}</span>
                </div>
                <div>
                  <span className="big-number">{tauxContact}%</span>
                  <span className="muted"> {t('results.sourcingContactRate', locale)}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel category-panel">
            <h2>{t('dash.opportunitiesTitle', locale)}</h2>
            <p className="category-hint">{t('results.opportunitiesPeriodHint', locale)}</p>
            {dealsInPeriod.length === 0 ? (
              <EmptyState title={t('dash.noOpportunitiesYet', locale)} body={t('pipeline.emptyOpportunities', locale)} compact />
            ) : (
              <div className="category-row">
                {['signe', 'bonneVoie', 'enCours', 'risque', 'perdu'].map((key) => (
                  <div className="cat-stat-card" key={key}>
                    <span className="dot" style={{ background: OPPORTUNITY_META[key].color }} />
                    <span className="stat-number">{opportunityCounts[key] || 0}</span>
                    <span className="stat-label">{OPPORTUNITY_META[key].label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel category-panel">
            <h2>{t('dash.clientsTitle', locale)}</h2>
            <p className="category-hint">{t('results.clientsWonPeriodHint', locale)}</p>
            {customersInPeriod.length === 0 ? (
              <EmptyState title={t('dash.noClientsYet', locale)} body={t('dash.noClientsYet', locale)} compact />
            ) : (
              <div className="category-row">
                {['saine', 'non_evalue', 'a_surveiller', 'a_risque'].map((key) => (
                  <div className="cat-stat-card" key={key}>
                    <span className="dot" style={{ background: HEALTH_META[key].color }} />
                    <span className="stat-number">{healthCounts[key] || 0}</span>
                    <span className="stat-label">{HEALTH_META[key].label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <style jsx>{`
        .header {
          margin-bottom: 1.2rem;
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
        .period-picker {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          flex-wrap: wrap;
          margin-bottom: 1.5rem;
        }
        .period-label {
          font-size: 0.78rem;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .period-buttons {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .period-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.4rem 0.9rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .period-btn.active {
          background: rgba(75, 57, 239, 0.18);
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.4rem;
          margin-bottom: 1.5rem;
        }
        .panel h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.3rem;
        }
        .category-hint {
          font-size: 0.78rem;
          color: var(--muted);
          margin: 0 0 1rem;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 0.9rem;
        }
        .sourcing-row {
          margin-top: 1.4rem;
          padding-top: 1.2rem;
          border-top: 1px solid var(--border);
        }
        .sourcing-title {
          font-size: 0.86rem;
          font-weight: 600;
          margin: 0 0 0.8rem;
        }
        .sourcing-numbers {
          display: flex;
          gap: 2.5rem;
          flex-wrap: wrap;
        }
        .big-number {
          font-family: var(--font-mono);
          font-size: 1.6rem;
          font-weight: 600;
          margin-right: 0.4rem;
        }
        .muted {
          color: var(--muted);
        }
        .category-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 0.8rem;
        }
        .cat-stat-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-bottom: 0.2rem;
        }
        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.3rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.78rem;
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </Shell>
  );
}

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="stat-card" style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
      <style jsx>{`
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.1rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .stat-value {
          font-family: var(--font-mono);
          font-size: 1.8rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.82rem;
          color: var(--muted);
        }
        .stat-hint {
          font-size: 0.72rem;
          color: var(--muted);
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}

function EmptyState({ title, body, compact }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: ${compact ? '1.5rem 1rem' : '4rem 1rem'};
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
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

  // Un module (Aaron Opportunité / Aaron Client) est grisé dans la navigation tant
  // que l'offre souscrite par la société (companies.offer, voir Préférences)
  // ne correspond pas à ce module. Aaron Prospect (Campagnes/Prospects) reste
  // toujours accessible : c'est l'offre de base incluse à la souscription.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offer = body.preferences?.offer || 'AP';
        setLockedModules({ sales: offer !== 'AS', customer: offer !== 'AC' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯' },
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀' },
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
          onChange={(e) => setLocale(e.target.value)}
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
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0b0e1a;
          --surface: #131629;
          --border: #232744;
          --accent: #4b39ef;
          --accent-green: #3dd68c;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 240px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 1.5rem 1.2rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: var(--font-display);
          font-weight: 600;
          margin-bottom: 2rem;
        }
        .brand-mark {
          width: 30px;
          height: 30px;
          border-radius: 8px;
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.4rem 0.5rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.2rem;
          cursor: pointer;
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          padding: 0.6rem 0.7rem;
          border-radius: 8px;
          font-size: 0.88rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .nav-icon {
          font-size: 0.95rem;
          width: 1.1em;
          text-align: center;
          flex-shrink: 0;
        }
        .nav-list li.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.locked {
          opacity: 0.45;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
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
            width: 38px;
            height: 38px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            padding: 0;
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
            width: 240px;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
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
