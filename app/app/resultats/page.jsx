// app/app/resultats/page.jsx
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

function exportWonClientsToCsv(clients) {
  const headers = ['Nom', 'Société', 'Email', 'Téléphone', 'Client depuis'];
  const rows = clients.map((c) => [
    c.full_name,
    c.prospect_companies?.name || '',
    c.email,
    c.phone || '',
    c.won_at ? new Date(c.won_at).toLocaleDateString('fr-FR') : '',
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `clients-gagnes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ResultatsPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [prospects, setProspects] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [wonClients, setWonClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/won-clients?user_id=${userId}`).then((r) => r.json()),
    ]).then(([pRes, aRes, cRes, wRes]) => {
      setProspects(pRes.prospects || []);
      setAppointments(aRes.appointments || []);
      setCampaigns(cRes.campaigns || []);
      setWonClients(wRes.wonClients || []);
      setLoading(false);
    });
  }, [userId]);

  async function handleEmailExport() {
    setEmailing(true);
    await fetch('/api/won-clients/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    setEmailing(false);
    setShowExportMenu(false);
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
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

  const TYPE_LABELS = { telephonique: 'Téléphonique', physique: 'Physique', visio: 'Visio' };
  const TYPE_ICONS = { telephonique: '📞', physique: '🤝', visio: '💻' };

  const totalProspects = prospects.length;
  const rdvConfirmes = appointments.filter((a) => a.status === 'validé' || a.status === 'terminé');
  const rdvObtenus = rdvConfirmes.length;
  const rdvEnAttente = appointments.filter((a) => a.status === 'proposé').length;
  const tauxRdv = totalProspects > 0 ? Math.round((rdvObtenus / totalProspects) * 100) : 0;
  const rdvParType = Object.keys(TYPE_LABELS).map((type) => ({
    type,
    label: TYPE_LABELS[type],
    count: rdvConfirmes.filter((a) => a.type === type).length,
  }));
  const contactsSources = campaigns.reduce((sum, c) => sum + (c.contacts_found || 0), 0);
  const entreprisesAnalysees = campaigns.reduce((sum, c) => sum + (c.companies_found || 0), 0);
  const tauxContact = entreprisesAnalysees > 0 ? Math.round((contactsSources / entreprisesAnalysees) * 100) : 0;

  return (
    <Shell active="Résultats" userId={userId}>
      <header className="header">
        <p className="eyebrow">Performance</p>
        <h1>Vos résultats</h1>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <section className="stat-grid">
            <StatCard label="Prospects contactés" value={totalProspects} />
            <StatCard
              label="RDV obtenus"
              value={rdvObtenus}
              accent
              hint={rdvObtenus > 0 ? rdvParType.filter((t) => t.count > 0).map((t) => `${TYPE_ICONS[t.type]} ${t.count} ${t.label.toLowerCase()}`).join(' · ') : undefined}
            />
            <StatCard label="RDV en attente de validation" value={rdvEnAttente} />
            <StatCard label="Taux de transformation" value={`${tauxRdv}%`} hint="prospects → RDV" />
          </section>

          <section className="panel">
            <h2>Sourcing</h2>
            <div className="sourcing-row">
              <div>
                <span className="big-number">{entreprisesAnalysees}</span>
                <span className="muted"> entreprises analysées par Aaron</span>
              </div>
              <div>
                <span className="big-number">{contactsSources}</span>
                <span className="muted"> contacts qualifiés trouvés</span>
              </div>
              <div>
                <span className="big-number">{tauxContact}%</span>
                <span className="muted"> taux de contact trouvé</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Détail par campagne</h2>
            {campaigns.length === 0 ? (
              <p className="muted">Aucune campagne lancée pour le moment.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Secteur</th>
                    <th>Entreprises analysées</th>
                    <th>Contacts trouvés</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>{c.zone_label}</td>
                      <td className="muted">{c.sector_keywords?.join(', ')}</td>
                      <td>{c.companies_found}</td>
                      <td>{c.contacts_found} / {c.target_count}</td>
                      <td className="muted">{c.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>🏆 Clients gagnés</h2>
              {wonClients.length > 0 && (
                <div className="export-wrap">
                  <button className="btn-export" onClick={() => setShowExportMenu(!showExportMenu)}>
                    Extraire ▾
                  </button>
                  {showExportMenu && (
                    <div className="export-menu">
                      <button onClick={() => { exportWonClientsToCsv(wonClients); setShowExportMenu(false); }}>
                        Télécharger en CSV
                      </button>
                      <button onClick={handleEmailExport} disabled={emailing}>
                        {emailing ? 'Envoi…' : 'Recevoir par email'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {emailSent && <p className="email-sent">Le fichier a été envoyé à ton adresse email !</p>}

            {wonClients.length === 0 ? (
              <p className="muted">Pas encore de client gagné — dès qu'un prospect confirme une commande ou un devis après un rendez-vous, il apparaîtra ici.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Société</th>
                      <th>Contact</th>
                      <th>Client depuis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wonClients.map((c) => (
                      <tr key={c.id}>
                        <td className="strong">{c.full_name}</td>
                        <td className="muted">{c.prospect_companies?.name || '—'}</td>
                        <td>
                          <div>{c.email}</div>
                          {c.phone && <div className="muted">{c.phone}</div>}
                        </td>
                        <td className="muted">
                          {c.won_at ? new Date(c.won_at).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

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
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.9rem;
          margin-bottom: 1.5rem;
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
          margin: 0 0 1rem;
        }
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .panel-header h2 {
          margin: 0;
        }
        .sourcing-row {
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
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.86rem;
        }
        thead th {
          text-align: left;
          padding: 0.6rem 0.4rem;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
        }
        tbody td {
          padding: 0.7rem 0.4rem;
          border-bottom: 1px solid var(--border);
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        .strong {
          font-weight: 600;
        }
        .export-wrap {
          position: relative;
        }
        .btn-export {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 10px;
          padding: 0.5rem 0.9rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .export-menu {
          position: absolute;
          top: 110%;
          right: 0;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
          min-width: 190px;
          z-index: 10;
        }
        .export-menu button {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: var(--text);
          padding: 0.7rem 1rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .export-menu button:hover {
          background: rgba(75, 57, 239, 0.1);
        }
        .export-menu button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .email-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: #3dd68c;
          padding: 0.7rem 1rem;
          border-radius: 10px;
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
        .table-wrap {
          overflow: hidden;
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
