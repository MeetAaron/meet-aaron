// app/app/pipeline/page.jsx
// Vue d'ensemble unifiée demandée par Alex ("fusion Pipeline en 3 onglets") :
// Prospects actifs / Opportunités en cours / Historique, en un seul endroit,
// plutôt que d'avoir à naviguer entre Prospects et Aaron Opportunité pour se
// faire une idée globale de l'entonnoir. Volontairement une vue de synthèse
// compacte (compte, tri, aperçu), PAS une réimplémentation des actions riches
// déjà présentes sur Prospects et Aaron Opportunité (envoi d'email, devis,
// brief RDV...) — chaque ligne renvoie vers la page détaillée correspondante
// pour agir. Choix délibéré : réécrire ces ~3000 lignes d'actions/modales
// dans un troisième fichier aurait multiplié le risque de régression sur des
// pages qui touchent directement le chiffre d'affaires, sans pouvoir être
// testé en conditions réelles (pas de compte de test disponible). Cette page
// reste additive : Prospects et Aaron Opportunité ne sont pas modifiées et
// restent pleinement fonctionnelles pour qui y accède directement.
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

// Doit rester cohérent avec app/app/prospects/page.jsx (STATUS_META) et
// app/app/sales/page.jsx (STAGE_META, NON_TERMINAL_STAGES) — trois systèmes
// de statut indépendants (voir statut projet), qu'on ne fusionne pas en base
// ici (aucune migration ajoutée), on se contente de les lire côte à côte.
// Libellés traduits via t('status.<clé>'/'dealStage.<clé>', locale) (voir lib/i18n.js).
const STATUS_COLORS = {
  vert: '#3DD68C',
  jaune: '#8B90A8',
  orange: '#F0914E',
  rouge: '#E5484D',
  bleu: '#4B9EF0',
};

const STAGE_COLORS = {
  rdv_fait: '#4B9EF0',
  devis_envoye: '#F0914E',
  en_negociation: '#F0C94E',
  signe: '#3DD68C',
  perdu: '#E5484D',
};

function statusMetaFor(locale) {
  return Object.fromEntries(
    Object.entries(STATUS_COLORS).map(([key, color]) => [key, { label: t(`status.${key}`, locale), color }])
  );
}

function stageMetaFor(locale) {
  return Object.fromEntries(
    Object.entries(STAGE_COLORS).map(([key, color]) => [key, { label: t(`dealStage.${key}`, locale), color }])
  );
}

const NON_TERMINAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];
const TERMINAL_STAGES = ['signe', 'perdu'];

function companyLabel(row) {
  return row.prospect_companies?.name || row.prospect_companies?.domain || '—';
}

export default function PipelinePage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const [tab, setTab] = useState('prospects');
  const [loading, setLoading] = useState(true);
  const [prospects, setProspects] = useState([]);
  const [deals, setDeals] = useState([]);
  const [salesLocked, setSalesLocked] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [prefsRes, prospectsRes, dealsRes] = await Promise.all([
        fetch(`/api/preferences?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (cancelled) return;
      setSalesLocked((prefsRes.preferences?.offer || 'AP') !== 'AS');
      setProspects(prospectsRes.prospects || []);
      setDeals(dealsRes.deals || []);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Top de l'entonnoir : prospects sans deal_stage — ceux qui apparaissent
  // aussi dans Prospects (même filtre que le correctif du doublon d'affichage,
  // voir statut projet section 12).
  const activeProspects = prospects.filter((p) => !p.deal_stage);
  const openDeals = deals.filter((d) => NON_TERMINAL_STAGES.includes(d.deal_stage));
  const closedDeals = deals
    .filter((d) => TERMINAL_STAGES.includes(d.deal_stage) || d.is_won || d.is_lost)
    .sort((a, b) => new Date(b.deal_stage_updated_at || b.won_at || b.lost_at || 0) - new Date(a.deal_stage_updated_at || a.won_at || a.lost_at || 0));

  const TABS = [
    { key: 'prospects', label: t('pipeline.tabProspects', locale), count: activeProspects.length },
    { key: 'opportunities', label: t('pipeline.tabOpportunities', locale), count: openDeals.length },
    { key: 'history', label: t('pipeline.tabHistory', locale), count: closedDeals.length },
  ];

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; color: #8b90a8; font-family: 'Inter', sans-serif; }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0e1a; color: #e5484d; font-family: 'Inter', sans-serif; text-align: center; padding: 2rem; }
        `}</style>
      </div>
    );
  }

  return (
    <Shell active="Pipeline" userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('pipeline.eyebrow', locale)}</p>
        <h1>{t('nav.pipeline', locale)}</h1>
        <p className="subtitle">{t('pipeline.subtitle', locale)}</p>
      </header>

      {salesLocked && (
        <div className="upsell-banner">
          <div className="upsell-text">
            <p className="upsell-title">{t('pipeline.upsellTitle', locale)}</p>
            <p className="upsell-desc">{t('pipeline.upsellDesc', locale)}</p>
          </div>
          <Link href={`/app/preferences${userId ? `?user_id=${userId}` : ''}`} className="upsell-btn">
            {t('pipeline.upsellCta', locale)}
          </Link>
        </div>
      )}

      <div className="tabs">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'tab active' : 'tab'}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
            <span className="tab-count">{tb.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          {tab === 'prospects' && (
            <ProspectsTab rows={activeProspects} userId={userId} />
          )}
          {tab === 'opportunities' && (
            <OpportunitiesTab rows={openDeals} userId={userId} locked={salesLocked} />
          )}
          {tab === 'history' && (
            <HistoryTab rows={closedDeals} userId={userId} locked={salesLocked} />
          )}
        </>
      )}

      <style jsx>{`
        .header { margin-bottom: 1.4rem; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.72rem; color: var(--accent); font-weight: 600; margin: 0 0 0.4rem; }
        h1 { font-family: var(--font-display); font-size: 1.9rem; margin: 0 0 0.5rem; }
        .subtitle { color: var(--muted); font-size: 0.88rem; margin: 0; max-width: 68ch; overflow-wrap: break-word; }
        .muted { color: var(--muted); }
        .upsell-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          background: linear-gradient(120deg, rgba(75, 57, 239, 0.18), rgba(61, 214, 140, 0.1));
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1rem 1.3rem;
          margin-bottom: 1.4rem;
        }
        .upsell-title { margin: 0 0 0.25rem; font-weight: 600; overflow-wrap: break-word; }
        .upsell-desc { margin: 0; color: var(--muted); font-size: 0.82rem; max-width: 60ch; overflow-wrap: break-word; }
        .upsell-btn {
          background: var(--accent);
          color: white;
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          font-size: 0.84rem;
          text-decoration: none;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.2rem;
          flex-wrap: wrap;
        }
        .tab {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.5rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .tab.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          border-color: var(--accent);
        }
        .tab-count {
          background: rgba(139, 144, 168, 0.2);
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          font-size: 0.76rem;
        }
        .tab.active .tab-count {
          background: rgba(75, 57, 239, 0.35);
        }
      `}</style>
    </Shell>
  );
}

function EmptyRow({ children }) {
  return (
    <div className="empty">
      <p>{children}</p>
      <style jsx>{`
        .empty {
          text-align: center;
          padding: 3rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          color: var(--muted);
          font-size: 0.88rem;
        }
      `}</style>
    </div>
  );
}

function ProspectsTab({ rows, userId }) {
  const [locale] = useLocale();
  const STATUS_META = statusMetaFor(locale);
  if (rows.length === 0) return <EmptyRow>{t('pipeline.emptyProspects', locale)}</EmptyRow>;
  return (
    <div className="list">
      {rows.map((p) => {
        const meta = STATUS_META[p.status] || STATUS_META.jaune;
        return (
          <Link key={p.id} href={`/app/prospects${userId ? `?user_id=${userId}` : ''}`} className="row">
            <span className="dot" style={{ background: meta.color }} />
            <span className="name">{p.full_name || p.email}</span>
            <span className="company">{companyLabel(p)}</span>
            <span className="status-label" style={{ color: meta.color }}>{meta.label}</span>
          </Link>
        );
      })}
      <style jsx>{ROW_STYLES}</style>
    </div>
  );
}

function OpportunitiesTab({ rows, userId, locked }) {
  const [locale] = useLocale();
  const STAGE_META = stageMetaFor(locale);
  if (locked) {
    return (
      <EmptyRow>{t('pipeline.moduleLocked', locale)}</EmptyRow>
    );
  }
  if (rows.length === 0) {
    const stages = [t('dealStage.rdv_fait', locale), t('dealStage.devis_envoye', locale), t('dealStage.en_negociation', locale)].join(', ');
    return <EmptyRow>{`${t('pipeline.emptyOpportunities', locale)} (${stages}).`}</EmptyRow>;
  }
  return (
    <div className="list">
      {rows.map((d) => {
        const meta = STAGE_META[d.deal_stage] || STAGE_META.rdv_fait;
        return (
          <Link key={d.id} href={`/app/sales${userId ? `?user_id=${userId}` : ''}`} className="row">
            <span className="dot" style={{ background: meta.color }} />
            <span className="name">{d.full_name || d.email}</span>
            <span className="company">{companyLabel(d)}</span>
            <span className="status-label" style={{ color: meta.color }}>{meta.label}</span>
          </Link>
        );
      })}
      <style jsx>{ROW_STYLES}</style>
    </div>
  );
}

function HistoryTab({ rows, userId, locked }) {
  const [locale] = useLocale();
  const STAGE_META = stageMetaFor(locale);
  if (locked) {
    return (
      <EmptyRow>{t('pipeline.moduleLocked', locale)}</EmptyRow>
    );
  }
  if (rows.length === 0) return <EmptyRow>{t('pipeline.emptyHistory', locale)}</EmptyRow>;
  return (
    <div className="list">
      {rows.map((d) => {
        const won = d.deal_stage === 'signe' || d.is_won;
        const meta = won ? STAGE_META.signe : STAGE_META.perdu;
        return (
          <Link key={d.id} href={`/app/sales${userId ? `?user_id=${userId}` : ''}`} className="row">
            <span className="dot" style={{ background: meta.color }} />
            <span className="name">{d.full_name || d.email}</span>
            <span className="company">{companyLabel(d)}</span>
            <span className="status-label" style={{ color: meta.color }}>{won ? t('pipeline.won', locale) : t('dealStage.perdu', locale)}</span>
          </Link>
        );
      })}
      <style jsx>{ROW_STYLES}</style>
    </div>
  );
}

const ROW_STYLES = `
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row {
    display: grid;
    grid-template-columns: 10px 1fr 1fr auto;
    align-items: center;
    gap: 0.9rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.8rem 1rem;
    text-decoration: none;
    color: var(--text);
  }
  .row:hover {
    border-color: var(--accent);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name {
    font-weight: 600;
    font-size: 0.9rem;
    overflow-wrap: break-word;
  }
  .company {
    color: var(--muted);
    font-size: 0.84rem;
    overflow-wrap: break-word;
  }
  .status-label {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 10px 1fr;
      grid-template-areas: "dot name" ". company" ". status";
    }
    .company, .status-label {
      grid-column: 2;
    }
  }
`;

function Shell({ children, active, userId }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ sales: false, customer: false });
  const [locale, setLocale] = useLocale();

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
    { label: t('nav.pipeline', locale), slug: 'pipeline', icon: '🧭' },
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
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}>🔒</span>}</li>
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
