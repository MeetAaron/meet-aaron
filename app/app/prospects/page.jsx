// app/app/prospects/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import { frenchTypography } from '@/lib/text-typography';
import CsvImportModal from '@/components/CsvImportModal';
import ExportFormatMenu from '@/components/ExportFormatMenu';
import CompanyInfoEditor from '@/components/CompanyInfoEditor';
import ContactInfoEditor from '@/components/ContactInfoEditor';
import { downloadSpreadsheet } from '@/lib/xlsx-io';

// Étapes du pipeline Aaron Opportunité (voir NON_TERMINAL_STAGES dans
// app/app/sales/page.jsx) considérées "en cours de traitement" : un
// prospect qui y entre est désormais suivi dans Aaron Opportunité et ne
// doit plus apparaître dans la liste brute des prospects, pour éviter le
// doublon d'affichage entre les deux pages. Les étapes terminales (signé /
// perdu) restent visibles ici, cohérent avec le badge "🏆 Gagné" existant
// et avec le traitement des prospects perdus depuis cette page elle-même
// (action marquer_perdu, qui ne touche pas deal_stage).
const NON_TERMINAL_DEAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];

// Demande d'Alex (docx CHANGEMENTS A FAIRE, item A1, 2026-08-20) : dans les
// tableaux, le texte long (avis d'Aaron, notes de personnalité) s'affichait
// en entier — "indigeste" selon ses mots. On n'affiche donc plus qu'un
// échantillon du début, avec un bouton pour dérouler le texte complet si le
// commercial le souhaite.
const TRUNCATE_LENGTH = 90;
// docx item 14 (2026-08-27, remonté par Alex) : "Conseil d'Aaron" prenait
// encore trop de lignes dans la vue tableau compacte/globale malgré la
// troncature ci-dessus (90 caractères ~= 4 lignes vu la largeur de colonne
// .advice, max-width: 26ch). Longueur dédiée, plus courte, pour cette seule
// colonne — le panneau détaillé "Voir plus" (ligne ~1438) continue d'afficher
// le texte intégral, inchangé, comme Alex le souhaite explicitement.
const ADVICE_TRUNCATE_LENGTH = 55;

// Demande Alex (2026-08-22) : voir depuis quand un prospect est dans sa
// catégorie actuelle (colonne "Depuis") — même helper que sales/page.jsx et
// customer/page.jsx (daysSince), appliqué ici à prospects.status_updated_at
// (nouvelle colonne, voir migration_status_updated_at_2026-08-22.sql).
function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// Demande Alex (2026-08-26, capture d'écran à l'appui) : l'ancienne version
// dépliait le texte complet EN PLACE, dans la même cellule de tableau large
// de 26ch (voir .advice ci-dessous) — résultat illisible, une quasi-phrase
// par ligne. "Voir plus" ouvre désormais la fiche complète du prospect
// (ConversationModal, déjà utilisée par le bouton "Conversation" — voir
// setThreadProspect passé ici via onExpand), qui affiche ce même texte dans
// un cadre large de 600px et sans contrainte de largeur (.advice-line) :
// beaucoup plus lisible, et cohérent avec ce que le commercial voit déjà en
// ouvrant la conversation.
function TruncatedText({ text, locale, onExpand, maxLength = TRUNCATE_LENGTH }) {
  if (!text) return <span className="muted">—</span>;
  // Typographie (demande Alex, 29/08/2026) : texte généré par Aaron
  // (notes_personnalite, avis) — voir lib/text-typography.js.
  const displayText = frenchTypography(text);
  if (text.length <= maxLength) return <>{displayText}</>;

  return (
    <>
      {frenchTypography(`${text.slice(0, maxLength).trimEnd()}…`)}
      {' '}
      <button type="button" className="truncate-toggle" onClick={onExpand}>
        {t('common.seeMore', locale)}
      </button>
    </>
  );
}

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

// Couleurs DISC standard (méthode des 4 couleurs) — reprises pour que le
// profil de personnalité ressentie se reconnaisse visuellement d'un coup
// d'œil, sans avoir à lire le libellé : Dominant = rouge, Influent = jaune,
// Stable = vert, Consciencieux = bleu.
const PERSONALITY_COLORS = {
  dominant: '#E5484D',
  influent: '#E5B93A',
  stable: '#3DA35D',
  consciencieux: '#4B9EF0',
};

function personalityTagStyle(type) {
  const color = PERSONALITY_COLORS[type];
  if (!color) return undefined;
  return { border: `1px solid ${color}`, color };
}

function personalityColorLegendFor(locale) {
  return t('prospects.personalityColorLegend', locale);
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
  const STATUS_META = statusMetaFor(locale);
  const PERSONALITY_LABELS = personalityLabelsFor(locale);
  const PERSONALITY_COLOR_LEGEND = personalityColorLegendFor(locale);
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('tous');
  const [companyId, setCompanyId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [linkedinProspect, setLinkedinProspect] = useState(null);
  const [wonProspect, setWonProspect] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [search, setSearch] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [threadProspect, setThreadProspect] = useState(null);
  const [pendingEmailProspect, setPendingEmailProspect] = useState(null);

  // Demande Alex (27/08/2026) : "je suis obligé de descendre tout en bas"
  // pour atteindre la barre de défilement horizontale du tableau (qui
  // n'existait qu'en bas de .table-wrap, donc hors écran sur une longue
  // liste). On ajoute une deuxième barre, fine, juste au-dessus du tableau
  // (donc toujours visible sans scroller la page), synchronisée dans les
  // deux sens avec le défilement réel du tableau via ces deux refs — un
  // simple <div> vide dimensionné à la largeur réelle du contenu (scrollWidth)
  // suffit à donner à cette barre du haut quelque chose à faire défiler.
  const tableWrapRef = useRef(null);
  const topScrollRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    function syncTableScrollWidth() {
      if (tableWrapRef.current) {
        setTableScrollWidth(tableWrapRef.current.scrollWidth);
      }
    }
    syncTableScrollWidth();
    window.addEventListener('resize', syncTableScrollWidth);
    return () => window.removeEventListener('resize', syncTableScrollWidth);
  }, [prospects, detailed, search, statusFilter]);

  function handleTopScroll() {
    if (tableWrapRef.current && topScrollRef.current) {
      tableWrapRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }
  function handleTableWrapScroll() {
    if (tableWrapRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableWrapRef.current.scrollLeft;
    }
  }

  async function loadProspects() {
    setLoading(true);
    const res = await fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json());
    const all = res.prospects || [];
    setProspects(all.filter((p) => !NON_TERMINAL_DEAL_STAGES.includes(p.deal_stage)));
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
  }, [userId]);

  async function handleDelete(prospect) {
    if (!window.confirm(t('prospects.confirmDeleteProspect', locale).replace('{name}', prospect.full_name))) {
      return;
    }
    setActingOn(prospect.id);
    await fetch(`/api/prospects/${prospect.id}`, { method: 'DELETE' });
    setActingOn(null);
    loadProspects();
  }

  // Bascule "Aaron s'en charge" par prospect (demande Alex, 2026-08-26) —
  // même endpoint que le contrôle équivalent déjà utilisé pour Aaron Client
  // (voir app/app/customer/page.jsx, handleToggleAiManaged), étendu par
  // app/api/prospects/[id]/route.ts et app/api/cron/check-inbox/route.ts à
  // tout prospect, plus seulement aux clients gagnés. Quand ai_managed passe
  // à false, Aaron n'ouvre plus les messages de ce contact : ni relance
  // automatique, ni brouillon de réponse.
  async function handleToggleAiManaged(prospect) {
    const nextManaged = prospect.ai_managed === false;
    setActingOn(prospect.id);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_ai_managed', ai_managed: nextManaged }),
    });
    setActingOn(null);
    loadProspects();
  }

  async function handleMarkLost(prospect) {
    if (!window.confirm(t('prospects.confirmMarkLost', locale).replace('{name}', prospect.full_name))) {
      return;
    }
    setActingOn(prospect.id);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'marquer_perdu' }),
    });
    setActingOn(null);
    loadProspects();
  }

  // firstOrderConfirmed = false : le prospect reste visible ici sous "🏆
  // Gagné — en attente de 1ère commande" jusqu'à confirmation ultérieure
  // (voir migration_first_order_confirmed_2026-08-14.sql). true : bascule
  // directement en client (Résultats > Clients gagnés, Aaron Customer).
  async function handleConfirmWon(firstOrderConfirmed) {
    setActingOn(wonProspect.id);
    await fetch(`/api/prospects/${wonProspect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'marquer_gagne', first_order_confirmed: firstOrderConfirmed }),
    });
    setActingOn(null);
    setWonProspect(null);
    loadProspects();
  }

  async function handleConfirmFirstOrder(prospect) {
    setActingOn(prospect.id);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirmer_premiere_commande' }),
    });
    setActingOn(null);
    loadProspects();
  }

  const pendingFirstEmails = prospects.filter((p) => p.pending_first_email_subject);

  const statusFiltered = statusFilter === 'tous' ? prospects : prospects.filter((p) => p.status === statusFilter);
  const searchTerm = search.trim().toLowerCase();
  const filtered = searchTerm
    ? statusFiltered.filter((p) => {
        const haystack = [
          p.full_name,
          p.email,
          p.phone,
          p.job_title,
          p.prospect_companies?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchTerm);
      })
    : statusFiltered;

  // Compte, sur l'ensemble des prospects (pas seulement ceux affichés), combien
  // de contacts existent par société — pour repérer d'un coup d'œil les sociétés
  // où plusieurs interlocuteurs sont déjà en pipeline.
  const contactsPerCompany = {};
  for (const p of prospects) {
    if (!p.prospect_company_id) continue;
    contactsPerCompany[p.prospect_company_id] = (contactsPerCompany[p.prospect_company_id] || 0) + 1;
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
    <Shell active={t('nav.prospects', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('prospects.eyebrow', locale)}</p>
          <h1>{t('prospects.title', locale)}</h1>
        </div>
        <div className="header-actions">
          {prospects.length > 0 && (
            <button
              className={detailed ? 'btn-secondary active' : 'btn-secondary'}
              onClick={() => setDetailed((d) => !d)}
            >
              {detailed ? t('prospects.viewSimple', locale) : t('prospects.viewDetailed', locale)}
            </button>
          )}
          {/* Bug remonté par Alex (25/08/2026) : ce bouton (téléchargement de
              la base de prospects gérée par Aaron) était masqué tant qu'il
              n'y avait aucun prospect — ce qui le faisait passer pour
              "manquant" sur un compte encore vide. Toujours visible
              maintenant, comme "Télécharger un modèle vierge" juste à côté ;
              désactivé (plutôt que masqué) quand il n'y a réellement rien à
              exporter, pour rester cohérent visuellement. */}
          <ExportFormatMenu
            label={t('prospects.exportCsv', locale)}
            disabled={filtered.length === 0}
            onChoose={(format) => exportProspectsToCsv(filtered, locale, format)}
          />
          <ExportFormatMenu
            label={t('prospects.downloadTemplate', locale)}
            onChoose={(format) => downloadBlankProspectsTemplate(locale, format)}
          />
          <button className="btn-secondary" onClick={() => setShowCsvImport(true)}>
            {t('csvImport.button', locale)}
          </button>
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            {t('prospects.addButton', locale)}
          </button>
        </div>
      </header>

      {pendingFirstEmails.length > 0 && (
        <div className="pending-banner">
          {t('prospects.pendingEmailsBanner', locale).replace('{count}', pendingFirstEmails.length)}
          <button type="button" className="pending-banner-btn" onClick={() => setPendingEmailProspect(pendingFirstEmails[0])}>
            {t('prospects.reviewNow', locale)}
          </button>
        </div>
      )}

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

      <div className="filters">
        <button className={statusFilter === 'tous' ? 'chip active' : 'chip'} onClick={() => setStatusFilter('tous')}>
          {t('prospects.allFilter', locale).replace('{count}', prospects.length)}
        </button>
        {Object.entries(STATUS_META).map(([key, meta]) => {
          const count = prospects.filter((p) => p.status === key).length;
          return (
            <button
              key={key}
              className={statusFilter === key ? 'chip active' : 'chip'}
              onClick={() => setStatusFilter(key)}
            >
              <span className="chip-dot" style={{ background: meta.color }} />
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {searchTerm && (
        <p className="search-result-count muted">
          {t('prospects.searchResultCount', locale).replace('{count}', filtered.length).replace('{query}', search.trim())}
        </p>
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
          <div className="table-scroll-top" ref={topScrollRef} onScroll={handleTopScroll}>
            <div style={{ width: tableScrollWidth, height: 1 }} />
          </div>
          <div className="table-wrap" ref={tableWrapRef} onScroll={handleTableWrapScroll}>
          <table>
            <thead>
              <tr>
                <th>{t('prospects.colStatus', locale)}</th>
                <th>{t('prospects.colStatusSince', locale)}</th>
                <th>{t('prospects.colName', locale)}</th>
                <th>{t('prospects.colCompany', locale)}</th>
                {detailed && <th>{t('prospects.colJobTitle', locale)}</th>}
                <th>{t('prospects.colPersonality', locale)}</th>
                <th>{t('modal.aaronAdvice', locale)}</th>
                <th>{t('prospects.colContact', locale)}</th>
                <th>{t('prospects.colActions', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const meta = STATUS_META[p.status] || STATUS_META.jaune;
                const otherContacts = p.prospect_company_id ? (contactsPerCompany[p.prospect_company_id] || 1) - 1 : 0;
                const wonUnconfirmed = p.is_won && !p.first_order_confirmed_at;
                return (
                  <tr key={p.id}>
                    <td>
                      {wonUnconfirmed ? (
                        <span className="status-pill" style={{ color: '#D4A017', borderColor: '#D4A017' }} title={t('prospects.wonPendingTitle', locale)}>
                          <span className="dot" style={{ background: '#D4A017' }} />
                          {t('prospects.wonPendingLabel', locale)}
                        </span>
                      ) : (
                        <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                          <span className="dot" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                      )}
                    </td>
                    <td className="muted since-cell">
                      {p.status_updated_at ? (
                        <span title={new Date(p.status_updated_at).toLocaleString(locale)}>
                          {daysSince(p.status_updated_at)} {t('sales.daysSuffix', locale)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="strong">{p.full_name}</td>
                    <td className="muted">
                      {p.prospect_companies?.name || '—'}
                      {otherContacts > 0 && (
                        <button
                          type="button"
                          className="company-badge"
                          title={t('prospects.otherContactsTitle', locale).replace('{count}', otherContacts)}
                          onClick={() => setSearch(p.prospect_companies?.name || '')}
                        >
                          +{otherContacts}
                        </button>
                      )}
                    </td>
                    {detailed && <td className="muted">{p.job_title || '—'}</td>}
                    <td>
                      {p.personality_type ? (
                        <span className="tag" style={personalityTagStyle(p.personality_type)} title={PERSONALITY_COLOR_LEGEND}>{PERSONALITY_LABELS[p.personality_type] || p.personality_type}</span>
                      ) : (
                        <span className="muted">{t('personality.notDetected', locale)}</span>
                      )}
                      {p.personality_notes && <p className="notes"><TruncatedText text={p.personality_notes} locale={locale} onExpand={() => setThreadProspect(p)} /></p>}
                    </td>
                    <td className="advice"><TruncatedText text={p.aaron_advice} locale={locale} onExpand={() => setThreadProspect(p)} maxLength={ADVICE_TRUNCATE_LENGTH} /></td>
                    <td className="contact">
                      <div>{p.email}</div>
                      {p.phone && <div className="muted">{p.phone}</div>}
                      <button type="button" className="li-btn" onClick={() => setLinkedinProspect(p)}>
                        {t('prospects.linkedinMessageButton', locale)}
                      </button>
                    </td>
                    <td className="row-actions-cell">
                      <button
                        type="button"
                        className="action-btn edit"
                        onClick={() => setThreadProspect(p)}
                        title={t('prospects.editButtonTitle', locale)}
                      >
                        ✏️
                      </button>
                      {p.pending_first_email_subject && (
                        <button
                          type="button"
                          className="action-btn pending-email"
                          onClick={() => setPendingEmailProspect(p)}
                          title={t('prospects.validateFirstEmailTitle', locale)}
                        >
                          {t('prospects.validateFirstEmailButton', locale)}
                        </button>
                      )}
                      <button
                        type="button"
                        className="action-btn thread"
                        onClick={() => setThreadProspect(p)}
                        title={t('prospects.conversationTitle', locale)}
                      >
                        {t('prospects.conversationButton', locale)}
                      </button>
                      {wonUnconfirmed ? (
                        <button
                          type="button"
                          className="action-btn won"
                          disabled={actingOn === p.id}
                          onClick={() => handleConfirmFirstOrder(p)}
                          title={t('prospects.confirmOrderTitle', locale)}
                        >
                          {t('prospects.confirmOrderButton', locale)}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="action-btn won"
                            disabled={actingOn === p.id}
                            onClick={() => setWonProspect(p)}
                            title={t('prospects.wonButtonTitle', locale)}
                          >
                            {t('prospects.wonButtonLabel', locale)}
                          </button>
                          <button
                            type="button"
                            className="action-btn lost"
                            disabled={actingOn === p.id}
                            onClick={() => handleMarkLost(p)}
                            title={t('prospects.lostButtonTitle', locale)}
                          >
                            {t('status.rouge', locale)}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={`action-btn ai-managed-toggle${p.ai_managed === false ? ' off' : ' on'}`}
                        disabled={actingOn === p.id}
                        onClick={() => handleToggleAiManaged(p)}
                        title={p.ai_managed === false ? t('prospects.aiManagedOffTitle', locale) : t('prospects.aiManagedOnTitle', locale)}
                      >
                        {p.ai_managed === false ? `⏸️ ${t('prospects.aiManagedOffLabel', locale)}` : `🤖 ${t('prospects.aiManagedOnLabel', locale)}`}
                      </button>
                      <button
                        type="button"
                        className="action-btn delete"
                        disabled={actingOn === p.id}
                        onClick={() => handleDelete(p)}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      {linkedinProspect && (
        <LinkedInDraftModal prospect={linkedinProspect} onClose={() => setLinkedinProspect(null)} />
      )}

      {threadProspect && (
        <ConversationModal prospect={threadProspect} onClose={() => setThreadProspect(null)} onSaved={loadProspects} />
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

      {wonProspect && (
        <div className="overlay" onClick={() => setWonProspect(null)}>
          <div className="won-modal" onClick={(e) => e.stopPropagation()}>
            <p className="won-title">{t('prospects.wonModalTitle', locale)}</p>
            <p className="won-body">
              {t('prospects.wonModalBodyLine1', locale).replace('{name}', wonProspect.full_name)}
              <br />
              {t('prospects.wonModalBodyLine2', locale)}
            </p>
            <p className="won-hint">
              {t('prospects.wonModalHintLine1', locale).replace('{name}', wonProspect.full_name)}<br />
              {t('prospects.wonModalHintLine2', locale)}
            </p>
            <div className="won-actions">
              <button type="button" className="btn-secondary" onClick={() => setWonProspect(null)}>{t('common.cancel', locale)}</button>
              <button type="button" className="btn-secondary" disabled={actingOn === wonProspect.id} onClick={() => handleConfirmWon(false)}>{t('prospects.wonModalNotYet', locale)}</button>
              <button type="button" className="btn-primary" disabled={actingOn === wonProspect.id} onClick={() => handleConfirmWon(true)}>{t('prospects.wonModalConfirmed', locale)}</button>
            </div>
          </div>
        </div>
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
            // docx item 13 (2026-08-27) : le prospect apparaît déjà dans la
            // liste (onCreated ci-dessus) — cet appel arrive un peu plus
            // tard, une fois qu'Aaron a fini de préparer/envoyer le premier
            // message en arrière-plan. On rafraîchit la liste pour refléter
            // le statut/conseil final, et on affiche l'avertissement s'il y
            // en a un (mêmes messages qu'avant, juste asynchrones).
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
          margin-bottom: 1.5rem;
        }
        .header-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .btn-secondary {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.7rem 1.1rem;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-secondary.active {
          border-color: var(--accent);
          color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .search-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 1rem;
        }
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
        }
        .search-input::placeholder {
          color: var(--muted);
        }
        .search-clear {
          background: none;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.6rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .search-result-count {
          font-size: 0.8rem;
          margin: -0.6rem 0 1rem;
        }
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
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        }
        .chip {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 999px;
          padding: 0.45rem 0.9rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .chip.active {
          border-color: var(--accent);
          color: var(--text);
          background: rgba(75, 57, 239, 0.14);
        }
        .chip-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .table-scroll-top {
          overflow-x: auto;
          overflow-y: hidden;
          height: 14px;
          margin-bottom: 0.4rem;
        }
        .table-wrap {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.86rem;
        }
        thead th {
          text-align: left;
          padding: 0.9rem 1.1rem;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
        }
        tbody td {
          padding: 0.9rem 1.1rem;
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        .strong {
          font-weight: 600;
        }
        .muted {
          color: var(--muted);
        }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.25rem 0.7rem;
          font-size: 0.76rem;
          white-space: nowrap;
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .tag {
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          padding: 0.2rem 0.6rem;
          border-radius: var(--radius-sm);
          font-size: 0.78rem;
        }
        .notes {
          margin: 0.35rem 0 0;
          color: var(--muted);
          font-size: 0.78rem;
          max-width: 22ch;
        }
        .advice {
          max-width: 26ch;
          color: var(--text);
          overflow-wrap: break-word;
        }
        .contact {
          font-size: 0.82rem;
          white-space: nowrap;
        }
        .li-btn {
          display: block;
          margin-top: 0.35rem;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--accent);
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.55rem;
          font-size: 0.72rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .truncate-toggle {
          background: none;
          border: none;
          padding: 0;
          color: var(--accent);
          font-size: inherit;
          font-family: inherit;
          text-decoration: underline;
          cursor: pointer;
          white-space: nowrap;
        }
        .row-actions-cell {
          white-space: nowrap;
        }
        .action-btn {
          display: inline-block;
          margin: 0 0.3rem 0.3rem 0;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.3rem 0.55rem;
          font-size: 0.74rem;
          cursor: pointer;
          color: var(--text);
        }
        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .action-btn.won {
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .action-btn.lost {
          border-color: var(--accent-red);
          color: var(--accent-red);
        }
        .action-btn.thread {
          border-color: var(--accent);
          color: var(--accent);
        }
        .action-btn.pending-email {
          border-color: var(--accent-amber);
          color: var(--accent-amber);
          font-weight: 600;
        }
        .action-btn.ai-managed-toggle.on {
          border-color: var(--accent);
          color: var(--accent);
        }
        .action-btn.ai-managed-toggle.off {
          border-color: var(--muted);
          color: var(--muted);
        }
        .pending-banner {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.8rem;
          background: rgba(212, 160, 23, 0.12);
          border: 1px solid var(--accent-amber);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.8rem 1.1rem;
          font-size: 0.86rem;
          margin-bottom: 1.2rem;
        }
        .pending-banner-btn {
          background: var(--accent-amber);
          color: var(--bg-elevated);
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.9rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .action-btn.delete {
          color: var(--accent-red);
        }
        .action-btn.edit {
          border-color: var(--border);
          color: var(--text);
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
        .won-modal {
          background: var(--surface);
          border: 1px solid var(--accent-green);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 420px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        .won-title {
          font-family: var(--font-display);
          font-size: 1.3rem;
          margin: 0 0 0.8rem;
        }
        .won-body {
          color: var(--text);
          font-size: 0.9rem;
          line-height: 1.5;
          margin: 0 0 0.6rem;
        }
        .won-hint {
          color: var(--muted);
          font-size: 0.8rem;
          line-height: 1.5;
          margin: 0 0 1.4rem;
        }
        .won-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 0.6rem;
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
function ConversationModal({ prospect, onClose, onSaved }) {
  const [locale] = useLocale();
  const PERSONALITY_LABELS = personalityLabelsFor(locale);
  const PERSONALITY_COLOR_LEGEND = personalityColorLegendFor(locale);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/prospects/${prospect.id}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || t('prospects.loadErrorFallback', locale));
        if (!cancelled) setMessages(body.messages || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [prospect.id]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{prospect.full_name}</h2>
            <p className="hint">{prospect.prospect_companies?.name || prospect.email}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.close', locale)}</button>
        </div>

        <section className="detail-block">
          <ContactInfoEditor prospect={prospect} locale={locale} onSaved={onSaved} />
        </section>

        <section className="detail-block">
          <CompanyInfoEditor prospect={prospect} locale={locale} onSaved={onSaved} />
        </section>

        <section className="detail-block">
          <h3>{t('prospects.aaronOpinionTitle', locale)}</h3>
          {prospect.personality_type ? (
            <p className="advice-line">
              <span className="tag" style={personalityTagStyle(prospect.personality_type)} title={PERSONALITY_COLOR_LEGEND}>{PERSONALITY_LABELS[prospect.personality_type] || prospect.personality_type}</span>
              {prospect.personality_notes && <span> — {frenchTypography(prospect.personality_notes)}</span>}
            </p>
          ) : (
            <p className="muted">{t('prospects.personalityNotYetDetected', locale)}</p>
          )}
          {prospect.aaron_advice && <p className="advice-line">{frenchTypography(prospect.aaron_advice)}</p>}
        </section>

        <section className="detail-block">
          <h3>{t('modal.historyTab', locale)}</h3>
          {loading ? (
            <p className="muted">{t('common.loading', locale)}</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : messages.length === 0 ? (
            <p className="muted">{t('modal.noExchangeYet', locale)}</p>
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <div className={`msg msg-${m.direction}`} key={i}>
                  <p className="msg-meta">
                    {m.direction === 'outbound' ? (
                      <span className="ai-badge" title={t('prospects.outboundBadgeTitle', locale)}>{t('prospects.outboundBadge', locale)}</span>
                    ) : (
                      t('prospects.inboundLabel', locale)
                    )}
                    {' — '}
                    {new Date(m.sent_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  <p className="msg-body">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
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
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0;
        }
        .hint {
          color: var(--muted);
          font-size: 0.84rem;
          margin: 0.2rem 0 0;
        }
        .btn-secondary {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.8rem;
          font-size: 0.8rem;
          cursor: pointer;
          flex-shrink: 0;
        }
        .muted {
          color: var(--muted);
        }
        .error {
          color: var(--accent-red);
          font-size: 0.84rem;
        }
        .detail-block {
          margin-top: 1.3rem;
          padding-top: 1.1rem;
          border-top: 1px solid var(--border);
        }
        .detail-block h3 {
          font-size: 0.9rem;
          margin: 0 0 0.6rem;
        }
        .advice-line {
          font-size: 0.85rem;
          line-height: 1.5;
          margin: 0 0 0.5rem;
          overflow-wrap: break-word;
        }
        .tag {
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          padding: 0.2rem 0.6rem;
          border-radius: var(--radius-sm);
          font-size: 0.78rem;
        }
        .thread {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          max-height: 320px;
          overflow-y: auto;
        }
        .msg {
          border-radius: var(--radius-md);
          padding: 0.7rem 0.9rem;
          font-size: 0.82rem;
          border: 1px solid var(--border);
        }
        .msg-outbound {
          background: rgba(75, 57, 239, 0.1);
          margin-left: 1.5rem;
        }
        .msg-inbound {
          background: var(--bg);
          margin-right: 1.5rem;
        }
        .msg-meta {
          color: var(--muted);
          font-size: 0.72rem;
          margin: 0 0 0.35rem;
        }
        .ai-badge {
          display: inline-block;
          background: rgba(75, 57, 239, 0.16);
          color: var(--text);
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          font-size: 0.7rem;
          font-weight: 600;
        }
        .msg-body {
          margin: 0;
          white-space: pre-line;
          overflow-wrap: break-word;
        }
      `}</style>
    </div>
  );
}

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
    { label: t('nav.opportunity', locale), slug: 'sales', icon: '🤝', locked: lockedModules.sales },
    { label: t('nav.client', locale), slug: 'customer', icon: '🌟', locked: lockedModules.customer },
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
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {LOCALE_LABELS[l]}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron') && (item.slug !== 'customer' || userEmail === 'aaron@meetaaron.app')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span>{item.label}{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
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
