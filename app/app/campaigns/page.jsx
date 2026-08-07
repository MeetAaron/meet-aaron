// app/app/campaigns/page.jsx
'use client';

import { useEffect, useState } from 'react';

function useCurrentUserId() {
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setUserId(params.get('user_id'));
  }, []);
  return userId;
}

const STATUS_LABELS = {
  en_attente: { label: 'En attente', color: '#8B90A8' },
  en_cours: { label: 'En cours', color: '#4B9EF0' },
  terminee: { label: 'Terminée', color: '#3DD68C' },
  en_pause: { label: 'En pause', color: '#F0914E' },
};

const ZONE_TYPE_LABELS = {
  departement: 'Département',
  region: 'Région',
  ville: 'Ville',
};

export default function CampaignsPage() {
  const userId = useCurrentUserId();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [companyId, setCompanyId] = useState(null);

  async function loadCampaigns() {
    setLoading(true);
    const res = await fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json());
    setCampaigns(res.campaigns || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadCampaigns();
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setCompanyId(res.user.company_id);
      });
  }, [userId]);

  if (!userId) {
    return (
      <Shell active="Campagnes">
        <EmptyState title="Aucun identifiant commercial" body="Ouvrez cette page avec ?user_id=... dans l'URL." />
      </Shell>
    );
  }

  return (
    <Shell active="Campagnes">
      <header className="header">
        <div>
          <p className="eyebrow">Prospection</p>
          <h1>Vos campagnes</h1>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Nouvelle campagne
        </button>
      </header>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title="Aucune campagne" body="Lancez votre première campagne pour qu'Aaron commence à chercher des prospects." />
      ) : (
        <div className="cards">
          {campaigns.map((c) => {
            const status = STATUS_LABELS[c.status] || STATUS_LABELS.en_attente;
            const progress = c.target_count > 0 ? Math.min(100, Math.round((c.contacts_found / c.target_count) * 100)) : 0;
            return (
              <div className="card" key={c.id}>
                <div className="card-top">
                  <div>
                    <h3>{c.zone_label}</h3>
                    <p className="muted">{c.sector_keywords?.join(', ')}</p>
                  </div>
                  <span className="status-pill" style={{ color: status.color, borderColor: status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="card-bottom">
                  <span>{c.contacts_found} / {c.target_count} contacts trouvés</span>
                  <span className="muted">{c.companies_found}
