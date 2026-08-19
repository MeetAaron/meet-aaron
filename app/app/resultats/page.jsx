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
          border-radius: var(--radius-lg);
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
          border-radius: var(--radius-md);
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
          border-radius: var(--radius-lg);
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
