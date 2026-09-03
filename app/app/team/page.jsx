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
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';

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

export default function TeamPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [activeTab, setActiveTab] = useState('overview');
  const [members, setMembers] = useState([]);
  // Jauge de crédits par commercial (demande Alex, 01/09/2026) — voir
  // migration_api_usage_per_user_2026-09-01.sql et app/api/team/route.ts.
  const [credits, setCredits] = useState(null);
  const [inviteCode, setInviteCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamError, setTeamError] = useState(null);
  // Bug remonté par Alex (2026-08-19) : le titre "Accès non autorisé" s'affichait
  // pour N'IMPORTE QUELLE erreur de /api/team (401 session invalide, 500 hoquet
  // serveur, coupure réseau...), pas seulement pour un vrai refus de rôle (403).
  // On garde le statut HTTP à part pour n'afficher ce titre précis que sur un
  // vrai 403, et gérer les autres cas (dont l'absence totale de gestion
  // d'erreur réseau — `.catch()` manquant avant ce correctif) avec un message
  // générique + bouton "Réessayer".
  const [teamErrorStatus, setTeamErrorStatus] = useState(null);

  // Sélecteur de période (item 1) — partagé entre l'onglet Vue d'ensemble et
  // l'onglet Rapport de performances (item 3), qui répondent tous les deux à
  // "depuis l'ouverture de compte / au mois / de telle à telle date".
  const [periodMode, setPeriodMode] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [resultsRows, setResultsRows] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(null);
  const [resultsErrorStatus, setResultsErrorStatus] = useState(null);
  const [resultsLoaded, setResultsLoaded] = useState(false);

  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState(null);

  // Onglet "Abonnement équipes" (28/08/2026) — voir migration_team_seats_2026-08-28.sql
  // et app/api/team/seats/*. Chargement paresseux comme l'onglet Résultats
  // (loadResults ci-dessous) : seulement au premier passage sur l'onglet.
  const [seats, setSeats] = useState([]);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatsError, setSeatsError] = useState(null);
  const [seatsLoaded, setSeatsLoaded] = useState(false);
  const [seatModalOpen, setSeatModalOpen] = useState(false);
  const [editingSeat, setEditingSeat] = useState(null); // null = création, sinon siège en cours de modification
  const [seatActionBusy, setSeatActionBusy] = useState(null); // id du siège en cours d'action (annuler/supprimer/envoyer le code)
  const [seatActionError, setSeatActionError] = useState(null);

  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState(null);
  const [invoicesShowAll, setInvoicesShowAll] = useState(false);

  function loadSeats() {
    if (!userId) return;
    setSeatsLoading(true);
    setSeatsError(null);
    fetch('/api/team/seats')
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setSeatsError(body.error);
        } else {
          setSeats(body.seats || []);
          setSeatsLoaded(true);
        }
        setSeatsLoading(false);
      })
      .catch(() => {
        setSeatsError(t('preferences.loadError', locale));
        setSeatsLoading(false);
      });
  }

  useEffect(() => {
    if (activeTab === 'subscription' && !seatsLoaded && userId) {
      loadSeats();
    }
    if (activeTab === 'subscription' && invoices === null && userId) {
      fetch(`/api/billing/invoices?user_id=${userId}`)
        .then((r) => r.json())
        .then((body) => setInvoices(body.invoices || []))
        .catch(() => setInvoicesError(t('preferences.invoices.error', locale)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  async function handleSendSeatCode(seatId) {
    setSeatActionBusy(seatId);
    setSeatActionError(null);
    try {
      const res = await fetch(`/api/team/seats/${seatId}/send-code`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setSeatActionError(body.error || t('team.seatActionErrorFallback', locale));
      } else {
        setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, email_sent_at: new Date().toISOString() } : s)));
      }
    } catch {
      setSeatActionError(t('team.seatActionErrorFallback', locale));
    }
    setSeatActionBusy(null);
  }

  async function handleCancelSeat(seatId) {
    if (!confirm(t('team.seatCancelConfirm', locale))) return;
    setSeatActionBusy(seatId);
    setSeatActionError(null);
    try {
      const res = await fetch(`/api/team/seats/${seatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSeatActionError(body.error || t('team.seatActionErrorFallback', locale));
      } else {
        setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, status: 'cancelled' } : s)));
      }
    } catch {
      setSeatActionError(t('team.seatActionErrorFallback', locale));
    }
    setSeatActionBusy(null);
  }

  async function handleDeleteSeat(seatId) {
    if (!confirm(t('team.seatDeleteConfirm', locale))) return;
    setSeatActionBusy(seatId);
    setSeatActionError(null);
    try {
      const res = await fetch(`/api/team/seats/${seatId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSeatActionError(body.error || t('team.seatActionErrorFallback', locale));
      } else {
        setSeats((prev) => prev.filter((s) => s.id !== seatId));
      }
    } catch {
      setSeatActionError(t('team.seatActionErrorFallback', locale));
    }
    setSeatActionBusy(null);
  }

  function loadTeam() {
    if (!userId) return;
    setLoading(true);
    setTeamError(null);
    setTeamErrorStatus(null);
    const params = periodQueryParams(periodMode, customFrom, customTo);
    fetch(`/api/team?user_id=${userId}&${params.toString()}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, status: r.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          setTeamError(body.error);
          setTeamErrorStatus(status);
        } else {
          setMembers(body.members || []);
          setInviteCode(body.invite_code || null);
          setCredits(body.credits || null);
        }
        setLoading(false);
      })
      .catch(() => {
        setTeamError(t('preferences.loadError', locale));
        setTeamErrorStatus(null);
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
    setResultsErrorStatus(null);
    fetch(`/api/team/results?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, status: r.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          setResultsError(body.error);
          setResultsErrorStatus(status);
        } else {
          setResultsRows(body.rows || []);
          setResultsLoaded(true);
        }
        setResultsLoading(false);
      })
      .catch(() => {
        setResultsError(t('preferences.loadError', locale));
        setResultsErrorStatus(null);
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

      {/* Code d'activation société (invite-box) retiré le 28/08/2026 —
          remplacé par un code par siège commercial, voir l'onglet
          "Abonnement équipes" (team_seats, migration_team_seats_2026-08-28.sql).
          `inviteCode`/`copyInviteCode` restent utilisés nulle part ailleurs
          dans ce fichier après ce retrait — code mort volontairement laissé
          en l'état (état React + fetch existants, pas de risque) plutôt que
          retiré en profondeur pour limiter la taille de ce diff. */}

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
        <button type="button" className={`tab-btn ${activeTab === 'subscription' ? 'active' : ''}`} onClick={() => setActiveTab('subscription')}>
          {t('team.tabSubscription', locale)}
        </button>
        {/* Docx Modifs Aaron (30/08/2026) : la rubrique Suggestions quitte la
            barre latérale et devient cet onglet "Suggestions de l'équipe",
            juste à droite d'Abonnement équipes. */}
        <button type="button" className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`} onClick={() => setActiveTab('suggestions')}>
          {t('team.tabSuggestions', locale)}
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
          <div>
            <EmptyState
              title={teamErrorStatus === 403 ? t('team.accessDenied', locale) : t('preferences.loadError', locale)}
              body={teamError}
            />
            <button type="button" onClick={loadTeam} style={{ marginTop: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.2rem', fontSize: '0.86rem', cursor: 'pointer' }}>
              {t('common.retry', locale)}
            </button>
          </div>
        ) : members.length === 0 ? (
          <EmptyState title={t('team.noMembersTitle', locale)} body={t('team.noMembersBody', locale)} />
        ) : (
          <>
          {/* Jauge de crédits par commercial (01/09/2026) : qui consomme le
              budget API mensuel inclus dans l'abonnement. Le plafond reste
              commun à la société — c'est une répartition, pas un quota
              individuel, et c'est dit explicitement sous la jauge. */}
          {credits?.available && credits.company_total_usd > 0 && (
            <section className="credits-panel">
              <div className="credits-head">
                <h2>{t('team.creditsTitle', locale)}</h2>
                <span className="credits-total">
                  {formatEur(credits.company_total_usd)}
                  {credits.cap_usd ? ` / ${formatEur(credits.cap_usd)}` : ''}
                </span>
              </div>
              <p className="muted credits-hint">{t('team.creditsHint', locale)}</p>

              {/* Alertes à 70 / 90 / 100 % (décision Alex, 01/09/2026). Trois
                  seuils et non un seul : une alerte unique arrive toujours
                  trop tard pour éviter la coupure en pleine campagne. Le
                  pourcentage est calculé sur le plafond RÉEL (abonnement +
                  boosts actifs), sinon un boost fraîchement acheté afficherait
                  encore « 100 % consommé ». */}
              {(() => {
                const cap = credits.cap_usd || 0;
                if (!cap) return null;
                const pct = (credits.company_total_usd / cap) * 100;
                if (pct < 70) return null;
                const level = pct >= 100 ? 'critical' : pct >= 90 ? 'high' : 'soft';
                const messageKey =
                  pct >= 100 ? 'team.creditsWarn100' : pct >= 90 ? 'team.creditsWarn90' : 'team.creditsWarn70';
                return (
                  <div className={`credits-warn ${level}`}>
                    <span>{t(messageKey, locale)}</span>
                    <a className="credits-warn-cta" href="/app/connexions?tab=subscription">
                      {t('team.creditsAddCta', locale)}
                    </a>
                  </div>
                );
              })()}
              {(() => {
                const base = credits.cap_usd || credits.company_total_usd || 1;
                const rows = [
                  ...members
                    .map((m) => ({ id: m.id, label: m.full_name, value: m.credits_used_usd || 0, shared: false }))
                    .filter((r) => r.value > 0)
                    .sort((a, b) => b.value - a.value),
                  ...(credits.shared_usd > 0
                    ? [{ id: '__shared', label: t('team.creditsShared', locale), value: credits.shared_usd, shared: true }]
                    : []),
                ];
                const colors = ['#4b39ef', '#7c6ef5', '#4b9ef0', '#3dd68c', '#f5a623', '#b07cf5'];
                return (
                  <>
                    <div className="credits-bar" role="img" aria-label={t('team.creditsTitle', locale)}>
                      {rows.map((r, i) => (
                        <span
                          key={r.id}
                          className={`credits-seg${r.shared ? ' shared' : ''}`}
                          style={{ width: `${Math.min(100, (r.value / base) * 100)}%`, background: r.shared ? undefined : colors[i % colors.length] }}
                          title={`${r.label} — ${formatEur(r.value)}`}
                        />
                      ))}
                      {/* Repère de fin des crédits inclus (01/09/2026) :
                          au-delà de ce trait, on puise dans la réserve de
                          boost. Le client voit ainsi d'un coup d'œil sur
                          quelle poche il consomme, sans avoir à lire un
                          chiffre. */}
                      {(credits.boost_cap_usd || 0) > 0 && credits.subscription_cap_usd > 0 && (
                        <span
                          className="credits-boost-mark"
                          style={{ left: `${Math.min(100, (credits.subscription_cap_usd / base) * 100)}%` }}
                          title={`${t('team.creditsBoostSegment', locale)} : +${credits.boost_credits}`}
                        />
                      )}
                    </div>
                    {(credits.boost_cap_usd || 0) > 0 && (
                      <p className="muted credits-hint credits-boost-note">
                        {formatEur(credits.subscription_cap_usd)} + {t('team.creditsBoostSegment', locale)}{' '}
                        {formatEur(credits.boost_cap_usd)} (+{credits.boost_credits})
                      </p>
                    )}
                    <ul className="credits-legend">
                      {rows.map((r, i) => (
                        <li key={r.id}>
                          <span className={`credits-dot${r.shared ? ' shared' : ''}`} style={{ background: r.shared ? undefined : colors[i % colors.length] }} />
                          <span className="credits-name">{r.label}</span>
                          <span className="credits-value">{formatEur(r.value)}</span>
                          {credits.cap_usd ? (
                            <span className="credits-pct">{Math.round((r.value / credits.cap_usd) * 100)} %</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </section>
          )}
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
                  {credits?.available && <th>{t('team.colCredits', locale)}</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <a href={`/app/team/${m.id}?user_id=${userId}`} className="member-link">
                        {m.full_name}
                      </a>
                    </td>
                    <td className="muted">{m.email}</td>
                    <td className="muted">{m.role === 'patron' ? t('team.roleFounder', locale) : t('team.roleSales', locale)}</td>
                    <td>{m.prospects_actifs}</td>
                    <td>{m.rdv_gagnes}</td>
                    <td>{m.opportunites_actives}</td>
                    <td>{m.clients_gagnes}</td>
                    <td>{m.clients_actifs}</td>
                    <td>{m.clients_perdus}</td>
                    {credits?.available && <td className="muted">{formatEur(m.credits_used_usd || 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
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
            <div>
              <EmptyState
                title={resultsErrorStatus === 403 ? t('team.accessDenied', locale) : t('preferences.loadError', locale)}
                body={resultsError}
              />
              <button type="button" onClick={loadResults} style={{ marginTop: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.2rem', fontSize: '0.86rem', cursor: 'pointer' }}>
                {t('common.retry', locale)}
              </button>
            </div>
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

      {activeTab === 'subscription' && (
        <div className="results-panel subscription-panel">
          <div className="results-toolbar">
            <p className="muted results-hint">{t('team.subscriptionIntro', locale)}</p>
            <button type="button" className="btn-primary" onClick={() => { setEditingSeat(null); setSeatModalOpen(true); }}>
              {t('team.addSeatButton', locale)}
            </button>
          </div>

          {seatActionError && <p className="error">{seatActionError}</p>}

          {seatsLoading ? (
            <p className="muted">{t('common.loading', locale)}</p>
          ) : seatsError ? (
            <div>
              <EmptyState title={t('preferences.loadError', locale)} body={seatsError} />
              <button type="button" onClick={loadSeats} style={{ marginTop: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.2rem', fontSize: '0.86rem', cursor: 'pointer' }}>
                {t('common.retry', locale)}
              </button>
            </div>
          ) : seats.length === 0 ? (
            <EmptyState title={t('team.seatsEmptyTitle', locale)} body={t('team.seatsEmptyBody', locale)} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('team.seatColName', locale)}</th>
                    <th>{t('prospects.colJobTitle', locale)}</th>
                    <th>{t('modal.email', locale)}</th>
                    <th>{t('team.seatColModules', locale)}</th>
                    <th>{t('team.seatColStatus', locale)}</th>
                    <th>{t('team.seatColCode', locale)}</th>
                    <th>{t('team.seatColActions', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {seats.map((s) => {
                    const busy = seatActionBusy === s.id;
                    return (
                      <tr key={s.id}>
                        <td>{s.first_name} {s.last_name}</td>
                        <td className="muted">{s.job_title || '—'}</td>
                        <td className="muted">{s.email}</td>
                        <td className="muted">{t('team.seatPlanAaron', locale)}</td>
                        <td>
                          <span className={`seat-status seat-status-${s.status}`}>
                            {s.status === 'active' ? t('team.seatStatusActive', locale) : s.status === 'cancelled' ? t('team.seatStatusCancelled', locale) : t('team.seatStatusPending', locale)}
                          </span>
                        </td>
                        <td>
                          {s.status !== 'cancelled' && (
                            <div className="seat-code-cell">
                              <code className="seat-code">{s.activation_code}</code>
                              {s.status === 'pending' && (
                                <button type="button" className="btn-copy" disabled={busy} onClick={() => handleSendSeatCode(s.id)}>
                                  {s.email_sent_at ? t('team.seatEmailSent', locale) : busy ? '…' : t('team.seatSendCode', locale)}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="seat-actions-cell">
                            {s.status !== 'cancelled' && (
                              <button type="button" className="link-btn" onClick={() => { setEditingSeat(s); setSeatModalOpen(true); }}>
                                {t('team.seatModify', locale)}
                              </button>
                            )}
                            {s.status !== 'cancelled' && (
                              <a className="link-btn" href={`/app/connexions?user_id=${userId}&tab=subscription`}>
                                {t('team.seatBoost', locale)}
                              </a>
                            )}
                            {s.status !== 'cancelled' && (
                              <button type="button" className="link-btn" disabled={busy} onClick={() => handleCancelSeat(s.id)}>
                                {t('team.seatCancel', locale)}
                              </button>
                            )}
                            <button type="button" className="link-btn link-btn-danger" disabled={busy} onClick={() => handleDeleteSeat(s.id)}>
                              {t('team.seatDelete', locale)}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="field credits-field billing-section">
            <label>{t('team.billingTitle', locale)}</label>
            <div className="usage-box">
              <p className="usage-hint">{t('team.billingHint', locale)}</p>
              {invoicesError && <p className="error">{invoicesError}</p>}
              {!invoicesError && invoices === null && (
                <p className="usage-hint">{t('preferences.invoices.loading', locale)}</p>
              )}
              {!invoicesError && invoices && invoices.length === 0 && (
                <p className="usage-hint">{t('preferences.invoices.empty', locale)}</p>
              )}
              {!invoicesError && invoices && invoices.length > 0 && (
                <>
                  <ul className="invoices-list">
                    {(invoicesShowAll ? invoices : invoices.slice(0, 5)).map((inv) => (
                      <li key={inv.id} className="invoice-row">
                        <span>
                          {new Date(inv.created * 1000).toLocaleDateString(locale)} —{' '}
                          {(inv.amount_paid / 100).toFixed(2)} {(inv.currency || 'eur').toUpperCase()}
                        </span>
                        {(inv.invoice_pdf || inv.hosted_invoice_url) && (
                          <a href={inv.invoice_pdf || inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="invoice-link">
                            {t('preferences.invoices.downloadLink', locale)}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {invoices.length > 5 && (
                    <button type="button" className="btn-secondary crm-showmore" onClick={() => setInvoicesShowAll(!invoicesShowAll)}>
                      {invoicesShowAll
                        ? t('preferences.invoices.showLess', locale)
                        : t('preferences.invoices.showMoreTemplate', locale).replace('{count}', invoices.length - 5)}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'suggestions' && <TeamSuggestionsPanel userId={userId} locale={locale} />}

      {seatModalOpen && (
        <AddTeamSeatModal
          seat={editingSeat}
          locale={locale}
          onClose={() => setSeatModalOpen(false)}
          onSaved={(seat, isNew) => {
            setSeatModalOpen(false);
            if (isNew) setSeats((prev) => [...prev, seat]);
            else setSeats((prev) => prev.map((s) => (s.id === seat.id ? { ...s, ...seat } : s)));
          }}
        />
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
          /* Audit mobile 27/08/2026 : 2 champs date + leurs libellés "De"/
             "à" étaient trop serrés sur ~375px de large sans passer à la
             ligne. */
          flex-wrap: wrap;
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
        .error {
          color: var(--accent-red, #e5484d);
          font-size: 0.82rem;
          margin: 0;
        }
        .seat-status {
          display: inline-block;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          font-size: 0.76rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .seat-status-pending {
          background: rgba(245, 166, 35, 0.15);
          color: #f5a623;
        }
        .seat-status-active {
          background: rgba(46, 204, 113, 0.15);
          color: var(--accent-green, #2ecc71);
        }
        .seat-status-cancelled {
          background: rgba(229, 72, 77, 0.15);
          color: var(--accent-red, #e5484d);
        }
        .seat-code-cell {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .seat-code {
          font-size: 0.78rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.2rem 0.5rem;
        }
        .seat-actions-cell {
          display: flex;
          gap: 0.7rem;
          flex-wrap: wrap;
        }
        .link-btn {
          background: none;
          border: none;
          padding: 0;
          color: var(--accent);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
        }
        .link-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .link-btn-danger {
          color: var(--accent-red, #e5484d);
        }
        .billing-section {
          margin-top: 0.6rem;
        }
        .field label {
          display: block;
          font-size: 0.9rem;
          margin-bottom: 0.7rem;
        }
        .usage-box {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1rem;
        }
        .usage-hint {
          font-size: 0.74rem;
          color: var(--muted);
          margin: 0;
          line-height: 1.4;
        }
        .invoices-list {
          list-style: none;
          margin: 0.6rem 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .invoice-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.82rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid var(--border);
        }
        .invoice-row:last-child {
          border-bottom: none;
        }
        .invoice-link {
          color: var(--accent);
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
          margin-left: 0.8rem;
        }
        .crm-showmore {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1.1rem;
          font-size: 0.84rem;
          cursor: pointer;
          margin-top: 1rem;
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
          /* Audit mobile 27/08/2026 : code + bouton "Copier" pouvaient être
             rognés par le garde-fou overflow-x:hidden global sur un écran
             étroit, rendant le code partiellement illisible/impossible à
             copier "à l'oeil". */
          flex-wrap: wrap;
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
        .credits-boost-mark {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--text);
          opacity: 0.55;
          border-radius: 2px;
        }
        .credits-boost-note {
          margin-top: 0.35rem;
        }
        .credits-warn {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
          justify-content: space-between;
          border-radius: 10px;
          padding: 0.7rem 0.9rem;
          margin: 0.2rem 0 0.9rem;
          font-size: 0.82rem;
          line-height: 1.45;
          border: 1px solid;
        }
        .credits-warn.soft {
          border-color: rgba(212, 160, 23, 0.5);
          background: rgba(212, 160, 23, 0.08);
        }
        .credits-warn.high {
          border-color: rgba(240, 145, 78, 0.6);
          background: rgba(240, 145, 78, 0.1);
        }
        .credits-warn.critical {
          border-color: rgba(229, 72, 77, 0.6);
          background: rgba(229, 72, 77, 0.1);
        }
        .credits-warn-cta {
          flex: 0 0 auto;
          font-weight: 600;
          text-decoration: none;
          color: var(--accent);
          white-space: nowrap;
        }
        .credits-warn-cta:hover {
          text-decoration: underline;
        }
        .credits-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.1rem 1.3rem;
          margin-bottom: 1.2rem;
        }
        .credits-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
        }
        .credits-head h2 {
          font-size: 0.95rem;
          margin: 0;
          font-family: var(--font-display);
        }
        .credits-total {
          font-family: var(--font-mono);
          font-size: 0.86rem;
          color: var(--text);
        }
        .credits-hint {
          font-size: 0.76rem;
          margin: 0.3rem 0 0.8rem;
          line-height: 1.45;
        }
        .credits-bar {
          position: relative; /* ancre du repère de fin des crédits inclus */
          display: flex;
          height: 14px;
          border-radius: 999px;
          overflow: hidden;
          background: var(--bg);
          border: 1px solid var(--border);
        }
        .credits-seg {
          display: block;
          height: 100%;
          transition: width 0.4s var(--ease);
        }
        .credits-seg.shared {
          background: repeating-linear-gradient(45deg, var(--muted-soft), var(--muted-soft) 4px, transparent 4px, transparent 8px);
        }
        .credits-legend {
          list-style: none;
          margin: 0.8rem 0 0;
          padding: 0;
          display: grid;
          gap: 0.35rem;
        }
        .credits-legend li {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.82rem;
        }
        .credits-dot {
          width: 10px;
          height: 10px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .credits-dot.shared {
          background: repeating-linear-gradient(45deg, var(--muted-soft), var(--muted-soft) 3px, transparent 3px, transparent 6px);
        }
        .credits-name { flex: 1; min-width: 0; }
        .credits-value { font-family: var(--font-mono); font-size: 0.78rem; }
        .credits-pct { font-size: 0.74rem; color: var(--muted); width: 3.5em; text-align: right; }
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

// Modale "Ajouter un compte équipe" / modification d'un compte équipe
// existant (28/08/2026) — voir app/api/team/seats/route.ts et
// app/api/team/seats/[id]/route.ts. Reprend le style de la modale
// "Ajouter un prospect" (app/app/prospects/page.jsx) pour rester cohérent
// avec le reste de l'app plutôt que d'inventer un nouveau style de modale.
function AddTeamSeatModal({ seat, locale, onClose, onSaved }) {
  const isEditing = Boolean(seat);
  const [firstName, setFirstName] = useState(seat?.first_name || '');
  const [lastName, setLastName] = useState(seat?.last_name || '');
  const [jobTitle, setJobTitle] = useState(seat?.job_title || '');
  const [email, setEmail] = useState(seat?.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Abonnement unique Aaron (docx Modifs Aaron, 30/08/2026 + décision Alex
  // 31/08 : "on ne garde que l'abonnement aaron à 30 €") : plus de choix de
  // modules par siège — chaque compte équipe = un abonnement Aaron complet,
  // le serveur (app/api/team/seats/route.ts) ne lit plus `modules`.
  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body = { first_name: firstName, last_name: lastName, job_title: jobTitle, email };
    const res = await fetch(isEditing ? `/api/team/seats/${seat.id}` : '/api/team/seats', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(resBody.error || t('team.seatActionErrorFallback', locale));
      return;
    }

    onSaved(resBody.seat, !isEditing);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{isEditing ? t('team.editSeatModalTitle', locale) : t('team.addSeatModalTitle', locale)}</h2>
        <p className="hint">{t('team.addSeatModalHint', locale)}</p>

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
          {t('prospects.colJobTitle', locale)} {t('prospects.optionalSuffix', locale)}
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </label>

        <label>
          {t('modal.email', locale)}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        {!isEditing && <p className="seat-plan-line">{t('team.addSeatPlanLine', locale)}</p>}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', locale)}</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('team.addSeatSubmitting', locale) : isEditing ? t('team.editSeatSubmit', locale) : t('team.addSeatSubmit', locale)}
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
          /* Capture Alex (31/08/2026) : modale coupée à gauche sur écran
             étroit — 420px + padding sans box-sizing dépassait la largeur
             disponible et l'overlay centré rendait le début invisible. */
          box-sizing: border-box;
          width: min(420px, 100%);
          max-height: 88vh;
          overflow-y: auto;
        }
        @media (max-width: 480px) {
          .modal {
            padding: 1.2rem 1rem;
          }
          .name-row {
            grid-template-columns: 1fr;
          }
        }
        .seat-plan-line {
          font-size: 0.82rem;
          color: var(--muted);
          margin: 0 0 1rem;
          line-height: 1.4;
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
          margin-bottom: 0.9rem;
        }
        input {
          padding: 0.6rem 0.75rem;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          font-size: 0.88rem;
          font-family: inherit;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }
        .name-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.8rem;
        }
        .error {
          color: var(--accent-red, #e5484d);
          font-size: 0.82rem;
          margin: 0 0 0.8rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.65rem 1.2rem;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          border: none;
          color: #fff;
          border-radius: var(--radius-sm);
          padding: 0.65rem 1.2rem;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: wait;
        }
      `}</style>
    </div>
  );
}

// Onglet "Suggestions de l'équipe" (docx Modifs Aaron, 30/08/2026) : le
// contenu de l'ancienne rubrique Suggestions de la barre latérale, déplacé
// ici — même API /api/feedback, mêmes cartes, mêmes textes (clés
// suggestions.* de lib/i18n.js). La page /app/suggestions d'origine reste
// accessible par URL directe mais n'est plus dans la navigation.
function TeamSuggestionsPanel({ userId, locale }) {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadErrorStatus, setLoadErrorStatus] = useState(null);

  function loadFeedback() {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    setLoadErrorStatus(null);
    fetch(`/api/feedback?user_id=${userId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, status: r.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          setLoadError(body.error);
          setLoadErrorStatus(status);
        } else {
          setFeedback(body.feedback || []);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoadError(t('preferences.loadError', locale));
        setLoadErrorStatus(null);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div className="suggestions-panel">
      <p className="panel-subtitle">{t('suggestions.subtitle', locale)}</p>
      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : loadError ? (
        <div>
          <EmptyState
            title={loadErrorStatus === 403 ? t('suggestions.accessDenied', locale) : t('preferences.loadError', locale)}
            body={loadError}
          />
          <button type="button" onClick={loadFeedback} style={{ marginTop: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.2rem', fontSize: '0.86rem', cursor: 'pointer' }}>
            {t('common.retry', locale)}
          </button>
        </div>
      ) : feedback.length === 0 ? (
        <EmptyState title={t('suggestions.emptyTitle', locale)} body={t('suggestions.emptyBody', locale)} />
      ) : (
        <div className="list">
          {feedback.map((f) => (
            <div className="card" key={f.id}>
              <div className="card-top">
                <span className="author">{f.users?.full_name || t('suggestions.defaultAuthor', locale)}</span>
                <span className={`source-badge ${f.source === 'chat_auto' ? 'auto' : 'manual'}`}>
                  {f.source === 'chat_auto' ? t('suggestions.sourceAuto', locale) : t('suggestions.sourceManual', locale)}
                </span>
                <span className="date">{new Date(f.created_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
              <p className="message">{f.message}</p>
              {f.context && f.context !== f.message && (
                <p className="context">« {f.context} »</p>
              )}
            </div>
          ))}
        </div>
      )}
      <style jsx>{`
        .suggestions-panel {
          margin-top: 0.4rem;
        }
        .panel-subtitle {
          color: var(--muted);
          font-size: 0.86rem;
          max-width: 620px;
          margin: 0 0 1.2rem;
        }
        .muted {
          color: var(--muted);
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          max-width: 720px;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1.1rem 1.3rem;
        }
        .card-top {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.6rem;
        }
        .author {
          font-weight: 600;
          font-size: 0.88rem;
        }
        .source-badge {
          font-size: 0.72rem;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .source-badge.auto {
          border-color: var(--accent);
          color: var(--accent);
          background: rgba(75, 57, 239, 0.1);
        }
        .date {
          margin-left: auto;
          font-size: 0.76rem;
          color: var(--muted);
        }
        .message {
          margin: 0 0 0.4rem;
          font-size: 0.92rem;
          line-height: 1.5;
        }
        .context {
          margin: 0;
          font-size: 0.8rem;
          color: var(--muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

// Coût API affiché en euros (les coûts Anthropic sont calculés en dollars,
// voir lib/anthropic-client.ts) — conversion volontairement approximative et
// fixe : cette jauge sert à voir QUI consomme, pas à facturer au centime.
const USD_TO_EUR = 0.92;
function formatEur(usd) {
  const eur = (Number(usd) || 0) * USD_TO_EUR;
  if (eur > 0 && eur < 0.01) return '< 0,01 €';
  return eur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
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
