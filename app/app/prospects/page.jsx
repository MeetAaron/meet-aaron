// app/app/prospects/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import { frenchTypography } from '@/lib/text-typography';
import CsvImportModal from '@/components/CsvImportModal';
import ExportFormatMenu from '@/components/ExportFormatMenu';
import ContactCard, { DiscBadge, ProgressLine } from '@/components/ContactCard';
import { downloadSpreadsheet } from '@/lib/xlsx-io';
import { PIPELINE_STAGES, PIPELINE_COLORS, CATEGORY_ICONS, derivePipelinePosition, countPipeline, categoryOfStage, stageOrder } from '@/lib/pipeline';
import { contactAlerts } from '@/lib/contact-alerts';

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

// Ordre volontaire (voir CHANGEMENTS A FAIRE #4/#11, confirmé par Alex le
// 25/08 : "rdv obtenu doit être avant en bonne voie") : RDV obtenu (bleu)
// tout à gauche, avant "en bonne voie" (vert).
const STATUS_COLORS = {
  bleu: '#4B9EF0',
  vert: '#3DD68C',
  jaune: '#8B90A8',
  orange: '#F0914E',
  rouge: '#E5484D',
};

function statusMetaFor(locale) {
  return Object.fromEntries(
    Object.entries(STATUS_COLORS).map(([key, color]) => [key, { label: t(`status.${key}`, locale), color }])
  );
}

const PERSONALITY_KEYS = ['dominant', 'influent', 'stable', 'consciencieux'];

function personalityLabelsFor(locale) {
  return Object.fromEntries(PERSONALITY_KEYS.map((key) => [key, t(`personality.${key}`, locale)]));
}

const PROSPECTS_CSV_TEMPLATE_HEADERS_KEYS = [
  'prospects.colName',
  'prospects.colCompany',
  'prospects.colJobTitle',
  'modal.email',
  'modal.phone',
  'prospects.colAddress',
  'prospects.colSiret',
  'prospects.colWebsite',
  'prospects.colIndustry',
  'prospects.colCompanySize',
  'prospects.colEstimatedRevenue',
  'prospects.templateColManaged',
];

// docx AJOUT GLOBAL A15 : ajoute la colonne "gestion Aaron" (oui/non — voir
// champ ai_managed, migration_customer_ai_managed_2026-08-17.sql) demandée
// explicitement par Alex, en plus des colonnes déjà exportées.
//
// Choix CSV (recommandé) / Excel (demande Alex 2026-08-25, voir
// components/ExportFormatMenu.jsx et lib/xlsx-io.js) : `format` vaut 'csv'
// ou 'xlsx'.
function exportProspectsToCsv(prospects, locale, format) {
  const statusMeta = statusMetaFor(locale);
  const personalityLabels = personalityLabelsFor(locale);
  const headers = [
    t('pipeline.colProgress', locale),
    t('prospects.colStatus', locale),
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
    t('prospects.colPersonality', locale),
    t('modal.aaronAdvice', locale),
    t('prospects.templateColManaged', locale),
  ];
  const rows = prospects.map((p) => [
    (() => {
      const pos = derivePipelinePosition(p);
      return pos.lost ? t('pipeline.lostLabel', locale) : t(PIPELINE_STAGES[stageOrder(pos.stage)].labelKey, locale);
    })(),
    statusMeta[p.status]?.label || p.status,
    p.full_name,
    p.prospect_companies?.name || '',
    p.job_title || '',
    p.email,
    p.phone || '',
    p.prospect_companies?.address || '',
    p.prospect_companies?.siret || '',
    p.prospect_companies?.website || '',
    p.prospect_companies?.industry || '',
    p.prospect_companies?.company_size || '',
    p.prospect_companies?.estimated_revenue || '',
    personalityLabels[p.personality_type] || '',
    p.aaron_advice || '',
    p.ai_managed === false ? t('common.no', locale) : t('common.yes', locale),
  ]);
  downloadSpreadsheet(headers, rows, `prospects-${new Date().toISOString().slice(0, 10)}`, format);
}

// docx AJOUT GLOBAL A15 : "un fichier vierge pour y mettre sa propre base de
// données" — même entêtes que l'export, sans données, pour préparer un
// import ultérieur. Choix CSV/Excel identique à l'export (voir ci-dessus).
function downloadBlankProspectsTemplate(locale, format) {
  const headers = PROSPECTS_CSV_TEMPLATE_HEADERS_KEYS.map((k) => t(k, locale));
  downloadSpreadsheet(headers, [], 'modele-prospects-vierge', format);
}

export default function ProspectsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const PERSONALITY_LABELS = personalityLabelsFor(locale);
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [linkedinProspect, setLinkedinProspect] = useState(null);
  const [pendingEmailProspect, setPendingEmailProspect] = useState(null);
  const [search, setSearch] = useState('');
  // Fusion Prospects + Opportunités + Clients (docx « mon avis » d'Alex,
  // 31/08/2026) : un seul tableau, filtré par catégorie (prospects +
  // opportunités par défaut, clients à la demande), par étape de la ligne
  // de progression, et par raccourcis « risque » / « perdus » / « gérés par
  // Aaron ». La fiche contact (components/ContactCard.jsx) s'ouvre en
  // panneau latéral (feuille plein écran sur téléphone).
  const [categories, setCategories] = useState(['prospect', 'opportunite']);
  // Tableau et non valeur unique (demande Alex, 01/09/2026) : cliquer sur
  // « En cours » PUIS « En bonne voie » affiche les deux étapes cumulées,
  // jusqu'à ce qu'on reclique dessus pour les retirer. Tableau vide = aucun
  // filtre d'étape (toutes les étapes des catégories cochées).
  const [stageFilter, setStageFilter] = useState([]);
  const [extraFilter, setExtraFilter] = useState(null); // 'risk' | 'lost' | null
  const [aaronOnly, setAaronOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  async function loadProspects() {
    const res = await fetch(`/api/prospects?user_id=${userId}&scope=all`).then((r) => r.json());
    setProspects(res.prospects || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadProspects();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
      });
    // Lien direct vers une fiche (notification push « Devis à faire », story
    // du tableau de bord…) : /app/prospects?contact=<id>.
    try {
      const wanted = new URLSearchParams(window.location.search).get('contact');
      if (wanted) setSelectedId(wanted);
    } catch {}
  }, [userId]);

  const rows = prospects.map((p) => ({ p, position: derivePipelinePosition(p), alerts: contactAlerts(p) }));
  const counts = countPipeline(prospects);
  const aaronManagedCount = rows.filter((r) => r.p.ai_managed !== false && !r.position.lost).length;

  function toggleCategory(cat) {
    setExtraFilter(null);
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }
  function toggleExtra(key) {
    setExtraFilter((prev) => (prev === key ? null : key));
    setStageFilter([]);
  }
  function toggleStage(stage) {
    setExtraFilter(null);
    setStageFilter((prev) => (prev.includes(stage) ? prev.filter((x) => x !== stage) : [...prev, stage]));
    const cat = categoryOfStage(stage);
    setCategories((prev) => (prev.includes(cat) ? prev : [...prev, cat]));
  }

  const searchTerm = search.trim().toLowerCase();
  const filtered = rows
    .filter(({ p, position }) => {
      if (extraFilter === 'lost') return position.lost;
      if (position.lost) return false;
      if (extraFilter === 'risk') return position.risk;
      if (!categories.includes(position.category)) return false;
      if (stageFilter.length > 0 && !stageFilter.includes(position.stage)) return false;
      if (aaronOnly && p.ai_managed === false) return false;
      return true;
    })
    .filter(({ p }) => {
      if (!searchTerm) return true;
      const haystack = [p.full_name, p.email, p.phone, p.job_title, p.prospect_companies?.name].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    })
    .sort((a, b) => {
      const ua = a.alerts.some((x) => x.level === 'urgent') ? 0 : a.alerts.length > 0 ? 1 : 2;
      const ub = b.alerts.some((x) => x.level === 'urgent') ? 0 : b.alerts.length > 0 ? 1 : 2;
      if (ua !== ub) return ua - ub;
      return 0;
    });

  const selected = selectedId ? prospects.find((p) => p.id === selectedId) : null;

  const contactsPerCompany = {};
  for (const p of prospects) {
    if (!p.prospect_company_id) continue;
    contactsPerCompany[p.prospect_company_id] = (contactsPerCompany[p.prospect_company_id] || 0) + 1;
  }

  function nextStepFor({ p, position, alerts }) {
    if (alerts.length > 0) {
      return { text: t(alerts[0].labelKey, locale), level: alerts[0].level };
    }
    if (p.next_appointment) {
      const d = new Date(p.next_appointment.proposed_at);
      return { text: `${t('pipeline.next.rdv', locale)} ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`, level: 'info' };
    }
    if (position.lost) {
      return { text: position.lostReason ? t(`pipeline.lostReason.${position.lostReason}`, locale) : t('pipeline.lostLabel', locale), level: 'muted' };
    }
    if (position.stage === 'client') {
      return { text: t('pipeline.next.client', locale), level: 'muted' };
    }
    if (p.aaron_advice) {
      const short = p.aaron_advice.length > 70 ? `${p.aaron_advice.slice(0, 70).trimEnd()}…` : p.aaron_advice;
      return { text: frenchTypography(short), level: 'muted' };
    }
    return { text: t(PIPELINE_STAGES[stageOrder(position.stage)].hintKey, locale), level: 'muted' };
  }

  function originLabel(p) {
    if (p.origin === 'amene_par_aaron') return { icon: '🤖', text: t('pipeline.origin.aaron', locale) };
    if (p.origin === 'reactive_par_aaron') return { icon: '♻️', text: t('pipeline.origin.reactivated', locale) };
    return { icon: '👤', text: t('pipeline.origin.you', locale) };
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

  const CATEGORY_DEFS = [
    { key: 'prospect', label: t('pipeline.cat.prospects', locale), hint: t('pipeline.cat.prospectsHint', locale) },
    { key: 'opportunite', label: t('pipeline.cat.opportunities', locale), hint: t('pipeline.cat.opportunitiesHint', locale) },
    { key: 'client', label: t('pipeline.cat.clients', locale), hint: t('pipeline.cat.clientsHint', locale) },
  ];

  return (
    <Shell active={t('nav.prospects', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('prospects.eyebrow', locale)}</p>
          <h1>{t('prospects.title', locale)}</h1>
          <p className="subtitle">{t('pipeline.fusionSubtitle', locale)} <button type="button" className="link-btn" onClick={() => setShowHelp((v) => !v)}>{showHelp ? t('pipeline.helpHide', locale) : t('pipeline.helpShow', locale)}</button></p>
        </div>
        <div className="header-actions">
          <ExportFormatMenu
            label={t('pipeline.exportFile', locale)}
            disabled={filtered.length === 0}
            onChoose={(format) => exportProspectsToCsv(filtered.map((r) => r.p), locale, format)}
          />
          <div className="import-group">
            <button className="btn-secondary" onClick={() => setShowCsvImport(true)}>
              {t('pipeline.importFile', locale)}
            </button>
            <span className="import-note">
              {t('pipeline.importNote', locale)}{' '}
              <ExportFormatMenu label={t('pipeline.blankTemplate', locale)} variant="link" onChoose={(format) => downloadBlankProspectsTemplate(locale, format)} />
            </span>
          </div>
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            {t('pipeline.addManually', locale)}
          </button>
        </div>
      </header>

      <Stories userId={userId} locale={locale} onChanged={loadProspects} onOpenContact={(id) => setSelectedId(id)} />

      {showHelp && (
        <div className="help-box">
          <p>{t('pipeline.helpIntro', locale)}</p>
          <ul>
            {PIPELINE_STAGES.map((s) => (
              <li key={s.key}><strong>{CATEGORY_ICONS[s.category]} {t(s.labelKey, locale)}</strong> — {t(s.hintKey, locale)}</li>
            ))}
            <li><strong style={{ color: PIPELINE_COLORS.risk }}>⚠ {t('pipeline.riskLabel', locale)}</strong> — {t('pipeline.riskHint', locale)}</li>
            <li><strong style={{ color: PIPELINE_COLORS.lost }}>✕ {t('pipeline.lostLabel', locale)}</strong> — {t('pipeline.lostHint', locale)}</li>
          </ul>
        </div>
      )}

      <div className="cat-row">
        {CATEGORY_DEFS.map((c) => {
          const on = extraFilter === null && categories.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              className={`cat-chip${on ? ' on' : ''}`}
              style={on ? { borderColor: PIPELINE_COLORS[c.key], color: PIPELINE_COLORS[c.key], background: `${PIPELINE_COLORS[c.key]}18` } : undefined}
              onClick={() => toggleCategory(c.key)}
              title={c.hint}
            >
              <span className="cat-ic">{CATEGORY_ICONS[c.key]}</span>
              {c.label}
              <span className="cat-count">{counts.byCategory[c.key]}</span>
            </button>
          );
        })}
        <span className="cat-sep" />
        <button type="button" className={`cat-chip small${extraFilter === 'risk' ? ' on risk' : ''}`} onClick={() => toggleExtra('risk')} title={t('pipeline.riskHint', locale)}>
          ⚠ {t('pipeline.riskLabel', locale)} <span className="cat-count">{counts.risk}</span>
        </button>
        <button type="button" className={`cat-chip small${extraFilter === 'lost' ? ' on lost' : ''}`} onClick={() => toggleExtra('lost')} title={t('pipeline.lostHint', locale)}>
          ✕ {t('pipeline.lostLabel', locale)} <span className="cat-count">{counts.lost}</span>
        </button>
        <button type="button" className={`cat-chip small${aaronOnly ? ' on aaron' : ''}`} onClick={() => setAaronOnly((v) => !v)} title={t('pipeline.aaronOnlyHint', locale)}>
          🤖 {t('pipeline.aaronOnly', locale)} <span className="cat-count">{aaronManagedCount}</span>
        </button>
      </div>

      <div className="stage-bar">
        {PIPELINE_STAGES.map((s, i) => {
          const on = stageFilter.includes(s.key);
          const color = PIPELINE_COLORS[s.category];
          return (
            <button
              key={s.key}
              type="button"
              className={`stage-btn${on ? ' on' : ''}`}
              style={on ? { borderColor: color, background: `${color}18` } : undefined}
              onClick={() => toggleStage(s.key)}
              title={t(s.hintKey, locale)}
            >
              {i > 0 && <span className="stage-link" />}
              {/* Pastille = l'icône de la catégorie (🎯 prospect / 🤝
                  opportunité / ⭐ client) plutôt qu'un simple point coloré
                  (demande Alex, 01/09/2026) : on relit la ligne de
                  progression sans avoir à décoder les couleurs, et ça
                  raccroche visuellement aux chips du dessus. */}
              <span className="stage-dot" style={{ background: color, boxShadow: `0 0 0 3px var(--bg)` }} aria-hidden="true">
                {CATEGORY_ICONS[s.category]}
              </span>
              <span className="stage-count">{counts.byStage[s.key]}</span>
              <span className="stage-label">{t(s.labelKey, locale)}</span>
            </button>
          );
        })}
      </div>

      {prospects.length > 0 && (
        <div className="search-row">
          <input
            type="search"
            className="search-input"
            placeholder={t('prospects.searchPlaceholder', locale)}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch('')}>
              {t('prospects.clear', locale)}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('prospects.emptyTitle', locale)}
          body={
            prospects.length === 0
              ? t('prospects.emptyBodyNoProspects', locale)
              : searchTerm
              ? t('prospects.emptyBodySearchNoMatch', locale)
              : t('prospects.emptyBodyFilterNoMatch', locale)
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('pipeline.colProgress', locale)}</th>
                  <th>{t('prospects.colContact', locale)}</th>
                  <th>{t('pipeline.colConviction', locale)}</th>
                  <th>{t('pipeline.colOrigin', locale)}</th>
                  <th>{t('pipeline.colNextStep', locale)}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const { p, position, alerts } = row;
                  const urgent = alerts.some((a) => a.level === 'urgent');
                  const next = nextStepFor(row);
                  const origin = originLabel(p);
                  const conviction = p.conviction_score ?? p.negotiation_confidence_score ?? null;
                  const otherContacts = p.prospect_company_id ? (contactsPerCompany[p.prospect_company_id] || 1) - 1 : 0;
                  const catColor = position.lost ? PIPELINE_COLORS.lost : PIPELINE_COLORS[position.category];
                  return (
                    <tr key={p.id} className={`row${selectedId === p.id ? ' selected' : ''}`} onClick={() => setSelectedId(p.id)}>
                      <td className="progress-cell">
                        <div className="progress-inner">
                          <span className="cat-badge" style={{ background: `${catColor}22`, color: catColor }}>{position.lost ? '✕' : CATEGORY_ICONS[position.category]}</span>
                          <div>
                            <ProgressLine position={position} locale={locale} compact />
                            <span className="stage-name" style={{ color: catColor }}>
                              {position.lost ? t('pipeline.lostLabel', locale) : t(PIPELINE_STAGES[stageOrder(position.stage)].labelKey, locale)}
                              {position.risk && <span className="risk-flag" title={t('pipeline.riskLabel', locale)}> ⚠</span>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="contact-cell">
                        <div className="name-line">
                          <span className="name">{p.full_name}</span>
                          <DiscBadge type={p.personality_type} locale={locale} />
                          {alerts.length > 0 && <span className={`alert-dot${urgent ? ' urgent' : ''}`} title={t(alerts[0].labelKey, locale)}>!</span>}
                          {p.ai_managed === false && <span className="paused" title={t('prospects.aiManagedOffTitle', locale)}>⏸</span>}
                        </div>
                        <div className="company-line muted">
                          {p.prospect_companies?.name || p.email}
                          {p.job_title ? ` · ${p.job_title}` : ''}
                          {otherContacts > 0 && (
                            <button
                              type="button"
                              className="company-badge"
                              title={t('prospects.otherContactsTitle', locale).replace('{count}', otherContacts)}
                              onClick={(e) => { e.stopPropagation(); setSearch(p.prospect_companies?.name || ''); }}
                            >
                              +{otherContacts}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="conviction-cell">
                        {conviction != null ? (
                          <div className="conviction" title={p.conviction_reason || p.negotiation_confidence_reason || ''}>
                            <span className="bar"><span style={{ width: `${Math.max(0, Math.min(100, conviction))}%`, background: conviction >= 70 ? PIPELINE_COLORS.client : conviction >= 40 ? PIPELINE_COLORS.wonPending : PIPELINE_COLORS.lost }} /></span>
                            <span className="score">{conviction}</span>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="origin-cell muted"><span title={origin.text}>{origin.icon} {origin.text}</span></td>
                      <td className={`next-cell ${next.level}`}>{next.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="cards">
            {filtered.map((row) => {
              const { p, position, alerts } = row;
              const urgent = alerts.some((a) => a.level === 'urgent');
              const next = nextStepFor(row);
              const catColor = position.lost ? PIPELINE_COLORS.lost : PIPELINE_COLORS[position.category];
              const conviction = p.conviction_score ?? p.negotiation_confidence_score ?? null;
              return (
                <button type="button" key={p.id} className="mcard" onClick={() => setSelectedId(p.id)}>
                  <span className="cat-badge" style={{ background: `${catColor}22`, color: catColor }}>{position.lost ? '✕' : CATEGORY_ICONS[position.category]}</span>
                  <div className="mcard-body">
                    <div className="name-line">
                      <span className="name">{p.full_name}</span>
                      <DiscBadge type={p.personality_type} locale={locale} />
                      {alerts.length > 0 && <span className={`alert-dot${urgent ? ' urgent' : ''}`}>!</span>}
                    </div>
                    <div className="company-line muted">{p.prospect_companies?.name || p.email}</div>
                    <div className="mcard-progress">
                      <ProgressLine position={position} locale={locale} compact />
                      <span className="stage-name" style={{ color: catColor }}>
                        {position.lost ? t('pipeline.lostLabel', locale) : t(PIPELINE_STAGES[stageOrder(position.stage)].labelKey, locale)}
                        {position.risk && ' ⚠'}
                      </span>
                      {conviction != null && <span className="mcard-score">{conviction}/100</span>}
                    </div>
                    <div className={`mcard-next ${next.level}`}>{next.text}</div>
                  </div>
                  <span className="chev">›</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <ContactCard
          prospect={selected}
          locale={locale}
          userId={userId}
          onClose={() => setSelectedId(null)}
          onChanged={loadProspects}
          onValidateEmail={(p) => setPendingEmailProspect(p)}
          onLinkedin={(p) => setLinkedinProspect(p)}
          onDeleted={() => {
            setSelectedId(null);
            loadProspects();
          }}
        />
      )}

      {linkedinProspect && (
        <LinkedInDraftModal prospect={linkedinProspect} onClose={() => setLinkedinProspect(null)} />
      )}

      {pendingEmailProspect && (
        <FirstEmailApprovalModal
          prospect={pendingEmailProspect}
          onClose={() => setPendingEmailProspect(null)}
          onDone={() => {
            setPendingEmailProspect(null);
            loadProspects();
          }}
        />
      )}

      {showAddForm && (
        <AddProspectModal
          userId={userId}
          companyId={companyId}
          onClose={() => setShowAddForm(false)}
          onCreated={() => {
            setShowAddForm(false);
            loadProspects();
          }}
          onFirstContactSettled={(emailWarning) => {
            loadProspects();
            if (emailWarning) {
              window.alert(emailWarning);
            }
          }}
        />
      )}

      {showCsvImport && (
        <CsvImportModal
          userId={userId}
          companyId={companyId}
          context="prospects"
          module="ap"
          onClose={() => setShowCsvImport(false)}
          onImported={() => {
            loadProspects();
          }}
        />
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1.3rem;
        }
        .header-actions {
          display: flex;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .import-group { display: flex; flex-direction: column; gap: 0.25rem; }
        .import-note { font-size: 0.72rem; color: var(--muted); max-width: 22ch; line-height: 1.3; }
        .btn-secondary {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.7rem 1.1rem;
          font-size: 0.86rem;
          cursor: pointer;
          font-family: inherit;
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
          font-family: inherit;
        }
        .link-btn {
          background: none;
          border: none;
          padding: 0;
          color: var(--accent-light);
          font-size: inherit;
          font-family: inherit;
          text-decoration: underline;
          cursor: pointer;
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
        .subtitle { color: var(--muted); font-size: 0.86rem; margin: 0.4rem 0 0; max-width: 60ch; }
        .help-box {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1rem 1.2rem;
          margin-bottom: 1.2rem;
          font-size: 0.84rem;
          line-height: 1.5;
        }
        .help-box p { margin: 0 0 0.5rem; color: var(--muted); }
        .help-box ul { margin: 0; padding-left: 1.1rem; }
        .help-box li { margin-bottom: 0.25rem; }
        .cat-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.9rem; }
        .cat-sep { width: 1px; height: 1.6rem; background: var(--border); margin: 0 0.3rem; }
        .cat-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.5rem 0.95rem;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: border-color var(--fast), color var(--fast), background var(--fast);
        }
        .cat-chip.small { font-weight: 500; font-size: 0.78rem; padding: 0.4rem 0.8rem; }
        .cat-chip.on.risk { border-color: ${PIPELINE_COLORS.risk}; color: ${PIPELINE_COLORS.risk}; background: ${PIPELINE_COLORS.risk}18; }
        .cat-chip.on.lost { border-color: ${PIPELINE_COLORS.lost}; color: ${PIPELINE_COLORS.lost}; background: ${PIPELINE_COLORS.lost}18; }
        .cat-chip.on.aaron { border-color: var(--accent); color: var(--accent-light); background: rgba(75, 57, 239, 0.14); }
        .cat-ic { font-size: 0.95rem; }
        .cat-count {
          background: rgba(244, 241, 234, 0.08);
          color: inherit;
          border-radius: 999px;
          padding: 0.05rem 0.5rem;
          font-size: 0.72rem;
          font-family: var(--font-mono);
        }
        .stage-bar {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 0;
          margin-bottom: 1.1rem;
        }
        .stage-btn {
          position: relative;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          padding: 0.6rem 0.3rem 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          cursor: pointer;
          font-family: inherit;
          color: var(--muted);
          transition: border-color var(--fast), background var(--fast);
        }
        .stage-btn:hover { background: var(--surface); }
        .stage-btn.on { color: var(--text); }
        .stage-link {
          position: absolute;
          top: calc(0.6rem + 6px);
          left: -50%;
          width: 100%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }
        .stage-dot {
          position: relative;
          z-index: 1;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          box-shadow: 0 0 0 3px var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.78rem;
          line-height: 1;
        }
        .stage-count { font-family: var(--font-mono); font-size: 0.95rem; color: var(--text); line-height: 1; margin-top: 0.15rem; }
        .stage-label { font-size: 0.7rem; text-align: center; line-height: 1.15; }
        .search-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem; }
        .search-input {
          flex: 1;
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.65rem 1rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }
        .search-input::placeholder { color: var(--muted); }
        .search-clear {
          background: none;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          white-space: nowrap;
          font-family: inherit;
        }
        .muted { color: var(--muted); }
        .table-wrap {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
        thead th {
          text-align: left;
          padding: 0.8rem 1rem;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        tbody td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
        tbody tr:last-child td { border-bottom: none; }
        .row { cursor: pointer; transition: background var(--fast); }
        .row:hover { background: var(--surface-hover); }
        .row.selected { background: rgba(75, 57, 239, 0.1); }
        .progress-cell { width: 150px; }
        .progress-inner { display: flex; align-items: center; gap: 0.6rem; }
        .cat-badge {
          width: 1.9rem;
          height: 1.9rem;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.95rem;
          flex-shrink: 0;
        }
        .stage-name { display: block; font-size: 0.7rem; margin-top: 0.3rem; white-space: nowrap; }
        .risk-flag { color: ${PIPELINE_COLORS.risk}; }
        .name-line { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .name { font-weight: 600; }
        .alert-dot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.1rem;
          height: 1.1rem;
          border-radius: 50%;
          background: var(--accent-amber);
          color: #1a1400;
          font-size: 0.7rem;
          font-weight: 800;
          flex-shrink: 0;
        }
        .alert-dot.urgent { background: var(--accent-red); color: #fff; animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 89, 0.5); } 50% { box-shadow: 0 0 0 5px rgba(239, 68, 89, 0); } }
        .paused { color: var(--muted); font-size: 0.75rem; }
        .company-line { font-size: 0.78rem; margin-top: 0.15rem; }
        .company-badge {
          display: inline-block;
          margin-left: 0.4rem;
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          border: none;
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          font-size: 0.7rem;
          font-family: var(--font-mono);
          cursor: pointer;
        }
        .conviction-cell { width: 130px; }
        .conviction { display: flex; align-items: center; gap: 0.5rem; }
        .bar { flex: 1; height: 6px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); overflow: hidden; display: block; }
        .bar span { display: block; height: 100%; border-radius: 999px; }
        .score { font-family: var(--font-mono); font-size: 0.76rem; width: 2ch; text-align: right; }
        .origin-cell { white-space: nowrap; font-size: 0.8rem; }
        .next-cell { font-size: 0.82rem; max-width: 30ch; }
        .next-cell.urgent { color: var(--accent-red); font-weight: 700; }
        .next-cell.todo { color: var(--accent-amber); font-weight: 600; }
        .next-cell.info { color: var(--text); font-weight: 500; }
        .next-cell.muted { color: var(--muted); }
        .cards { display: none; }
        @media (max-width: 900px) {
          .header { flex-direction: column; gap: 0.8rem; }
          .header-actions { width: 100%; }
          .header-actions > :global(*) { flex: 1 1 100%; }
          .import-note { max-width: none; }
          .stage-bar { grid-template-columns: repeat(6, minmax(58px, 1fr)); overflow-x: auto; }
          .stage-label { font-size: 0.62rem; }
          .table-wrap { display: none; }
          .cards { display: flex; flex-direction: column; gap: 0.6rem; }
          .mcard {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            width: 100%;
            text-align: left;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 0.85rem 0.9rem;
            cursor: pointer;
            font-family: inherit;
            color: var(--text);
          }
          .mcard:active { background: var(--surface-hover); }
          .mcard-body { flex: 1; min-width: 0; }
          .mcard .cat-badge { width: 2.2rem; height: 2.2rem; font-size: 1.05rem; }
          .mcard-progress { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
          .mcard-progress .stage-name { margin-top: 0; }
          .mcard-score { margin-left: auto; font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); }
          .mcard-next { font-size: 0.8rem; margin-top: 0.35rem; }
          .mcard-next.urgent { color: var(--accent-red); font-weight: 700; }
          .mcard-next.todo { color: var(--accent-amber); font-weight: 600; }
          .mcard-next.info { color: var(--text); }
          .mcard-next.muted { color: var(--muted); }
          .chev { color: var(--muted); font-size: 1.4rem; }
        }
      `}</style>
    </Shell>
  );
}

function AddProspectModal({ userId, companyId, onClose, onCreated, onFirstContactSettled }) {
  const [locale] = useLocale();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
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

    // docx item 13 (2026-08-27) : async_first_contact fait répondre cette
    // route en moins d'une seconde (juste la création en base) — voir le
    // commentaire détaillé dans app/api/prospects/route.ts. Le vrai premier
    // message d'Aaron (recherche web + génération + envoi, la partie lente
    // qui prenait ~1 minute) est déclenché juste en dessous, séparément et
    // sans bloquer ce formulaire.
    const res = await fetch('/api/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        assigned_user_id: userId,
        full_name: fullName,
        email,
        phone: phone || null,
        job_title: jobTitle || null,
        company_name: companyName || null,
        linkedin_url: linkedinUrl || null,
        address: address || null,
        siret: siret || null,
        website: website || null,
        industry: industry || null,
        company_size: companySize || null,
        estimated_revenue: estimatedRevenue || null,
        async_first_contact: true,
      }),
    });

    setSubmitting(false);

    const body = await res.json();

    if (!res.ok) {
      setError(body.error || t('prospects.createErrorFallback', locale));
      return;
    }

    onCreated(body.prospect);

    if (body.prospect?.id) {
      fetch(`/api/prospects/${body.prospect.id}/generate-first-contact`, { method: 'POST' })
        .then((r) => r.json())
        .then((res) => onFirstContactSettled(res.emailWarning || null))
        .catch(() =>
          onFirstContactSettled("Prospect ajouté, mais le premier message n'a pas pu être généré automatiquement.")
        );
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t('prospects.addModalTitle', locale)}</h2>
        <p className="hint">
          {t('prospects.addModalHint', locale)}
        </p>

        <div className="name-row">
          <label>
            {t('prospects.firstNameLabel', locale)}
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('prospects.firstNamePlaceholder', locale)} required />
          </label>
          <label>
            {t('prospects.lastNameLabel', locale)}
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('prospects.lastNamePlaceholder', locale)} required />
          </label>
        </div>

        <label>
          {t('modal.email', locale)}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('prospects.emailPlaceholder', locale)} required />
        </label>

        <label>
          {t('modal.phone', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('prospects.phonePlaceholder', locale)} />
        </label>

        <label>
          {t('prospects.colJobTitle', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder={t('prospects.jobTitlePlaceholder', locale)} />
        </label>

        <label>
          {t('prospects.colCompany', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={t('prospects.companyPlaceholder', locale)} />
        </label>

        <label>
          LinkedIn {t('prospects.optionalSuffix', locale)}
          <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder={t('prospects.linkedinPlaceholder', locale)} />
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
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('prospects.addModalSubmitting', locale) : t('prospects.addModalSubmit', locale)}
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
        @media (max-width: 480px) {
          .company-fields {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

// Aaron rédige une proposition de note de connexion + premier message LinkedIn,
// mais n'envoie jamais rien lui-même : le commercial copie et envoie depuis son
// propre compte LinkedIn (voir lib/linkedin-assist.ts pour le pourquoi — aucune
// automatisation LinkedIn n'est faite ou prévue, ça violerait les CGU LinkedIn
// et risquerait de faire bannir le compte du commercial).
// Historique des échanges + fiche de personnalité pour un prospect, vus par
// le commercial. Chaque message sortant est marqué "🤖 Généré par Aaron" pour
// que le commercial distingue clairement ce qui a été écrit/envoyé
// automatiquement (tout l'outbound, dans ce produit) des réponses du prospect.
// Écran de relecture du tout premier email généré par Aaron, affiché
// uniquement si le commercial a activé "Je valide avant envoi" dans
// Préférences (voir migration_first_email_approval_2026-08-15.sql). Le
// commercial peut modifier l'objet/le corps avant de confirmer l'envoi —
// contrairement au reste de l'outbound (relances, devis) qui ne propose que
// l'approbation telle quelle, ici l'édition est utile car c'est le tout
// premier contact avec le prospect.
function FirstEmailApprovalModal({ prospect, onClose, onDone }) {
  const [locale] = useLocale();
  const [subject, setSubject] = useState(prospect.pending_first_email_subject || '');
  const [body, setBody] = useState(prospect.pending_first_email_body || '');
  const [sending, setSending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'envoyer_premier_email',
        first_email_subject: subject,
        first_email_body: body,
      }),
    });
    setSending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || t('prospects.sendErrorFallback', locale));
      return;
    }
    onDone();
  }

  async function handleReject() {
    if (!window.confirm(t('prospects.confirmRejectFirstEmail', locale).replace('{name}', prospect.full_name))) {
      return;
    }
    setRejecting(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rejeter_premier_email' }),
    });
    setRejecting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || t('common.error', locale));
      return;
    }
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('prospects.firstEmailModalTitle', locale).replace('{name}', prospect.full_name)}</h2>
        <p className="hint">
          {t('prospects.firstEmailModalHint', locale)}
        </p>

        <label>
          {t('prospects.subjectLabel', locale)}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label>
          {t('prospects.messageLabel', locale)}
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={sending || rejecting}>
            {t('prospects.laterButton', locale)}
          </button>
          <button type="button" className="btn-secondary reject" onClick={handleReject} disabled={sending || rejecting}>
            {rejecting ? '…' : t('prospects.rejectButton', locale)}
          </button>
          <button type="button" className="btn-primary" onClick={handleSend} disabled={sending || rejecting || !subject.trim() || !body.trim()}>
            {sending ? t('prospects.sendingButton', locale) : t('prospects.sendNowButton', locale)}
          </button>
        </div>
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
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 600px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 0.5rem;
        }
        .hint {
          color: var(--muted);
          font-size: 0.82rem;
          margin: 0 0 1.2rem;
          line-height: 1.45;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 1rem;
        }
        input, textarea {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.82rem;
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 1rem;
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
          opacity: 0.6;
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
        .btn-secondary.reject {
          border-color: var(--accent-red);
          color: var(--accent-red);
        }
        .btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function LinkedInDraftModal({ prospect, onClose }) {
  const [locale] = useLocale();
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/prospects/${prospect.id}/linkedin-draft`, { method: 'POST' })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(body.error || t('common.error', locale));
        } else {
          setDraft(body.draft);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('prospects.networkError', locale));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [prospect.id]);

  function copy(text, which) {
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('prospects.linkedinModalTitle', locale).replace('{name}', prospect.full_name)}</h2>
        <p className="hint">
          {t('prospects.linkedinModalHint', locale)}
        </p>

        {loading && <p className="muted">{t('prospects.draftingInProgress', locale)}</p>}
        {error && <p className="error">{error}</p>}

        {draft && (
          <>
            {draft.linkedin_url ? (
              <a href={draft.linkedin_url} target="_blank" rel="noreferrer" className="li-profile-link">
                {t('prospects.openLinkedinProfile', locale)}
              </a>
            ) : (
              <p className="muted small">{t('prospects.linkedinProfileNotFound', locale).replace('{name}', prospect.full_name)}</p>
            )}

            <label>
              {t('prospects.connectionNoteLabel', locale)}
              <textarea readOnly value={draft.connection_note} rows={3} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => copy(draft.connection_note, 'note')}>
              {copied === 'note' ? t('prospects.copiedLabel', locale) : t('prospects.copyNoteButton', locale)}
            </button>

            <label style={{ marginTop: '1rem' }}>
              {t('prospects.firstMessageLabel', locale)}
              <textarea readOnly value={draft.first_message} rows={4} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => copy(draft.first_message, 'message')}>
              {copied === 'message' ? t('prospects.copiedLabel', locale) : t('prospects.copyMessageButton', locale)}
            </button>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn-primary" onClick={onClose}>{t('common.close', locale)}</button>
        </div>
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
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 480px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0 0 0.6rem;
        }
        .hint {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 0 0 1.2rem;
          line-height: 1.4;
        }
        .li-profile-link {
          display: inline-block;
          color: var(--accent);
          font-size: 0.82rem;
          margin-bottom: 1rem;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
          margin-bottom: 0.5rem;
        }
        textarea {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.82rem;
        }
        .muted {
          color: var(--muted);
          font-size: 0.82rem;
        }
        .small {
          font-size: 0.78rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
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
          padding: 0.45rem 0.8rem;
          font-size: 0.8rem;
          cursor: pointer;
          margin-bottom: 0.8rem;
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
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
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
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
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
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {l.toUpperCase()}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
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
            <span className="nav-icon">🚪</span>
            <span className="nav-label">{t('common.logout', locale)}</span>
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
