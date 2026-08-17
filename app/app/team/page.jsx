// app/app/team/page.jsx
// CHANGEMENTS A FAIRE — Mon équipe (2026-08-16, items 1 à 3) : la page passe
// de "un seul tableau, 3 colonnes de stats" à 3 onglets — Vue d'ensemble (6
// colonnes de stats + sélecteur de période), Résultats détaillés (tableau
// complet prospects/opportunités/clients de la société, exportable CSV/XLS)
// et Rapport de performances (PDF téléchargeable généré à la demande, voir
// app/api/team/report/route.ts). Voir lib/team-stats.ts pour les
// définitions exactes des stats.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

// Sélecteur de période littéral du docx ("depuis l'ouverture de compte, au
// mois, de telle à telle date") — volontairement différent des fenêtres
// 7j/30j/3mois/depuis toujours de Résultats (Lot 5), chaque page suit son
// propre texte. Partagé par les onglets Vue d'ensemble et Rapport.
function periodQueryParams(periodMode, customFrom, customTo) {
  const params = new URLSearchParams();
  params.set('period', periodMode);
  if (periodMode === 'custom' && customFrom) params.set('since', new Date(customFrom).toISOString());
  if (periodMode === 'custom' && customTo) params.set('until', new Date(customTo).toISOString());
  return params;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportResultsCsv(rows, headers, keys, filename) {
  const lines = [headers.map(csvEscape).join(';')];
  rows.forEach((row) => {
    lines.push(keys.map((k) => csvEscape(row[k])).join(';'));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename);
}

// "XLS" généré côté client sans dépendance : un fichier HTML (table simple)
// avec l'extension .xls et le type MIME Excel — Excel/LibreOffice l'ouvrent
// nativement, c'est la technique standard pour un export XLS sans
// bibliothèque de génération de binaire .xlsx.
function exportResultsXls(rows, headers, keys, filename) {
  const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const headRow = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const bodyRows = rows
    .map((row) => `<tr>${keys.map((k) => `<td>${escapeHtml(row[k])}</td>`).join('')}</tr>`)
    .join('');
  const html = `<html><head><meta charset="utf-8"></head><body><table>${headRow}${bodyRows}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, filename);
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

export default function TeamPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [activeTab, setActiveTab] = useState('overview');
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamError, setTeamError] = useState(null);

  // Sélecteur de période (item 1) — partagé entre l'onglet Vue d'ensemble et
  // l'onglet Rapport de performances (item 3), qui répondent tous les deux à
  // "depuis l'ouverture de compte / au mois / de telle à telle date".
  const [periodMode, setPeriodMode] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [resultsRows, setResultsRows] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(null);
  const [resultsLoaded, setResultsLoaded] = useState(false);

  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState(null);

  function loadTeam() {
    if (!userId) return;
    setLoading(true);
    const params = periodQueryParams(periodMode, customFrom, customTo);
    fetch(`/api/team?user_id=${userId}&${params.toString()}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setTeamError(body.error);
        } else {
          setMembers(body.members || []);
          setInviteCode(body.invite_code || null);
        }
        setLoading(false);
      });
  }

  useEffect(() => {
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, periodMode, customFrom, customTo]);

  function loadResults() {
    if (!userId) return;
    setResultsLoading(true);
    setResultsError(null);
    fetch(`/api/team/results?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setResultsError(body.error);
        } else {
          setResultsRows(body.rows || []);
          setResultsLoaded(true);
        }
        setResultsLoading(false);
      });
  }

  useEffect(() => {
    if (activeTab === 'results' && !resultsLoaded && userId) {
      loadResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  function copyInviteCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const TYPE_LABELS = {
    prospect: t('team.typeProspect', locale),
    opportunite: t('team.typeOpportunity', locale),
    client: t('team.typeClient', locale),
  };

  function handleExportCsv() {
    const headers = [t('team.resultsColType', locale), t('team.resultsColName', locale), t('team.resultsColCompany', locale), t('team.resultsColCommercial', locale), t('team.resultsColStatus', locale), t('team.resultsColDate', locale)];
    const rows = resultsRows.map((r) => ({
      type: TYPE_LABELS[r.type] || r.type,
      name: r.name,
      company: r.company,
      commercial: r.commercial,
      status: r.status,
      date: r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '',
    }));
    exportResultsCsv(rows, headers, ['type', 'name', 'company', 'commercial', 'status', 'date'], `resultats-equipe-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function handleExportXls() {
    const headers = [t('team.resultsColType', locale), t('team.resultsColName', locale), t('team.resultsColCompany', locale), t('team.resultsColCommercial', locale), t('team.resultsColStatus', locale), t('team.resultsColDate', locale)];
    const rows = resultsRows.map((r) => ({
      type: TYPE_LABELS[r.type] || r.type,
      name: r.name,
      company: r.company,
      commercial: r.commercial,
      status: r.status,
      date: r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '',
    }));
    exportResultsXls(rows, headers, ['type', 'name', 'company', 'commercial', 'status', 'date'], `resultats-equipe-${new Date().toISOString().slice(0, 10)}.xls`);
  }

  async function handleGenerateReport() {
    setReportGenerating(true);
    setReportError(null);
    const body = { user_id: userId, period: periodMode };
    if (periodMode === 'custom' && customFrom) body.since = new Date(customFrom).toISOString();
    if (periodMode === 'custom' && customTo) body.until = new Date(customTo).toISOString();

    const res = await fetch('/api/team/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setReportError(err.error || t('team.reportError', locale));
      setReportGenerating(false);
      return;
    }

    const blob = await res.blob();
    downloadBlob(blob, `rapport-performances-${new Date().toISOString().slice(0, 10)}.pdf`);
    setReportGenerating(false);
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
    <Shell active={t('nav.team', locale)} userId={userId}>
      <header className="header">
        <p className="eyebrow">{t('team.eyebrow', locale)}</p>
        <h1>{t('team.title', locale)}</h1>
      </header>

      {!loading && inviteCode && (
        <div className="invite-box">
          <div>
            <p className="invite-label">{t('team.inviteLabel', locale)}</p>
            <p className="invite-hint">{t('team.inviteHint', locale)}</p>
          </div>
          <div className="invite-code-row">
            <code className="invite-code">{inviteCode}</code>
            <button type="button" className="btn-copy" onClick={copyInviteCode}>
              {copied ? t('team.copied', locale) : t('team.copy', locale)}
            </button>
          </div>
        </div>
      )}

      <div className="tabs">
        <button type="button" className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          {t('team.tabOverview', locale)}
        </button>
        <button type="button" className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>
          {t('team.tabResults', locale)}
        </button>
        <button type="button" className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`} onClick={() => setActiveTab('report')}>
          {t('team.tabReport', locale)}
        </button>
      </div>

      {(activeTab === 'overview' || activeTab === 'report') && (
        <div className="period-row">
          <label>
            <input type="radio" name="period" checked={periodMode === 'all'} onChange={() => setPeriodMode('all')} />
            {t('team.periodAll', locale)}
          </label>
          <label>
            <input type="radio" name="period" checked={periodMode === 'month'} onChange={() => setPeriodMode('month')} />
            {t('team.periodMonth', locale)}
          </label>
          <label>
            <input type="radio" name="period" checked={periodMode === 'custom'} onChange={() => setPeriodMode('custom')} />
            {t('team.periodCustom', locale)}
          </label>
          {periodMode === 'custom' && (
            <div className="period-dates">
              <span>{t('team.periodFrom', locale)}</span>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span>{t('team.periodTo', locale)}</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {activeTab === 'overview' && (
        loading ? (
          <p className="muted">{t('common.loading', locale)}</p>
        ) : teamError ? (
          <EmptyState title={t('team.accessDenied', locale)} body={teamError} />
        ) : members.length === 0 ? (
          <EmptyState title={t('team.noMembersTitle', locale)} body={t('team.noMembersBody', locale)} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('team.colName', locale)}</th>
                  <th>{t('modal.email', locale)}</th>
                  <th>{t('team.colRole', locale)}</th>
                  <th>{t('team.colActiveProspects', locale)}</th>
                  <th>{t('team.colWonAppointments', locale)}</th>
                  <th>{t('team.colActiveOpportunities', locale)}</th>
                  <th>{t('team.colWonClients', locale)}</th>
                  <th>{t('team.colActiveClients', locale)}</th>
                  <th>{t('team.colLostClients', locale)}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/app/team/${m.id}?user_id=${userId}`} className="member-link">
                        {m.full_name}
                      </Link>
                    </td>
                    <td className="muted">{m.email}</td>
                    <td className="muted">{m.role === 'patron' ? t('team.roleFounder', locale) : t('team.roleSales', locale)}</td>
                    <td>{m.prospects_actifs}</td>
                    <td>{m.rdv_gagnes}</td>
                    <td>{m.opportunites_actives}</td>
                    <td>{m.clients_gagnes}</td>
                    <td>{m.clients_actifs}</td>
                    <td>{m.clients_perdus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'results' && (
        <div className="results-panel">
          <div className="results-toolbar">
            <p className="muted results-hint">{t('team.resultsHint', locale)}</p>
            <div className="results-actions">
              <button type="button" className="btn-copy" disabled={resultsRows.length === 0} onClick={handleExportCsv}>
                {t('team.downloadCsv', locale)}
              </button>
              <button type="button" className="btn-copy" disabled={resultsRows.length === 0} onClick={handleExportXls}>
                {t('team.downloadXls', locale)}
              </button>
            </div>
          </div>

          {resultsLoading ? (
            <p className="muted">{t('common.loading', locale)}</p>
          ) : resultsError ? (
            <EmptyState title={t('team.accessDenied', locale)} body={resultsError} />
          ) : resultsRows.length === 0 ? (
            <EmptyState title={t('team.resultsEmptyTitle', locale)} body={t('team.resultsEmptyBody', locale)} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('team.resultsColType', locale)}</th>
                    <th>{t('team.resultsColName', locale)}</th>
                    <th>{t('team.resultsColCompany', locale)}</th>
                    <th>{t('team.resultsColCommercial', locale)}</th>
                    <th>{t('team.resultsColStatus', locale)}</th>
                    <th>{t('team.resultsColDate', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsRows.map((r, i) => (
                    <tr key={i}>
                      <td>{TYPE_LABELS[r.type] || r.type}</td>
                      <td>{r.name}</td>
                      <td className="muted">{r.company}</td>
                      <td className="muted">{r.commercial}</td>
                      <td className="muted">{r.status}</td>
                      <td className="muted">{r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'report' && (
        <div className="report-panel">
          <p className="muted">{t('team.reportDesc', locale)}</p>
          <button type="button" className="btn-primary" disabled={reportGenerating} onClick={handleGenerateReport}>
            {reportGenerating ? t('team.reportGenerating', locale) : t('team.reportButton', locale)}
          </button>
          {reportError && <p className="report-error">{reportError}</p>}
        </div>
      )}

      <style jsx>{`
        .tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.2rem;
          flex-wrap: wrap;
        }
        .tab-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.55rem 1rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .tab-btn.active {
          background: rgba(75, 57, 239, 0.18);
          color: var(--text);
          border-color: var(--accent);
        }
        .period-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 1.1rem;
          margin-bottom: 1.4rem;
          font-size: 0.86rem;
          color: var(--muted);
        }
        .period-row label {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          cursor: pointer;
        }
        .period-dates {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .period-dates input[type='date'] {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.5rem;
          font-size: 0.82rem;
        }
        .results-panel, .report-panel {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .results-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.8rem;
        }
        .results-hint {
          margin: 0;
          font-size: 0.82rem;
          max-width: 480px;
        }
        .results-actions {
          display: flex;
          gap: 0.6rem;
        }
        .report-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.6rem;
          align-items: flex-start;
        }
        .report-error {
          color: var(--accent-red);
          font-size: 0.84rem;
          margin: 0;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.65rem 1.2rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn-copy:disabled {
          opacity: 0.5;
          cursor: default;
        }
      `}</style>

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
        .invite-box {
          background: rgba(75, 57, 239, 0.1);
          border: 1px solid var(--accent);
          border-radius: var(--radius-lg);
          padding: 1.1rem 1.3rem;
          margin-bottom: 1.6rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .invite-label {
          margin: 0 0 0.25rem;
          font-weight: 600;
          font-size: 0.88rem;
        }
        .invite-hint {
          margin: 0;
          color: var(--muted);
          font-size: 0.8rem;
          max-width: 460px;
        }
        .invite-code-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .invite-code {
          font-family: var(--font-mono);
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.9rem;
          font-size: 0.95rem;
          letter-spacing: 0.04em;
          color: var(--accent-green);
        }
        .btn-copy {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
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
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        .member-link {
          color: var(--text);
          font-weight: 600;
          text-decoration: none;
        }
        .member-link:hover {
          color: var(--accent);
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </Shell>
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
