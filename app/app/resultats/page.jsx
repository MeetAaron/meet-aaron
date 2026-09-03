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
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import { countPipeline, derivePipelinePosition, stageOrder, PIPELINE_COLORS, PIPELINE_STAGES, CATEGORY_ICONS } from '@/lib/pipeline';
import Stories from '@/components/Stories';
import { MiniBarChart } from '@/components/charts/MiniBarChart';

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

// Sélecteur de période (#88, puis #122 CHANGEMENTS A FAIRE item 25 le
// 2026-08-20) — chaque catégorie (Prospects / Opportunités / Clients) a
// maintenant son propre sélecteur indépendant, avec les 4 fenêtres demandées
// explicitement par Alex : depuis le début, ce mois-ci, cette année, ou une
// période personnalisée (du/au). 'all' reste la valeur par défaut pour ne
// rien changer au comportement précédent tant que le commercial n'a pas
// explicitement resserré.
const PERIODS = ['all', 'month', 'year', 'custom'];
const PERIOD_KEYS = {
  all: 'results.periodAll',
  month: 'results.periodMonth',
  year: 'results.periodYear',
  custom: 'results.periodCustom',
};
const RESULT_CATEGORIES = ['prospects', 'opportunities', 'clients'];

function periodRangeFor(periodValue, custom) {
  const now = new Date();
  if (periodValue === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  }
  if (periodValue === 'year') {
    return { start: new Date(now.getFullYear(), 0, 1), end: null };
  }
  if (periodValue === 'custom') {
    return {
      start: custom && custom.from ? new Date(custom.from) : null,
      end: custom && custom.to ? new Date(`${custom.to}T23:59:59`) : null,
    };
  }
  return { start: null, end: null }; // 'all' — depuis le début
}

function withinRange(dateValue, range) {
  if (!range.start && !range.end) return true;
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
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

// Historique de rapports (CHANGEMENTS A FAIRE #137, item A1) et bilan par
// catégorie (item A3) — découpage en périodes jour (minuit à minuit),
// semaine (lundi à dimanche) ou mois (calendaire), les plus récentes en
// premier. `now` est un paramètre (plutôt que new Date() en dur) pour que le
// composant reste facilement testable/prévisible.
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function reportBuckets(type, count, now) {
  const ref = now || new Date();
  const buckets = [];
  for (let i = 0; i < count; i++) {
    if (type === 'week') {
      const start = startOfWeek(ref);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      end.setMilliseconds(-1);
      buckets.push({ start, end, key: start.toISOString().slice(0, 10) });
    } else if (type === 'month') {
      const start = startOfMonth(ref);
      start.setMonth(start.getMonth() - i);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      end.setMilliseconds(-1);
      buckets.push({ start, end, key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` });
    } else {
      const start = startOfDay(ref);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      end.setMilliseconds(-1);
      buckets.push({ start, end, key: start.toISOString().slice(0, 10) });
    }
  }
  return buckets;
}

// Ne garde que les périodes qui recoupent effectivement la période choisie
// pour la catégorie (item A3 : "tout en gardant la période") — évite
// d'afficher un bilan jour/semaine/mois qui déborde avant le début de la
// période sélectionnée par le commercial.
function bucketsWithinRange(type, range, count, now) {
  const all = reportBuckets(type, count, now);
  if (!range.start) return all;
  return all.filter((b) => b.end >= range.start);
}

function reportTypeLabel(type, locale) {
  if (type === 'week') return t('results.reportTabWeek', locale);
  if (type === 'month') return t('results.reportTabMonth', locale);
  return t('results.reportTabDay', locale);
}

function reportLabel(type, bucket, locale) {
  const typeLabel = reportTypeLabel(type, locale);
  if (type === 'month') {
    return `${typeLabel} — ${bucket.start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}`;
  }
  if (type === 'week') {
    return `${typeLabel} — ${bucket.start.toLocaleDateString(locale)} / ${bucket.end.toLocaleDateString(locale)}`;
  }
  return `${typeLabel} — ${bucket.start.toLocaleDateString(locale)}`;
}

// Résumé chiffré d'une période — même logique que
// lib/results-report.ts::computePeriodSummary (côté serveur, pour le
// téléchargement), mais réutilise les données déjà chargées par la page
// plutôt que de refaire des requêtes.
function summarizeRange(range, data) {
  const { prospects, appointments, deals, customers } = data;
  const prospectsInRange = prospects.filter((p) => withinRange(p.created_at || p.updated_at, range));
  const apptsInRange = appointments.filter((a) => withinRange(a.proposed_at, range));
  const rdvObtenus = apptsInRange.filter((a) => a.status === 'validé' || a.status === 'terminé').length;
  const rdvEnAttente = apptsInRange.filter((a) => a.status === 'proposé').length;
  const tauxConversion = prospectsInRange.length > 0 ? Math.round((rdvObtenus / prospectsInRange.length) * 100) : 0;
  const dealsInRange = deals.filter((d) => withinRange(d.deal_stage_updated_at, range));
  const opportunitesGagnees = dealsInRange.filter((d) => d.deal_stage === 'signe').length;
  const opportunitesPerdues = dealsInRange.filter((d) => d.deal_stage === 'perdu').length;
  const customersInRange = customers.filter((c) => withinRange(c.won_at, range));
  return {
    prospectsContactes: prospectsInRange.length,
    rdvObtenus,
    rdvEnAttente,
    tauxConversion,
    opportunitesGagnees,
    opportunitesPerdues,
    clientsGagnes: customersInRange.length,
  };
}

// Évolution/comparaison de performance (item A2) — fenêtre glissante (1
// mois/6 mois/1 an) ou dates personnalisées, comparée à la fenêtre
// équivalente immédiatement précédente (même durée, juste avant).
function evolutionRangeFor(window, custom, now) {
  const ref = now || new Date();
  if (window === 'custom') {
    if (!custom.from) return null;
    const end = custom.to ? new Date(`${custom.to}T23:59:59`) : ref;
    const start = new Date(custom.from);
    const durationMs = Math.max(end.getTime() - start.getTime(), 0);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { current: { start, end }, previous: { start: prevStart, end: prevEnd } };
  }
  const months = window === '6m' ? 6 : window === '1y' ? 12 : 1;
  const start = new Date(ref);
  start.setMonth(start.getMonth() - months);
  const prevStart = new Date(start);
  prevStart.setMonth(prevStart.getMonth() - months);
  const prevEnd = new Date(start.getTime() - 1);
  return { current: { start, end: ref }, previous: { start: prevStart, end: prevEnd } };
}

// Bilan jour/semaine/mois compact pour une catégorie (item A3) — une rangée
// de mini-cartes (valeur + date), la plus récente à droite, complétée par un
// petit graphique en barres (tâche #129 piste 3 : vraie dataviz). Le
// graphique est un composant div/CSS interne (components/charts/MiniBarChart),
// aucune dépendance de charting externe ajoutée — cohérent avec le reste de
// la page (StatCard/cat-stat-card).
function BilanRow({ label, type, onTypeChange, rows, locale }) {
  const chronological = [...rows].reverse();
  return (
    <div className="bilan-row">
      <div className="bilan-head">
        <span className="bilan-label">{label}</span>
        <div className="bilan-toggle">
          {['day', 'week', 'month'].map((ty) => (
            <button
              key={ty}
              type="button"
              className={`bilan-btn${type === ty ? ' active' : ''}`}
              onClick={() => onTypeChange(ty)}
            >
              {reportTypeLabel(ty, locale)}
            </button>
          ))}
        </div>
      </div>
      {chronological.length > 0 && (
        <div className="bilan-chart">
          <MiniBarChart
            data={chronological.map(({ bucket, value }) => ({
              key: bucket.key,
              label:
                type === 'month'
                  ? bucket.start.toLocaleDateString(locale, { month: 'short' })
                  : bucket.start.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
              value,
            }))}
          />
        </div>
      )}
      <div className="bilan-buckets">
        {rows.length === 0 ? (
          <span className="muted bilan-empty">—</span>
        ) : (
          [...rows].reverse().map(({ bucket, value }) => (
            <div className="bilan-bucket" key={bucket.key}>
              <span className="bilan-value">{value}</span>
              <span className="bilan-date">
                {type === 'month'
                  ? bucket.start.toLocaleDateString(locale, { month: 'short' })
                  : bucket.start.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>
      <style jsx>{`
        .bilan-row {
          margin-top: 1.2rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .bilan-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
          flex-wrap: wrap;
          margin-bottom: 0.6rem;
        }
        .bilan-label {
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--muted);
        }
        .bilan-toggle {
          display: flex;
          gap: 0.3rem;
        }
        .bilan-btn {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.25rem 0.65rem;
          font-size: 0.72rem;
          cursor: pointer;
        }
        .bilan-btn.active {
          background: rgba(75, 57, 239, 0.18);
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        .bilan-chart {
          margin-bottom: 0.6rem;
        }
        .bilan-buckets {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .bilan-bucket {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.15rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.6rem;
          min-width: 46px;
        }
        .bilan-value {
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.9rem;
        }
        .bilan-date {
          font-size: 0.62rem;
          color: var(--muted);
        }
        .bilan-empty {
          font-size: 0.78rem;
        }
      `}</style>
    </div>
  );
}

function EvolutionMetric({ label, current, previous, suffix }) {
  const delta = current - previous;
  const pct = previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—';
  return (
    <div className="evolution-metric">
      <span className="evolution-label">{label}</span>
      <span className="evolution-value">
        {current}
        {suffix || ''}
      </span>
      <span className={`evolution-delta ${direction}`}>
        {arrow} {delta > 0 ? '+' : ''}
        {delta}
        {suffix || ''} ({pct > 0 ? '+' : ''}
        {pct}%)
      </span>
    </div>
  );
}

export default function ResultatsPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  // Docx Modifs Aaron (30/08/2026, "Mes résultats") : la section Clients est
  // supprimée pour tous les comptes sauf aaron@meetaaron.app (client = étape
  // ultime d'Opportunité). null tant que l'email n'est pas chargé → masqué
  // par défaut.
  const [userEmail, setUserEmail] = useState(null);
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => setUserEmail((body.preferences || {}).email || null))
      .catch(() => {});
  }, [userId]);
  const showClientsSection = userEmail === 'aaron@meetaaron.app';
  const [prospects, setProspects] = useState([]);
  // Fusion pipeline (lot 4) : TOUS les contacts (clients inclus) pour
  // l'entonnoir et la vitesse par étape — sans toucher aux stats existantes.
  const [allContacts, setAllContacts] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [deals, setDeals] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [replyRate, setReplyRate] = useState(null);
  const [loading, setLoading] = useState(true);
  // Un sélecteur de période par catégorie (item 25) — plus le sélecteur
  // unique partagé d'avant, qui ne s'appliquait qu'à "Prospects" en pratique
  // (Alex : "tu dois mettre la période pour chacune des 3 catégories, pas
  // juste pour prospect").
  const [periods, setPeriods] = useState({ prospects: 'all', opportunities: 'all', clients: 'all' });
  const [customRanges, setCustomRanges] = useState({
    prospects: { from: '', to: '' },
    opportunities: { from: '', to: '' },
    clients: { from: '', to: '' },
  });

  // Historique de rapports (#137 item A1) : onglet jour/semaine/mois, et
  // "agrandir" pour révéler plus que les 5 rapports les plus récents.
  const [reportTab, setReportTab] = useState('day');
  const [reportsExpanded, setReportsExpanded] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(null);

  // Évolution/comparaison de performance (#137 item A2).
  const [evolutionWindow, setEvolutionWindow] = useState('1m');
  const [evolutionCustom, setEvolutionCustom] = useState({ from: '', to: '' });

  // Bilan jour/semaine/mois par catégorie (#137 item A3) — un choix
  // indépendant par catégorie, en plus (et non à la place) du sélecteur de
  // période déjà existant pour chacune.
  const [bilanTypes, setBilanTypes] = useState({ prospects: 'day', opportunities: 'day', clients: 'day' });
  function updateBilanType(category, value) {
    setBilanTypes((prev) => ({ ...prev, [category]: value }));
  }

  function updatePeriod(category, value) {
    setPeriods((prev) => ({ ...prev, [category]: value }));
  }
  function updateCustomRange(category, field, value) {
    setCustomRanges((prev) => ({ ...prev, [category]: { ...prev[category], [field]: value } }));
  }

  const prospectsCustom = customRanges.prospects;

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    // Le taux de réponse (/api/reply-rate) est calculé côté serveur sur un
    // historique de messages potentiellement volumineux — seule la borne de
    // début ("since") lui est envoyée (l'API ne supporte pas de borne de
    // fin), suivant la période choisie pour la catégorie Prospects.
    const prospectsRange = periodRangeFor(periods.prospects, prospectsCustom);
    const sinceParam = prospectsRange.start ? `&since=${encodeURIComponent(prospectsRange.start.toISOString())}` : '';
    Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/prospects?user_id=${userId}&scope=all`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/reply-rate?user_id=${userId}${sinceParam}`).then((r) => r.json()),
    ]).then(([pRes, allRes, aRes, cRes, dRes, cuRes, rRes]) => {
      setProspects(pRes.prospects || []);
      setAllContacts((allRes && allRes.prospects) || []);
      setAppointments(aRes.appointments || []);
      setCampaigns(cRes.campaigns || []);
      setDeals(dRes.deals || []);
      setCustomers(cuRes.customers || []);
      setReplyRate(rRes.reply_rate ?? null);
      setLoading(false);
    });
  }, [userId, periods.prospects, prospectsCustom.from, prospectsCustom.to]);

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

  // Compteurs de la ligne de progression, sur TOUS les contacts (pas
  // seulement la fenêtre de période) : la question posée par cette section
  // est « où en est mon portefeuille aujourd'hui », pas « qu'ai-je fait ce
  // mois-ci » — c'est le rôle des bilans et de l'évolution juste en dessous.
  const pipelineCounts = countPipeline(allContacts);

  // Valeur du portefeuille (01/09/2026) : seule source de montant fiable et
  // non inventée — le total TTC qu'Aaron a relevé sur le devis DÉPOSÉ par le
  // commercial (prospects.devis_check.total_ttc_eur, voir
  // app/api/prospects/[id]/devis/upload). Aucune estimation, aucune
  // extrapolation : un contact sans devis déposé ne compte pour rien, et si
  // aucun montant n'est connu on affiche une explication plutôt qu'un 0 €
  // trompeur.
  const contactAmount = (p) => {
    const v = p?.devis_check?.total_ttc_eur;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  };
  const pipelineValue = (() => {
    let signed = 0;
    let signedCount = 0;
    let inPlay = 0;
    let known = 0;
    for (const p of allContacts) {
      const amount = contactAmount(p);
      if (amount > 0) known += 1;
      const pos = derivePipelinePosition(p);
      if (pos.lost) continue;
      if (pos.stage === 'client') {
        signed += amount;
        if (amount > 0) signedCount += 1;
      } else if (pos.category === 'opportunite') {
        inPlay += amount;
      }
    }
    return { signed, inPlay, known, average: signedCount > 0 ? Math.round(signed / signedCount) : 0 };
  })();
  const formatEur = (n) =>
    new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
  const OPPORTUNITY_META = opportunityBucketMetaFor(locale);
  const HEALTH_META = healthBucketMetaFor(locale);
  const prospectsRange = periodRangeFor(periods.prospects, customRanges.prospects);
  const opportunitiesRange = periodRangeFor(periods.opportunities, customRanges.opportunities);
  const clientsRange = periodRangeFor(periods.clients, customRanges.clients);

  // Catégorie Prospects — prospects contactés pendant la période (via leur
  // date de création, avec repli sur la dernière mise à jour si l'historique
  // ne connaît pas encore la vraie date de création) et RDV associés,
  // filtrés par la date proposée du RDV.
  const prospectsInPeriod = prospects.filter((p) => withinRange(p.created_at || p.updated_at, prospectsRange));
  const appointmentsInPeriod = appointments.filter((a) => withinRange(a.proposed_at, prospectsRange));
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

  const campaignsInPeriod = campaigns.filter((c) => withinRange(c.created_at, prospectsRange));
  const contactsSources = campaignsInPeriod.reduce((sum, c) => sum + (c.contacts_found || 0), 0);
  const entreprisesAnalysees = campaignsInPeriod.reduce((sum, c) => sum + (c.companies_found || 0), 0);
  const tauxContact = entreprisesAnalysees > 0 ? Math.round((contactsSources / entreprisesAnalysees) * 100) : 0;

  // Catégorie Opportunités — filtrée sur la date de dernière mise à jour
  // d'étape, pour ne compter que les affaires ayant bougé sur la période.
  const dealsInPeriod = deals.filter((d) => withinRange(d.deal_stage_updated_at, opportunitiesRange));
  const opportunityCounts = Object.keys(OPPORTUNITY_META).reduce((acc, key) => {
    acc[key] = dealsInPeriod.filter((d) => opportunityBucketFor(d) === key).length;
    return acc;
  }, {});

  // Catégorie Clients — filtrée sur la date de gain (won_at), pour ne
  // compter que les clients gagnés sur la période, répartis par santé
  // actuelle.
  const customersInPeriod = customers.filter((c) => withinRange(c.won_at, clientsRange));
  const healthCounts = Object.keys(HEALTH_META).reduce((acc, key) => {
    acc[key] = customersInPeriod.filter((c) => healthBucketFor(c) === key).length;
    return acc;
  }, {});

  // Historique de rapports (item A1) — retour Alex (2026-08-21) : une
  // période sans la moindre activité (0 prospect contacté, 0 RDV, 0
  // opportunité, 0 client) n'est pas "un rapport", donc ne doit pas
  // apparaître dans la liste — sinon un compte tout neuf affiche 5 lignes à
  // zéro plutôt qu'un message clair. On regarde donc plus loin en arrière
  // (REPORT_LOOKBACK périodes candidates) et on ne garde que celles avec au
  // moins une donnée non nulle, les plus récentes d'abord ; "Voir tout" /
  // "Voir moins" bascule entre 5 et la totalité de cet historique filtré.
  const rangeData = { prospects, appointments, deals, customers };
  const REPORT_LOOKBACK = { day: 60, week: 52, month: 24 };
  function reportHasActivity(summary) {
    return (
      summary.prospectsContactes > 0 ||
      summary.rdvObtenus > 0 ||
      summary.rdvEnAttente > 0 ||
      summary.opportunitesGagnees > 0 ||
      summary.opportunitesPerdues > 0 ||
      summary.clientsGagnes > 0
    );
  }
  const activeReportRows = reportBuckets(reportTab, REPORT_LOOKBACK[reportTab] || 60)
    .map((bucket) => ({ bucket, summary: summarizeRange({ start: bucket.start, end: bucket.end }, rangeData) }))
    .filter(({ summary }) => reportHasActivity(summary));
  const reportRows = reportsExpanded ? activeReportRows : activeReportRows.slice(0, 5);

  async function downloadReport(bucket, format) {
    const key = `${reportTab}-${bucket.key}-${format}`;
    setDownloadingKey(key);
    try {
      const res = await fetch('/api/results/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          type: reportTab,
          period_start: bucket.start.toISOString(),
          period_end: bucket.end.toISOString(),
          format,
          title: reportLabel(reportTab, bucket, locale),
        }),
      });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-${reportTab}-${bucket.key}.${format === 'csv' ? 'csv' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // Best-effort — un échec ponctuel de téléchargement ne doit pas
      // bloquer le reste de la page.
    } finally {
      setDownloadingKey(null);
    }
  }

  // Évolution/comparaison de performance (item A2).
  const evolutionRanges = evolutionRangeFor(evolutionWindow, evolutionCustom);
  const evolutionCurrent = evolutionRanges ? summarizeRange(evolutionRanges.current, rangeData) : null;
  const evolutionPrevious = evolutionRanges ? summarizeRange(evolutionRanges.previous, rangeData) : null;

  // Bilan par catégorie (item A3), contraint à la période déjà choisie pour
  // cette catégorie.
  const bilanProspects = bucketsWithinRange(bilanTypes.prospects, prospectsRange, 6).map((bucket) => ({
    bucket,
    value: prospects.filter((p) => withinRange(p.created_at || p.updated_at, { start: bucket.start, end: bucket.end })).length,
  }));
  const bilanOpportunities = bucketsWithinRange(bilanTypes.opportunities, opportunitiesRange, 6).map((bucket) => ({
    bucket,
    value: deals.filter(
      (d) => d.deal_stage === 'signe' && withinRange(d.deal_stage_updated_at, { start: bucket.start, end: bucket.end })
    ).length,
  }));
  const bilanClients = bucketsWithinRange(bilanTypes.clients, clientsRange, 6).map((bucket) => ({
    bucket,
    value: customers.filter((c) => withinRange(c.won_at, { start: bucket.start, end: bucket.end })).length,
  }));

  return (
    <Shell active={t('nav.results', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('results.eyebrow', locale)}</p>
        <h1>{t('results.title', locale)}</h1>
      </header>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          {/* Fusion de la pipeline (docx « mon avis », 31/08/2026) : cette
              section remplace l'ancien bloc « Opportunités » qui comptait
              encore par deal_stage (signe / en_negociation / perdu) — un
              modèle qui n'existe plus depuis que prospects et opportunités
              vivent sur UNE seule ligne en 6 étapes. On compte désormais avec
              countPipeline/derivePipelinePosition, exactement comme la page
              Contacts, pour que les deux écrans ne puissent plus se
              contredire. Chaque carte est cliquable et ouvre la liste filtrée
              sur cette étape. */}
          <section className="panel category-panel">
            <div className="category-head">
              <h2>{t('results.progressTitle', locale)}</h2>
            </div>
            <p className="category-hint">{t('results.progressHint', locale)}</p>
            <div className="progress-row">
              {PIPELINE_STAGES.map((stage) => (
                <a
                  className="progress-card"
                  key={stage.key}
                  href={`/app/prospects?stage=${stage.key}`}
                  title={t(stage.hintKey, locale)}
                >
                  {/* Même traitement que la ligne de progression de Contacts
                      (01/09/2026) : pastille creuse, pleine seulement si des
                      contacts sont à cette étape. */}
                  <span
                    className="progress-icon"
                    style={
                      (pipelineCounts.byStage[stage.key] || 0) > 0
                        ? { background: PIPELINE_COLORS[stage.category], borderColor: PIPELINE_COLORS[stage.category] }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  <span className="stat-number">{pipelineCounts.byStage[stage.key] || 0}</span>
                  <span className="stat-label">{t(stage.labelKey, locale)}</span>
                </a>
              ))}
            </div>
            {/* Valeur du portefeuille — la question que se pose vraiment un
                commercial devant une page « Résultats ». Affichée dans la
                même section que la ligne de progression parce qu'elle en est
                la lecture en euros. */}
            <div className="value-block">
              <p className="value-title">{t('results.valueTitle', locale)}</p>
              {pipelineValue.known === 0 ? (
                <p className="muted value-empty">{t('results.valueEmpty', locale)}</p>
              ) : (
                <>
                  <div className="value-row">
                    <div className="value-card">
                      <span className="value-amount">{formatEur(pipelineValue.signed)}</span>
                      <span className="stat-label">{t('results.valueSigned', locale)}</span>
                    </div>
                    <div className="value-card">
                      <span className="value-amount">{formatEur(pipelineValue.inPlay)}</span>
                      <span className="stat-label">{t('results.valueInPlay', locale)}</span>
                    </div>
                    <div className="value-card">
                      <span className="value-amount">{formatEur(pipelineValue.average)}</span>
                      <span className="stat-label">{t('results.valueAverage', locale)}</span>
                    </div>
                  </div>
                  <p className="muted value-empty">{t('results.valueHint', locale)}</p>
                </>
              )}
            </div>

            <div className="progress-row progress-row-extra">
              <a className="progress-card progress-card-alert" href="/app/prospects?filter=risk">
                <span className="progress-icon progress-icon-flat">⚠️</span>
                <span className="stat-number">{pipelineCounts.risk}</span>
                <span className="stat-label">{t('results.progressRisk', locale)}</span>
              </a>
              <a className="progress-card progress-card-alert" href="/app/prospects?filter=lost">
                <span className="progress-icon progress-icon-flat">✕</span>
                <span className="stat-number">{pipelineCounts.lost}</span>
                <span className="stat-label">{t('results.progressLost', locale)}</span>
              </a>
            </div>

            <BilanRow
              label={`${t('results.bilanLabel', locale)} — ${t('results.reportMetricOpportunitesGagnees', locale)}`}
              type={bilanTypes.opportunities}
              onTypeChange={(v) => updateBilanType('opportunities', v)}
              rows={bilanOpportunities}
              locale={locale}
            />
          </section>
          <section className="panel category-panel">
            <div className="category-head">
              <h2>{t('results.activityTitle', locale)}</h2>
              <PeriodPicker
                value={periods.prospects}
                custom={customRanges.prospects}
                onChange={(v) => updatePeriod('prospects', v)}
                onCustomChange={(field, v) => updateCustomRange('prospects', field, v)}
                locale={locale}
              />
            </div>
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

            <BilanRow
              label={`${t('results.bilanLabel', locale)} — ${t('results.reportMetricProspects', locale)}`}
              type={bilanTypes.prospects}
              onTypeChange={(v) => updateBilanType('prospects', v)}
              rows={bilanProspects}
              locale={locale}
            />
          </section>

          {showClientsSection && (
          <section className="panel category-panel">
            <div className="category-head">
              <h2>{t('dash.clientsTitle', locale)}</h2>
              <PeriodPicker
                value={periods.clients}
                custom={customRanges.clients}
                onChange={(v) => updatePeriod('clients', v)}
                onCustomChange={(field, v) => updateCustomRange('clients', field, v)}
                locale={locale}
              />
            </div>
            <p className="category-hint">{t('results.clientsWonPeriodHint', locale)}</p>
            <div className="category-row">
              {['saine', 'non_evalue', 'a_surveiller', 'a_risque'].map((key) => (
                <div className="cat-stat-card" key={key}>
                  <span className="dot" style={{ background: HEALTH_META[key].color }} />
                  <span className="stat-number">{healthCounts[key] || 0}</span>
                  <span className="stat-label">{HEALTH_META[key].label}</span>
                </div>
              ))}
            </div>

            <BilanRow
              label={`${t('results.bilanLabel', locale)} — ${t('results.reportMetricClientsGagnes', locale)}`}
              type={bilanTypes.clients}
              onTypeChange={(v) => updateBilanType('clients', v)}
              rows={bilanClients}
              locale={locale}
            />
          </section>
          )}

          <section className="panel">
            <div className="category-head">
              <h2>{t('results.funnelTitle', locale)}</h2>
            </div>
            <p className="muted report-scope-hint">{t('results.funnelHint', locale)}</p>
            {(() => {
              const active = allContacts.filter((p) => !derivePipelinePosition(p).lost);
              const counts = countPipeline(allContacts);
              const steps = [
                { key: 'contacts', label: t('dash.funnelContacts', locale), value: active.length, color: PIPELINE_COLORS.prospect },
                { key: 'rdv', label: t('pipeline.stage.rdvObtenu', locale), value: active.filter((p) => stageOrder(derivePipelinePosition(p).stage) >= 2).length, color: PIPELINE_COLORS.opportunite },
                { key: 'propositions', label: t('dash.funnelPropositions', locale), value: active.filter((p) => stageOrder(derivePipelinePosition(p).stage) >= 3).length, color: '#b07cf5' },
                { key: 'clients', label: t('pipeline.cat.clients', locale), value: counts.byCategory.client, color: PIPELINE_COLORS.client },
              ];
              const max = steps[0].value || 1;
              const avgDays = (pairs) => {
                const vals = pairs.filter(([a, b]) => a && b).map(([a, b]) => (new Date(b) - new Date(a)) / 86400000).filter((d) => d >= 0);
                if (vals.length === 0) return null;
                return Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10;
              };
              const firstApptByProspect = {};
              for (const a of appointments) {
                if (a.purpose === 'lancement' || !a.prospect_id) continue;
                if (!firstApptByProspect[a.prospect_id] || new Date(a.proposed_at) < new Date(firstApptByProspect[a.prospect_id])) {
                  firstApptByProspect[a.prospect_id] = a.proposed_at;
                }
              }
              const speeds = [
                { key: 'toRdv', label: t('results.speedToRdv', locale), days: avgDays(allContacts.map((p) => [p.created_at, firstApptByProspect[p.id]])) },
                { key: 'toProposition', label: t('results.speedToProposition', locale), days: avgDays(allContacts.map((p) => [firstApptByProspect[p.id], p.quote_requested_at])) },
                { key: 'toEnvoi', label: t('results.speedToEnvoi', locale), days: avgDays(allContacts.map((p) => [p.quote_requested_at, p.devis_sent_at])) },
                { key: 'toClient', label: t('results.speedToClient', locale), days: avgDays(allContacts.filter((p) => p.first_order_confirmed_at).map((p) => [p.devis_sent_at || p.quote_requested_at || firstApptByProspect[p.id] || p.created_at, p.won_at])) },
              ];
              return (
                <>
                  <div className="funnel-block">
                    {steps.map((step, i) => {
                      const prev = i > 0 ? steps[i - 1].value : null;
                      const rate = prev ? Math.round((step.value / prev) * 100) : null;
                      const width = Math.max(8, Math.round((step.value / max) * 100));
                      return (
                        <div className="funnel-step" key={step.key}>
                          <div className="funnel-head">
                            <span className="funnel-label">{step.label}</span>
                            {rate != null && <span className="funnel-rate">→ {rate} %</span>}
                          </div>
                          <div className="funnel-bar-track">
                            <span className="funnel-bar" style={{ width: `${width}%`, background: step.color }}>{step.value}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="speed-row">
                    {speeds.map((sp) => (
                      <div className="speed-card" key={sp.key}>
                        <span className="speed-number">{sp.days == null ? '—' : `${sp.days} j`}</span>
                        <span className="speed-label">{sp.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="muted speed-hint">{t('results.speedHint', locale)}</p>
                </>
              );
            })()}
          </section>

          <section className="panel">
            <div className="category-head">
              <h2>{t('results.reportHistoryTitle', locale)}</h2>
            </div>
            {/* Docx 30/08 : "précise qu'il s'agit d'un rapport qui concerne
                les prospects ET les opportunités — chaque rapport contient
                les 2 éléments". */}
            <p className="muted report-scope-hint">{t('results.reportHistoryScope', locale)}</p>
            <div className="report-tabs">
              {['day', 'week', 'month'].map((ty) => (
                <button
                  key={ty}
                  type="button"
                  className={`report-tab${reportTab === ty ? ' active' : ''}`}
                  onClick={() => {
                    setReportTab(ty);
                    setReportsExpanded(false);
                  }}
                >
                  {reportTypeLabel(ty, locale)}
                </button>
              ))}
            </div>
            {activeReportRows.length === 0 ? (
              <p className="report-empty">{t('results.reportHistoryEmpty', locale)}</p>
            ) : (
            <div className="report-list">
              {reportRows.map(({ bucket, summary }) => (
                <div className="report-row" key={bucket.key}>
                  <div className="report-row-main">
                    <span className="report-row-title">{reportLabel(reportTab, bucket, locale)}</span>
                    <span className="report-row-hint">
                      {summary.prospectsContactes} {t('results.reportMetricProspects', locale).toLowerCase()} ·{' '}
                      {summary.rdvObtenus} {t('results.reportMetricRdv', locale).toLowerCase()} ·{' '}
                      {summary.opportunitesGagnees} {t('results.reportMetricOpportunitesGagnees', locale).toLowerCase()} ·{' '}
                      {summary.clientsGagnes} {t('results.reportMetricClientsGagnes', locale).toLowerCase()}
                    </span>
                  </div>
                  <div className="report-row-actions">
                    <button
                      type="button"
                      className="report-btn"
                      disabled={downloadingKey === `${reportTab}-${bucket.key}-pdf`}
                      onClick={() => downloadReport(bucket, 'pdf')}
                    >
                      {t('results.reportDownloadPdf', locale)}
                    </button>
                    <button
                      type="button"
                      className="report-btn"
                      disabled={downloadingKey === `${reportTab}-${bucket.key}-csv`}
                      onClick={() => downloadReport(bucket, 'csv')}
                    >
                      {t('results.reportDownloadCsv', locale)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}
            {activeReportRows.length > 5 && (
              <button type="button" className="report-expand-btn" onClick={() => setReportsExpanded((v) => !v)}>
                {reportsExpanded ? t('results.reportCollapse', locale) : t('results.reportExpand', locale)}
              </button>
            )}
          </section>

          <section className="panel">
            <div className="category-head">
              <h2>{t('results.evolutionTitle', locale)}</h2>
              <div className="evolution-window-row">
                {['1m', '6m', '1y', 'custom'].map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`period-btn-like${evolutionWindow === w ? ' active' : ''}`}
                    onClick={() => setEvolutionWindow(w)}
                  >
                    {t(
                      w === '1m'
                        ? 'results.evolutionWindow1m'
                        : w === '6m'
                        ? 'results.evolutionWindow6m'
                        : w === '1y'
                        ? 'results.evolutionWindow1y'
                        : 'results.evolutionWindowCustom',
                      locale
                    )}
                  </button>
                ))}
              </div>
            </div>
            {evolutionWindow === 'custom' && (
              <div className="evolution-custom-range">
                <label>
                  {t('results.evolutionFrom', locale)}
                  <input
                    type="date"
                    value={evolutionCustom.from}
                    max={evolutionCustom.to || undefined}
                    onChange={(e) => setEvolutionCustom((prev) => ({ ...prev, from: e.target.value }))}
                  />
                </label>
                <label>
                  {t('results.evolutionTo', locale)}
                  <input
                    type="date"
                    value={evolutionCustom.to}
                    min={evolutionCustom.from || undefined}
                    onChange={(e) => setEvolutionCustom((prev) => ({ ...prev, to: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {evolutionCurrent && evolutionPrevious ? (
              <>
                <p className="category-hint">{t('results.evolutionVsPrevious', locale)}</p>
                <div className="evolution-grid">
                  <EvolutionMetric
                    label={t('results.reportMetricProspects', locale)}
                    current={evolutionCurrent.prospectsContactes}
                    previous={evolutionPrevious.prospectsContactes}
                  />
                  <EvolutionMetric
                    label={t('results.reportMetricRdv', locale)}
                    current={evolutionCurrent.rdvObtenus}
                    previous={evolutionPrevious.rdvObtenus}
                  />
                  <EvolutionMetric
                    label={t('results.statConversionRate', locale)}
                    current={evolutionCurrent.tauxConversion}
                    previous={evolutionPrevious.tauxConversion}
                    suffix="%"
                  />
                  <EvolutionMetric
                    label={t('results.reportMetricOpportunitesGagnees', locale)}
                    current={evolutionCurrent.opportunitesGagnees}
                    previous={evolutionPrevious.opportunitesGagnees}
                  />
                  <EvolutionMetric
                    label={t('results.reportMetricClientsGagnes', locale)}
                    current={evolutionCurrent.clientsGagnes}
                    previous={evolutionPrevious.clientsGagnes}
                  />
                </div>
              </>
            ) : (
              <p className="muted">{t('results.reportNoneYet', locale)}</p>
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
        .category-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          margin-bottom: 0.3rem;
        }
        .category-head h2 {
          margin: 0;
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
        /* Ligne de progression en 6 étapes (01/09/2026) — remplace l'ancienne
           grille « Opportunités » par deal_stage. Cartes cliquables : <a>
           natif et non <Link>, car styled-jsx n'applique pas la classe de
           scope au className d'un <Link>. */
        .progress-row {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 0.6rem;
        }
        .progress-row-extra {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          max-width: 340px;
          margin-top: 0.6rem;
        }
        .progress-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          text-decoration: none;
          color: inherit;
          transition: border-color 0.15s ease, transform 0.15s ease;
        }
        .progress-card:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
        }
        .progress-icon {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid var(--border);
          background: transparent;
          margin-bottom: 0.45rem;
        }
        .progress-icon-flat {
          width: auto;
          height: auto;
          border: 0;
          background: transparent;
          font-size: 0.95rem;
          line-height: 1;
        }
        .progress-card-alert .stat-label {
          color: var(--muted);
        }
        .value-block {
          margin-top: 1.2rem;
          padding-top: 1.1rem;
          border-top: 1px solid var(--border);
        }
        .value-title {
          font-size: 0.86rem;
          font-weight: 600;
          margin: 0 0 0.7rem;
        }
        .value-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.6rem;
        }
        .value-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .value-amount {
          font-family: var(--font-mono);
          font-size: 1.25rem;
          font-weight: 600;
        }
        .value-empty {
          font-size: 0.8rem;
          line-height: 1.5;
          margin: 0.6rem 0 0;
        }
        @media (max-width: 620px) {
          .value-row {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 900px) {
          .progress-row {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 520px) {
          .progress-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
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
        .report-scope-hint {
          margin: -0.2rem 0 0.7rem;
          font-size: 0.84rem;
        }
        .funnel-block { margin-bottom: 1.2rem; }
        .funnel-step { margin-bottom: 0.55rem; }
        .funnel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.25rem; }
        .funnel-label { font-size: 0.78rem; color: var(--muted); }
        .funnel-rate { font-size: 0.74rem; font-family: var(--font-mono); color: var(--text); }
        .funnel-bar-track { background: var(--bg); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
        .funnel-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-width: 2.2rem;
          height: 22px;
          border-radius: 999px;
          color: #0a0c17;
          font-size: 0.76rem;
          font-weight: 700;
          padding: 0 0.6rem;
          box-sizing: border-box;
        }
        .speed-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.6rem; }
        .speed-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.7rem 0.8rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .speed-number { font-family: var(--font-display); font-size: 1.25rem; font-weight: 700; }
        .speed-label { font-size: 0.72rem; color: var(--muted); line-height: 1.25; }
        .speed-hint { font-size: 0.72rem; margin: 0.6rem 0 0; }
        .report-tabs {
          display: flex;
          gap: 0.4rem;
          margin-bottom: 1rem;
        }
        .report-tab {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.35rem 0.9rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .report-tab.active {
          background: rgba(75, 57, 239, 0.18);
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        .report-list {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .report-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.8rem 1rem;
        }
        .report-row-main {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          min-width: 0;
        }
        .report-row-title {
          font-weight: 600;
          font-size: 0.88rem;
        }
        .report-row-hint {
          font-size: 0.74rem;
          color: var(--muted);
        }
        .report-row-actions {
          display: flex;
          gap: 0.4rem;
          flex-shrink: 0;
        }
        .report-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.75rem;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
        }
        .report-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .report-empty {
          color: var(--muted);
          font-size: 0.88rem;
          text-align: center;
          padding: 1.5rem 1rem;
          margin: 0;
        }
        .report-expand-btn {
          margin-top: 0.9rem;
          background: none;
          border: none;
          color: var(--accent);
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
        }
        .evolution-window-row {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .period-btn-like {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.35rem 0.8rem;
          font-size: 0.76rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .period-btn-like.active {
          background: rgba(75, 57, 239, 0.18);
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        .evolution-custom-range {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }
        .evolution-custom-range label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.7rem;
          color: var(--muted);
        }
        .evolution-custom-range input {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          padding: 0.3rem 0.5rem;
          font-size: 0.78rem;
          font-family: inherit;
        }
        .evolution-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 0.9rem;
        }
        .evolution-metric {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .evolution-label {
          font-size: 0.76rem;
          color: var(--muted);
        }
        .evolution-value {
          font-family: var(--font-mono);
          font-size: 1.4rem;
          font-weight: 600;
        }
        .evolution-delta {
          font-size: 0.76rem;
          font-weight: 600;
        }
        .evolution-delta.up {
          color: var(--accent-green, #3dd68c);
        }
        .evolution-delta.down {
          color: var(--accent-red, #e5484d);
        }
        .evolution-delta.flat {
          color: var(--muted);
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

// Sélecteur de période par catégorie (item 25) — 4 boutons + un repli "du/au"
// quand "Personnalisé" est choisi. Un composant séparé pour pouvoir en poser
// un par catégorie (Prospects/Opportunités/Clients) sans dupliquer le JSX.
function PeriodPicker({ value, custom, onChange, onCustomChange, locale }) {
  return (
    <div className="period-picker">
      <div className="period-buttons">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={`period-btn${value === p ? ' active' : ''}`}
            onClick={() => onChange(p)}
          >
            {t(PERIOD_KEYS[p], locale)}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div className="custom-range">
          <label>
            {t('results.customFrom', locale)}
            <input
              type="date"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => onCustomChange('from', e.target.value)}
            />
          </label>
          <label>
            {t('results.customTo', locale)}
            <input
              type="date"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => onCustomChange('to', e.target.value)}
            />
          </label>
        </div>
      )}
      <style jsx>{`
        .period-picker {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
        }
        .period-buttons {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .period-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.35rem 0.8rem;
          font-size: 0.76rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .period-btn.active {
          background: rgba(75, 57, 239, 0.18);
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        .custom-range {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .custom-range label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.7rem;
          color: var(--muted);
        }
        .custom-range input {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          padding: 0.3rem 0.5rem;
          font-size: 0.78rem;
          font-family: inherit;
        }
        @media (max-width: 640px) {
          .period-picker {
            align-items: flex-start;
          }
          .period-buttons,
          .custom-range {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
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
