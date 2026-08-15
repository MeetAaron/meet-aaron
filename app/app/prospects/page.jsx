// app/app/prospects/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';

// Étapes du pipeline Aaron Opportunité (voir NON_TERMINAL_STAGES dans
// app/app/sales/page.jsx) considérées "en cours de traitement" : un
// prospect qui y entre est désormais suivi dans Aaron Opportunité et ne
// doit plus apparaître dans la liste brute des prospects, pour éviter le
// doublon d'affichage entre les deux pages. Les étapes terminales (signé /
// perdu) restent visibles ici, cohérent avec le badge "🏆 Gagné" existant
// et avec le traitement des prospects perdus depuis cette page elle-même
// (action marquer_perdu, qui ne touche pas deal_stage).
const NON_TERMINAL_DEAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];

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

const STATUS_META = {
  vert: { label: 'En bonne voie', color: '#3DD68C' },
  jaune: { label: 'En cours', color: '#8B90A8' },
  orange: { label: 'Risque de perdre', color: '#F0914E' },
  rouge: { label: 'Perdu', color: '#E5484D' },
  bleu: { label: 'RDV obtenu', color: '#4B9EF0' },
};

const PERSONALITY_LABELS = {
  dominant: 'Dominant',
  influent: 'Influent',
  stable: 'Stable',
  consciencieux: 'Consciencieux',
};

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

const PERSONALITY_COLOR_LEGEND = 'Couleurs DISC — Dominant : rouge · Influent : jaune · Stable : vert · Consciencieux : bleu';

function exportProspectsToCsv(prospects) {
  const headers = ['Statut', 'Nom', 'Société', 'Poste', 'Email', 'Téléphone', 'Personnalité ressentie', "Conseils d'Aaron"];
  const rows = prospects.map((p) => [
    STATUS_META[p.status]?.label || p.status,
    p.full_name,
    p.prospect_companies?.name || '',
    p.job_title || '',
    p.email,
    p.phone || '',
    PERSONALITY_LABELS[p.personality_type] || '',
    p.aaron_advice || '',
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ProspectsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('tous');
  const [companyId, setCompanyId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [linkedinProspect, setLinkedinProspect] = useState(null);
  const [wonProspect, setWonProspect] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [search, setSearch] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [threadProspect, setThreadProspect] = useState(null);
  const [pendingEmailProspect, setPendingEmailProspect] = useState(null);

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
    if (!window.confirm(`Tu es certain de vouloir supprimer "${prospect.full_name}" ? Cette action est définitive (échanges et RDV liés seront aussi supprimés).`)) {
      return;
    }
    setActingOn(prospect.id);
    await fetch(`/api/prospects/${prospect.id}`, { method: 'DELETE' });
    setActingOn(null);
    loadProspects();
  }

  async function handleMarkLost(prospect) {
    if (!window.confirm(`Passer "${prospect.full_name}" en perdu ? Aaron arrêtera de le recontacter et tu pourras le gérer toi-même.`)) {
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

  return (
    <Shell active="Prospects" userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Vos prospects</h1>
        </div>
        <div className="header-actions">
          {prospects.length > 0 && (
            <button
              className={detailed ? 'btn-secondary active' : 'btn-secondary'}
              onClick={() => setDetailed((d) => !d)}
            >
              {detailed ? 'Vue simple' : 'Vue détaillée'}
            </button>
          )}
          {prospects.length > 0 && (
            <button className="btn-secondary" onClick={() => exportProspectsToCsv(filtered)}>
              Télécharger en CSV
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            + Ajouter un prospect
          </button>
        </div>
      </header>

      {pendingFirstEmails.length > 0 && (
        <div className="pending-banner">
          ✉️ {pendingFirstEmails.length} premier{pendingFirstEmails.length > 1 ? 's' : ''} email{pendingFirstEmails.length > 1 ? 's' : ''} en attente de validation avant envoi.
          <button type="button" className="pending-banner-btn" onClick={() => setPendingEmailProspect(pendingFirstEmails[0])}>
            Relire maintenant
          </button>
        </div>
      )}

      {prospects.length > 0 && (
        <div className="search-row">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un prospect (nom, société, email, téléphone, poste)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch('')}>
              Effacer
            </button>
          )}
        </div>
      )}

      <div className="filters">
        <button className={statusFilter === 'tous' ? 'chip active' : 'chip'} onClick={() => setStatusFilter('tous')}>
          Tous ({prospects.length})
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
          {filtered.length} résultat{filtered.length !== 1 ? 's' : ''} pour « {search.trim()} »
        </p>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun prospect ici"
          body={
            prospects.length === 0
              ? "Lancez une campagne ou ajoutez un prospect manuellement."
              : searchTerm
              ? "Aucun prospect ne correspond à cette recherche."
              : "Aucun prospect ne correspond à ce filtre."
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Statut</th>
                <th>Nom</th>
                <th>Société</th>
                {detailed && <th>Poste</th>}
                <th>Personnalité ressentie</th>
                <th>Conseils d'Aaron</th>
                <th>Contact</th>
                <th>Actions</th>
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
                        <span className="status-pill" style={{ color: '#D4A017', borderColor: '#D4A017' }} title="Le prospect a été marqué gagné, en attente de confirmation de la 1ère commande">
                          <span className="dot" style={{ background: '#D4A017' }} />
                          🏆 Gagné — en attente
                        </span>
                      ) : (
                        <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                          <span className="dot" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                      )}
                    </td>
                    <td className="strong">{p.full_name}</td>
                    <td className="muted">
                      {p.prospect_companies?.name || '—'}
                      {otherContacts > 0 && (
                        <button
                          type="button"
                          className="company-badge"
                          title={`${otherContacts} autre${otherContacts > 1 ? 's' : ''} contact${otherContacts > 1 ? 's' : ''} chez cette société — clique pour les voir`}
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
                        <span className="muted">Pas encore détectée</span>
                      )}
                      {p.personality_notes && <p className="notes">{p.personality_notes}</p>}
                    </td>
                    <td className="advice">{p.aaron_advice || <span className="muted">—</span>}</td>
                    <td className="contact">
                      <div>{p.email}</div>
                      {p.phone && <div className="muted">{p.phone}</div>}
                      <button type="button" className="li-btn" onClick={() => setLinkedinProspect(p)}>
                        Message LinkedIn
                      </button>
                    </td>
                    <td className="row-actions-cell">
                      {p.pending_first_email_subject && (
                        <button
                          type="button"
                          className="action-btn pending-email"
                          onClick={() => setPendingEmailProspect(p)}
                          title="Aaron a préparé le premier email — à relire avant envoi"
                        >
                          ✉️ Valider le 1er email
                        </button>
                      )}
                      <button
                        type="button"
                        className="action-btn thread"
                        onClick={() => setThreadProspect(p)}
                        title="Voir l'historique des échanges et l'avis d'Aaron"
                      >
                        💬 Conversation
                      </button>
                      {wonUnconfirmed ? (
                        <button
                          type="button"
                          className="action-btn won"
                          disabled={actingOn === p.id}
                          onClick={() => handleConfirmFirstOrder(p)}
                          title="Confirmer que la 1ère commande a bien été passée : le prospect bascule dans Clients gagnés"
                        >
                          ✅ Confirmer la commande
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="action-btn won"
                            disabled={actingOn === p.id}
                            onClick={() => setWonProspect(p)}
                            title="Le prospect devient client : il sera déplacé vers Résultats > Clients gagnés"
                          >
                            🏆 Gagné
                          </button>
                          <button
                            type="button"
                            className="action-btn lost"
                            disabled={actingOn === p.id}
                            onClick={() => handleMarkLost(p)}
                            title="Le prospect ne deviendra pas client : Aaron arrête de le relancer"
                          >
                            Perdu
                          </button>
                        </>
                      )}
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
      )}

      {linkedinProspect && (
        <LinkedInDraftModal prospect={linkedinProspect} onClose={() => setLinkedinProspect(null)} />
      )}

      {threadProspect && (
        <ConversationModal prospect={threadProspect} onClose={() => setThreadProspect(null)} />
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
            <p className="won-title">Félicitations ! 🎉</p>
            <p className="won-body">
              Aaron : « Comment as-tu réussi ton coup avec {wonProspect.full_name} ? »
              <br />
              Une première commande a-t-elle déjà été passée ?
            </p>
            <p className="won-hint">
              Oui → {wonProspect.full_name} bascule directement en client (Résultats › Clients gagnés, Aaron Client).<br />
              Pas encore → il reste dans Prospects sous « 🏆 Gagné — en attente de 1ère commande » jusqu'à ce que tu confirmes la commande.
            </p>
            <div className="won-actions">
              <button type="button" className="btn-secondary" onClick={() => setWonProspect(null)}>Annuler</button>
              <button type="button" className="btn-secondary" disabled={actingOn === wonProspect.id} onClick={() => handleConfirmWon(false)}>Pas encore de commande</button>
              <button type="button" className="btn-primary" disabled={actingOn === wonProspect.id} onClick={() => handleConfirmWon(true)}>Oui, commande passée !</button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <AddProspectModal
          userId={userId}
          companyId={companyId}
          onClose={() => setShowAddForm(false)}
          onCreated={(emailWarning) => {
            setShowAddForm(false);
            loadProspects();
            if (emailWarning) {
              window.alert(emailWarning);
            }
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
          gap: 0.6rem;
        }
        .btn-secondary {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 10px;
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
          border-radius: 10px;
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
          border-radius: 10px;
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
          border-radius: 10px;
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
        .table-wrap {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
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
          border-radius: 6px;
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
          border-radius: 6px;
          padding: 0.25rem 0.55rem;
          font-size: 0.72rem;
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
          border-radius: 6px;
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
          border-color: #e5484d;
          color: #e5484d;
        }
        .action-btn.thread {
          border-color: var(--accent);
          color: var(--accent);
        }
        .action-btn.pending-email {
          border-color: #d4a017;
          color: #d4a017;
          font-weight: 600;
        }
        .pending-banner {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.8rem;
          background: rgba(212, 160, 23, 0.12);
          border: 1px solid #d4a017;
          color: var(--text);
          border-radius: 10px;
          padding: 0.8rem 1.1rem;
          font-size: 0.86rem;
          margin-bottom: 1.2rem;
        }
        .pending-banner-btn {
          background: #d4a017;
          color: #131629;
          border: none;
          border-radius: 8px;
          padding: 0.4rem 0.9rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .action-btn.delete {
          color: #e5484d;
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
          border-radius: 16px;
          padding: 1.8rem;
          width: 420px;
          max-width: 100%;
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

function AddProspectModal({ userId, companyId, onClose, onCreated }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

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
      }),
    });

    setSubmitting(false);

    const body = await res.json();

    if (!res.ok) {
      setError(body.error || 'Erreur lors de la création');
      return;
    }

    onCreated(body.emailWarning || null);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Ajouter un prospect</h2>
        <p className="hint">
          Renseignez juste l'essentiel — comme sur une carte de visite, le reste n'est pas obligatoire.
          Dès l'enregistrement, Aaron prépare le premier email (envoyé automatiquement dans les minutes qui
          suivent, ou proposé à ta validation si tu as activé cette option dans Préférences) et complètera la
          fiche au fil des échanges.
        </p>

        <div className="name-row">
          <label>
            Prénom
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: Marie" required />
          </label>
          <label>
            Nom
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Dupont" required />
          </label>
        </div>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex: marie.dupont@societe.fr" required />
        </label>

        <label>
          Téléphone (optionnel)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="ex: 06 12 34 56 78" />
        </label>

        <label>
          Poste (optionnel)
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="ex: Directrice des achats" />
        </label>

        <label>
          Société (optionnel)
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ex: Dupont SAS" />
        </label>

        <label>
          LinkedIn (optionnel)
          <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="ex: linkedin.com/in/marie-dupont" />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Création…' : 'Ajouter et démarrer'}
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
          border-radius: 16px;
          padding: 1.8rem;
          width: 420px;
          max-width: 100%;
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
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.88rem;
        }
        .error {
          color: #e5484d;
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
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.6rem 1rem;
          cursor: pointer;
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
function ConversationModal({ prospect, onClose }) {
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
        if (!res.ok) throw new Error(body.error || 'Erreur de chargement');
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
          <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
        </div>

        <section className="detail-block">
          <h3>Avis d'Aaron sur ce prospect</h3>
          {prospect.personality_type ? (
            <p className="advice-line">
              <span className="tag" style={personalityTagStyle(prospect.personality_type)} title={PERSONALITY_COLOR_LEGEND}>{PERSONALITY_LABELS[prospect.personality_type] || prospect.personality_type}</span>
              {prospect.personality_notes && <span> — {prospect.personality_notes}</span>}
            </p>
          ) : (
            <p className="muted">Profil pas encore détecté (se précise après une première réponse du prospect).</p>
          )}
          {prospect.aaron_advice && <p className="advice-line">{prospect.aaron_advice}</p>}
        </section>

        <section className="detail-block">
          <h3>Historique des échanges</h3>
          {loading ? (
            <p className="muted">Chargement…</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : messages.length === 0 ? (
            <p className="muted">Aucun échange pour le moment.</p>
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <div className={`msg msg-${m.direction}`} key={i}>
                  <p className="msg-meta">
                    {m.direction === 'outbound' ? (
                      <span className="ai-badge" title="Rédigé et envoyé automatiquement par Aaron">🤖 Généré par Aaron</span>
                    ) : (
                      'Réponse du prospect'
                    )}
                    {' — '}
                    {new Date(m.sent_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
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
          border-radius: 16px;
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
          border-radius: 8px;
          padding: 0.45rem 0.8rem;
          font-size: 0.8rem;
          cursor: pointer;
          flex-shrink: 0;
        }
        .muted {
          color: var(--muted);
        }
        .error {
          color: #e5484d;
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
          border-radius: 6px;
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
          border-radius: 10px;
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
      setError(b.error || "Erreur lors de l'envoi");
      return;
    }
    onDone();
  }

  async function handleReject() {
    if (!window.confirm(`Ne pas envoyer ce premier email à ${prospect.full_name} ? Le prospect restera dans ta liste sans avoir été contacté.`)) {
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
      setError(b.error || 'Erreur');
      return;
    }
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Premier email pour {prospect.full_name}</h2>
        <p className="hint">
          Aaron a préparé ce premier email — relis-le, modifie-le si besoin, puis envoie-le. Les relances suivantes
          restent automatiques (tu peux changer ce réglage dans Préférences).
        </p>

        <label>
          Objet
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label>
          Message
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={sending || rejecting}>
            Plus tard
          </button>
          <button type="button" className="btn-secondary reject" onClick={handleReject} disabled={sending || rejecting}>
            {rejecting ? '…' : 'Ne pas envoyer'}
          </button>
          <button type="button" className="btn-primary" onClick={handleSend} disabled={sending || rejecting || !subject.trim() || !body.trim()}>
            {sending ? 'Envoi…' : 'Envoyer maintenant'}
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
          border-radius: 16px;
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
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .error {
          color: #e5484d;
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
          border-radius: 8px;
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
          border-radius: 8px;
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .btn-secondary.reject {
          border-color: #e5484d;
          color: #e5484d;
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
          setError(body.error || 'Erreur');
        } else {
          setDraft(body.draft);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Erreur réseau');
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
        <h2>Message LinkedIn pour {prospect.full_name}</h2>
        <p className="hint">
          Aaron propose ce texte — c'est à toi de le coller et de l'envoyer depuis ton propre compte LinkedIn
          (rien n'est envoyé automatiquement).
        </p>

        {loading && <p className="muted">Rédaction en cours…</p>}
        {error && <p className="error">{error}</p>}

        {draft && (
          <>
            {draft.linkedin_url ? (
              <a href={draft.linkedin_url} target="_blank" rel="noreferrer" className="li-profile-link">
                Ouvrir le profil LinkedIn ↗
              </a>
            ) : (
              <p className="muted small">Profil LinkedIn non identifié — cherche {prospect.full_name} manuellement sur LinkedIn.</p>
            )}

            <label>
              Note de demande de connexion
              <textarea readOnly value={draft.connection_note} rows={3} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => copy(draft.connection_note, 'note')}>
              {copied === 'note' ? 'Copié ✓' : 'Copier la note'}
            </button>

            <label style={{ marginTop: '1rem' }}>
              Premier message (une fois connecté)
              <textarea readOnly value={draft.first_message} rows={4} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => copy(draft.first_message, 'message')}>
              {copied === 'message' ? 'Copié ✓' : 'Copier le message'}
            </button>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn-primary" onClick={onClose}>Fermer</button>
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
          border-radius: 16px;
          padding: 1.8rem;
          width: 480px;
          max-width: 100%;
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
          border-radius: 8px;
          padding: 0.6rem 0.8rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .error {
          color: #e5484d;
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
          border-radius: 8px;
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
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
          border-radius: 14px;
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
