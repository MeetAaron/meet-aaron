// app/app/prospects/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

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

  async function loadProspects() {
    setLoading(true);
    const res = await fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json());
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

  async function handleConfirmWon() {
    setActingOn(wonProspect.id);
    await fetch(`/api/prospects/${wonProspect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'marquer_gagne' }),
    });
    setActingOn(null);
    setWonProspect(null);
    loadProspects();
  }

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
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                        <span className="dot" style={{ background: meta.color }} />
                        {meta.label}
                      </span>
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
                        <span className="tag">{PERSONALITY_LABELS[p.personality_type] || p.personality_type}</span>
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
                      <button
                        type="button"
                        className="action-btn thread"
                        onClick={() => setThreadProspect(p)}
                        title="Voir l'historique des échanges et l'avis d'Aaron"
                      >
                        💬 Conversation
                      </button>
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

      {wonProspect && (
        <div className="overlay" onClick={() => setWonProspect(null)}>
          <div className="won-modal" onClick={(e) => e.stopPropagation()}>
            <p className="won-title">Félicitations ! 🎉</p>
            <p className="won-body">
              Aaron : « Comment as-tu réussi ton coup avec {wonProspect.full_name} ? »
              <br />
              {wonProspect.full_name} va passer dans tes clients gagnés et sortir de ton pipeline prospects.
            </p>
            <div className="won-actions">
              <button type="button" className="btn-secondary" onClick={() => setWonProspect(null)}>Annuler</button>
              <button type="button" className="btn-primary" onClick={handleConfirmWon}>Confirmer, c'est gagné !</button>
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
          overflow: hidden;
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
          z-index: 50;
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
          margin: 0 0 1.4rem;
        }
        .won-actions {
          display: flex;
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
          Dès l'enregistrement, Aaron envoie le premier email (généralement dans les minutes qui suivent,
          selon le temps de génération de la réponse) et complètera la fiche au fil des échanges.
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
          z-index: 50;
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
              <span className="tag">{PERSONALITY_LABELS[prospect.personality_type] || prospect.personality_type}</span>
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
          z-index: 50;
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
          z-index: 50;
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
  const NAV_ITEMS = [
    { label: 'Tableau de bord', slug: 'dashboard', icon: '📊' },
    { label: 'Prospects', slug: 'prospects', icon: '🎯' },
    { label: 'Campagnes', slug: 'campaigns', icon: '🚀' },
    { label: 'Agenda', slug: 'agenda', icon: '📅' },
    { label: 'Aaron Sales', slug: 'sales', icon: '🤝' },
    { label: 'Aaron Customer', slug: 'customer', icon: '🌟' },
    { label: 'Résultats', slug: 'resultats', icon: '📈' },
    { label: 'Mes documents', slug: 'documents', icon: '📁' },
    { label: 'Chat avec Aaron', slug: 'chat', icon: '💬' },
    { label: 'Connexions', slug: 'connexions', icon: '🔗' },
    { label: 'Disponibilités', slug: 'disponibilites', icon: '🕒' },
    { label: 'Préférences', slug: 'preferences', icon: '⚙️' },
    { label: 'Mon équipe', slug: 'team', icon: '👥' },
    { label: 'Suggestions', slug: 'suggestions', icon: '💡' },
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
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={item.label === active ? 'active' : ''}><span className="nav-icon">{item.icon}</span>{item.label}</li>
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
