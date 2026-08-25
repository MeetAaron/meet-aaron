// app/app/dashboard/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import { HorizontalBarChart } from '@/components/charts/MiniBarChart';

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

// Couleurs par statut — les libellés sont traduits via t('status.<clé>', locale)
// (voir lib/i18n.js) plutôt que codés en dur ici.
//
// CHANGEMENTS A FAIRE #4 (2026-08-15, précisé par Alex le 2026-08-20) : dans
// la rangée de stats du tableau de bord, "RDV obtenu" (bleu) n'est plus un
// simple comptage du statut prospect (qui ne redescend jamais tout seul, donc
// grossirait indéfiniment) — c'est désormais une carte dédiée, affichée EN
// PREMIER (tout à gauche, avant "en bonne voie" — demande explicite d'Alex :
// "attention rdv obtenu doit être tout à gauche"). La fenêtre de calcul
// (voir rdvObtenus24h plus bas) n'est PAS un glissant de 24h mais le jour
// calendaire en cours (minuit à 23h59, heure du navigateur) — choix explicite
// d'Alex face à la question "dernière connexion ou 24h glissantes ?" :
// "je pense qu'il faut faire ces 24 dernières heures (donc de minuit à
// 23h59)". 'bleu' reste dans STATUS_COLORS/STATUS_META (utilisé par
// ActionCardModal pour la pastille de statut d'un prospect) — la rangée de
// stats se contente simplement de ne pas boucler dessus (voir plus bas).
const STATUS_COLORS = {
  vert: '#3DD68C',
  jaune: '#8B90A8',
  orange: '#F0914E',
  rouge: '#E5484D',
  bleu: '#4B9EF0',
};

function statusMetaFor(locale) {
  return Object.fromEntries(
    Object.entries(STATUS_COLORS).map(([key, color]) => [key, { label: t(`status.${key}`, locale), color }])
  );
}

// Catégorie "Opportunités" du tableau de bord (#7) — mêmes codes couleur que
// le pipeline prospects, réutilisés sur les étapes deal_stage (voir
// STAGE_ORDER/STAGE_COLORS dans app/app/sales/page.jsx) :
//  - perdu -> Perdu (rouge)
//  - signe -> Devis signé (bleu — le gain final, distinct du bleu "RDV obtenu")
//  - en_negociation, non en retard -> En bonne voie (vert)
//  - rdv_fait / devis_envoye, non en retard -> En cours (gris/jaune)
//  - n'importe quelle étape non close, sans mise à jour depuis STALE_DEAL_DAYS
//    jours -> Risque de perdre (orange) — même seuil que le rappel automatique
//    d'affaires qui stagnent (voir STALE_DAYS dans app/app/sales/page.jsx et
//    app/api/cron/stale-deals-alert/route.ts).
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

// Catégorie "Clients" du tableau de bord (#8) — basée sur le score de santé
// client déjà calculé pour Aaron Customer (customer_health_label, voir
// app/app/customer/page.jsx / app/api/customers/pipeline).
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

// Regroupe une liste de RDV (triée par date croissante) sous des en-têtes de
// date façon agenda iPhone (#5) : Aujourd'hui, Demain, puis jour de semaine +
// date pour les suivants.
function groupAppointmentsByDay(list, locale) {
  const todayKey = new Date().toDateString();
  const tomorrowKey = new Date(Date.now() + 24 * 60 * 60 * 1000).toDateString();
  const groups = [];
  const byKey = {};

  for (const a of list) {
    const d = new Date(a.proposed_at);
    const key = d.toDateString();
    if (!byKey[key]) {
      let label;
      if (key === todayKey) label = t('common.today', locale);
      else if (key === tomorrowKey) label = t('common.tomorrow', locale);
      else label = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
      byKey[key] = { key, label, items: [] };
      groups.push(byKey[key]);
    }
    byKey[key].items.push(a);
  }

  return groups;
}

export default function DashboardPage() {
  const { userId, authLoading, authError } = useAuthedUser();
  const [locale] = useLocale();
  const STATUS_META = statusMetaFor(locale);
  const OPPORTUNITY_META = opportunityBucketMetaFor(locale);
  const HEALTH_META = healthBucketMetaFor(locale);
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [deals, setDeals] = useState([]);
  const [customers, setCustomers] = useState([]);
  // docx AJOUT GLOBAL (message du 21/08/2026) : le tableau de bord affiche
  // les sections Opportunités/Clients même quand le module correspondant
  // (Aaron Sales / Aaron Clients) n'est pas actif pour cette société — sans
  // ça, un commercial sans ce module voyait un "Aucune opportunité pour
  // l'instant" trompeur, comme s'il avait juste une pipeline vide plutôt
  // qu'un module non inclus dans son abonnement. Même source que
  // lockedModules dans Shell plus bas, dupliquée ici (convention du projet :
  // pas de composant partagé entre Shell et le contenu de la page).
  const [salesModuleActive, setSalesModuleActive] = useState(true);
  const [customerModuleActive, setCustomerModuleActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(true);
 const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedRescue, setSelectedRescue] = useState(null);
  const [acknowledging, setAcknowledging] = useState(null);

  async function loadAll() {
    setLoading(true);
    const [pRes, cRes, aRes, dRes, cuRes, prefRes] = await Promise.all([
      fetch(`/api/prospects?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/preferences?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
    ]);
    setProspects(pRes.prospects || []);
    setCampaigns(cRes.campaigns || []);
    setAppointments(aRes.appointments || []);
    setDeals(dRes.deals || []);
    setCustomers(cuRes.customers || []);
    const prefs = prefRes.preferences || {};
    // Même logique que lockedModules dans Shell/MarketingCampaignsPanel :
    // Aaron Sales et Aaron Clients sont des modules optionnels, actifs
    // seulement si explicitement true (pas de valeur par défaut "activé").
    setSalesModuleActive(prefs.offer_as_active === true);
    setCustomerModuleActive(prefs.offer_ac_active === true);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  async function acknowledgeMissed(appointmentId) {
    setAcknowledging(appointmentId);
    await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'acquitter_manque' }),
    });
    setAcknowledging(null);
    loadAll();
  }

  const activeCampaigns = campaigns.filter((c) => c.status === 'en_cours' || c.status === 'en_attente');

  const now = new Date();
  // Demande Alex (2026-08-22) : toutes les stats du dashboard (prospects,
  // opportunités, clients) ne doivent montrer que les infos de la journée en
  // cours, pas un cumul depuis toujours — même logique de jour calendaire
  // (minuit à 23h59) que rdvObtenus24h ci-dessous, déclarée ici pour être
  // réutilisable par les 3 compteurs.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // #1 — statuts prospects : uniquement les prospects créés aujourd'hui.
  const statusCounts = Object.keys(STATUS_META).reduce((acc, key) => {
    acc[key] = prospects.filter(
      (p) => p.status === key && p.created_at && new Date(p.created_at) >= startOfToday
    ).length;
    return acc;
  }, {});

  // #5 — au moins les 20 prochains RDV validés, regroupés par jour.
  const upcomingAppointments = appointments
    .filter((a) => a.status === 'validé' && new Date(a.proposed_at) > now)
    .slice(0, 20);
  const upcomingGroups = groupAppointmentsByDay(upcomingAppointments, locale);

  // #2 — RDV jamais validés dont la date est dépassée -> bandeau rouge dédié,
  // au lieu de rester noyés (sans distinction visuelle) dans les actions
  // requises classiques. C'est exactement le bug remonté sur le compte test.
  const missedAppointments = appointments.filter(
    (a) => a.status === 'proposé' && new Date(a.proposed_at) < now && !a.missed_action_acknowledged
  );
  // Actions requises "classiques" : uniquement celles encore d'actualité.
  const pendingAppointments = appointments.filter((a) => a.status === 'proposé' && new Date(a.proposed_at) >= now);
  // #3 — annulation client dont le RDV est de toute façon déjà passé : plus
  // la peine de relancer, la notif disparaît d'elle-même (pas d'action requise).
  const cancelledByClient = appointments.filter(
    (a) =>
      a.status === 'annulé' &&
      a.cancelled_by === 'client' &&
      !a.client_cancel_acknowledged &&
      new Date(a.proposed_at) >= now
  );
  // Prospects/A2 (2026-08-20) : un RDV déjà passé qu'on annule côté commercial
  // (voir action "annuler" dans app/api/appointments/[id]/route.ts, qui
  // n'envoie plus le mail "je dois annuler" pour un RDV déjà passé) mérite
  // une relance moins urgente pour reprendre contact, plutôt que rien du
  // tout — même mécanisme d'action ("relancer"/"traiter") que pour un RDV
  // annulé par le client, juste avec un libellé différent.
  const needsReschedule = appointments.filter(
    (a) => a.status === 'annulé' && a.cancelled_by === 'commercial' && !a.client_cancel_acknowledged
  );
  const rescueProspects = prospects.filter((p) => p.rescue_proposal_pending);
  const totalActions =
    pendingAppointments.length + cancelledByClient.length + needsReschedule.length + rescueProspects.length;

  // #4/#9A — "RDV obtenu" : compteur des RDV obtenus par Aaron pendant
  // l'absence du commercial (source Aaron, RDV pris manuellement exclus —
  // voir migration_manual_appointments_2026-08-12.sql), plutôt qu'un total de
  // statut prospect qui ne redescend jamais. Fenêtre = jour calendaire en
  // cours (minuit à 23h59, heure locale du navigateur), PAS un glissant de
  // 24h — décision explicite d'Alex (2026-08-20), voir commentaire plus haut.
  // purpose !== 'lancement' : un RDV de lancement (tâche #141, proposé
  // automatiquement à un client déjà signé pendant l'onboarding) n'est pas
  // un "RDV obtenu" au sens prospection — voir migration_kickoff_rdv_2026-08-20.sql.
  const rdvObtenus24h = appointments.filter(
    (a) => a.source !== 'manuel' && a.purpose !== 'lancement' && a.created_at && new Date(a.created_at) >= startOfToday
  );
  // #9B — détail par type de RDV.
  const rdvObtenusByType = {
    visio: rdvObtenus24h.filter((a) => a.type === 'visio').length,
    telephonique: rdvObtenus24h.filter((a) => a.type === 'telephonique').length,
    physique: rdvObtenus24h.filter((a) => a.type === 'physique').length,
  };

  // #7 — catégorie Opportunités : réparties par code couleur pipeline,
  // uniquement les affaires ayant eu une ACTIVITÉ aujourd'hui (demande Alex,
  // 2026-08-22 : "les changements dans la journée", ex. une opportunité
  // jugée à risque aujourd'hui) — pas juste les affaires créées aujourd'hui,
  // qui aurait presque toujours été vide. Pour signé/bonne voie/en cours,
  // "aujourd'hui" = deal_stage_updated_at tombe aujourd'hui (l'étape a bougé
  // aujourd'hui). Le bucket "risque" est un cas particulier : par définition
  // il suppose deal_stage_updated_at VIEUX d'au moins STALE_DEAL_DAYS jours —
  // donc il ne peut jamais être "mis à jour aujourd'hui". On considère à la
  // place qu'une affaire a une "activité risque aujourd'hui" le jour précis
  // où elle FRANCHIT le seuil des STALE_DEAL_DAYS jours d'inactivité (même
  // jour que l'alerte automatique envoyée par app/api/cron/stale-deals-alert).
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  function dealHasActivityToday(deal, bucket) {
    if (!deal.deal_stage_updated_at) return false;
    const updatedAt = new Date(deal.deal_stage_updated_at);
    if (bucket === 'risque') {
      const becameStaleAt = new Date(updatedAt.getTime() + STALE_DEAL_DAYS * 24 * 60 * 60 * 1000);
      return becameStaleAt >= startOfToday && becameStaleAt < endOfToday;
    }
    return updatedAt >= startOfToday && updatedAt < endOfToday;
  }
  const opportunityCounts = Object.keys(OPPORTUNITY_META).reduce((acc, key) => {
    acc[key] = deals.filter((d) => opportunityBucketFor(d) === key && dealHasActivityToday(d, key)).length;
    return acc;
  }, {});

  // #8 — catégorie Clients : réparties par santé client, uniquement les
  // clients dont l'évaluation de santé a été mise à jour aujourd'hui
  // (customer_health_updated_at) — même logique "activité du jour" que les
  // opportunités ci-dessus. Point d'attention : le score est recalculé
  // chaque nuit pour tous les clients (cron, voir lib/customer-health.ts),
  // donc ce filtre peut rester proche du total complet si le cron met à
  // jour la date à chaque passage même sans changement de label.
  const customersToday = customers.filter(
    (c) => c.customer_health_updated_at && new Date(c.customer_health_updated_at) >= startOfToday && new Date(c.customer_health_updated_at) < endOfToday
  );
  const healthCounts = Object.keys(HEALTH_META).reduce((acc, key) => {
    acc[key] = customersToday.filter((c) => healthBucketFor(c) === key).length;
    return acc;
  }, {});

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
    <Shell active={t('nav.dashboard', locale)} userId={userId}>
      <header className="header">
        <div>
          <p className="eyebrow">{t('nav.dashboard', locale)}</p>
          <h1>{t('dash.title', locale)}</h1>
          <p className="period-note">{t('dash.periodNote', locale)}</p>
        </div>
        <ConnectionStatusBadge />
      </header>

      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          {missedAppointments.length > 0 && (
            <section className="missed-panel">
              <p className="missed-title">
                <span className="dot" style={{ background: '#E5484D' }} />
                {t('dash.missedActions', locale)} <span className="badge">{missedAppointments.length}</span>
              </p>
              <div className="missed-list">
                {missedAppointments.map((a) => (
                  <div key={a.id} className="missed-row">
                    <span className="missed-label">
                      {t('dash.missedApptLabel', locale).replace('{name}', a.prospects?.full_name || '')}
                    </span>
                    <div className="missed-actions">
                      <button
                        className="missed-open"
                        onClick={() => setSelectedAppointment({ ...a, actionType: 'valider' })}
                      >
                        {t('modal.validate', locale)}
                      </button>
                      <button
                        className="missed-ack"
                        disabled={acknowledging === a.id}
                        onClick={() => acknowledgeMissed(a.id)}
                      >
                        {t('dash.acknowledgeMissed', locale)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

         <section className="actions-panel">
            <button className="actions-toggle" onClick={() => setActionsOpen(!actionsOpen)}>
              <span>
                {t('dash.actionsRequired', locale)} {totalActions > 0 && <span className="badge">{totalActions}</span>}
              </span>
              <span className="chevron">{actionsOpen ? '▲' : '▼'}</span>
            </button>
            {actionsOpen && (
              <div className="actions-list">
                {totalActions === 0 ? (
                  <p className="empty-actions">{t('dash.nothingToProcess', locale)}</p>
                ) : (
                  <>
                    {pendingAppointments.map((a) => (
                      <button key={a.id} className="action-row" onClick={() => setSelectedAppointment({ ...a, actionType: 'valider' })}>
                        <span className="dot" style={{ background: '#F0914E' }} />
                        <span className="action-label">{t('dash.apptToValidate', locale).replace('{name}', a.prospects?.full_name || '')}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
{cancelledByClient.map((a) => (
                      <button key={a.id} className="action-row" onClick={() => setSelectedAppointment({ ...a, actionType: 'annule' })}>
                        <span className="dot" style={{ background: '#E5484D' }} />
                        <span className="action-label">{t('dash.apptCancelledByClient', locale).replace('{name}', a.prospects?.full_name || '')}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
                    {needsReschedule.map((a) => (
                      <button key={a.id} className="action-row" onClick={() => setSelectedAppointment({ ...a, actionType: 'annule' })}>
                        <span className="dot" style={{ background: '#8B90A8' }} />
                        <span className="action-label">{t('dash.apptNeedsReschedule', locale).replace('{name}', a.prospects?.full_name || '')}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
                    {rescueProspects.map((p) => (
                      <button key={p.id} className="action-row" onClick={() => setSelectedRescue(p)}>
                        <span className="dot" style={{ background: '#8B90A8' }} />
                        <span className="action-label">{t('dash.prospectLostRescue', locale).replace('{name}', p.full_name || '')}</span>
                        <span className="action-arrow">→</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </section>

          {/* Réorganisation demandée par Alex (2026-08-25) : "Prochains
              rendez-vous" et "Campagnes en cours" remontent juste sous
              "Actions requises" (avant : après le bloc Prospect). Suivent
              ensuite, dans l'ordre, Prospect puis Opportunité puis Clients. */}
          <section className="grid-two">
            <div className="panel">
              <h2>{t('dash.upcomingAppointments', locale)}</h2>
              {upcomingGroups.length === 0 ? (
                <EmptyState title={t('dash.emptyNothingPlanned', locale)} body={t('dash.emptyNoConfirmedAppt', locale)} compact />
              ) : (
                <div className="day-groups">
                  {upcomingGroups.map((group) => (
                    <div key={group.key} className="day-group">
                      <p className="day-heading">{group.label}</p>
                      <ul className="list">
                        {group.items.map((a) => (
                          <li key={a.id} className="list-item">
                            <div>
                              <strong>{a.prospects?.full_name}</strong>
                              <span className="muted"> — {a.prospects?.prospect_companies?.name || t('dash.unknownCompany', locale)}</span>
                            </div>
                            <span className="pill">{new Date(a.proposed_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>{t('dash.ongoingCampaigns', locale)}</h2>
              {activeCampaigns.length === 0 ? (
                <EmptyState title={t('dash.emptyNoActiveCampaign', locale)} body={t('dash.emptyLaunchCampaign', locale)} compact />
              ) : (
                <ul className="list">
                  {activeCampaigns.map((c) => (
                    <li key={c.id} className="list-item">
                      <div>
                        <strong>{c.zone_label}</strong>
                        <span className="muted"> — {c.sector_keywords?.join(', ')}</span>
                      </div>
                      <span className="pill">{c.contacts_found}/{c.target_count} contacts</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* "petit truc pourris : merci de bien remettre rdv obtenu a côté
              de 'en bonne voie'" (Alex, 2026-08-25) — la carte RDV obtenu
              revient dans la même rangée que le pipeline Prospect, en
              première position (à gauche de "En bonne voie"), comme avant
              le découpage en bloc séparé du 2026-08-23. */}
          <section className="panel category-panel">
            <h2>{t('dash.prospectsTitle', locale)}</h2>
            <div className="category-row">
              <div className="stat-card rdv-obtenu-card">
                <span className="dot" style={{ background: '#4B9EF0' }} />
                <span className="stat-number">{rdvObtenus24h.length}</span>
                <span className="stat-label">{t('status.bleu', locale)}</span>
                <span className="stat-sublabel">
                  <span className="rdv-type"><span className="rdv-type-icon">💻</span>{t('agenda.kindVideo', locale)} {rdvObtenusByType.visio}</span>
                  <span className="rdv-type"><span className="rdv-type-icon">📞</span>{t('agenda.kindPhone', locale)} {rdvObtenusByType.telephonique}</span>
                  <span className="rdv-type"><span className="rdv-type-icon">🤝</span>{t('agenda.kindInPerson', locale)} {rdvObtenusByType.physique}</span>
                </span>
                {rdvObtenus24h.length > 0 && (
                  <div className="rdv-type-chart">
                    <HorizontalBarChart
                      data={[
                        { key: 'visio', label: t('agenda.kindVideo', locale), value: rdvObtenusByType.visio },
                        { key: 'telephonique', label: t('agenda.kindPhone', locale), value: rdvObtenusByType.telephonique },
                        { key: 'physique', label: t('agenda.kindInPerson', locale), value: rdvObtenusByType.physique },
                      ]}
                      barColor="#4B9EF0"
                    />
                  </div>
                )}
              </div>
              <div className="stat-card">
                <span className="dot" style={{ background: STATUS_META.vert.color }} />
                <span className="stat-number">{statusCounts.vert || 0}</span>
                <span className="stat-label">{STATUS_META.vert.label}</span>
              </div>
              {['jaune', 'orange', 'rouge'].map((key) => (
                <div className="stat-card" key={key}>
                  <span className="dot" style={{ background: STATUS_META[key].color }} />
                  <span className="stat-number">{statusCounts[key] || 0}</span>
                  <span className="stat-label">{STATUS_META[key].label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* "pour opportuntié et client merci d'afficher la pipeline comme
              pour prospect" (Alex, 2026-08-25) : la rangée de statuts
              s'affiche désormais toujours (avec des 0), comme Prospect —
              seul le cas "module non inclus dans l'abonnement" garde son
              propre message dédié. */}
          <section className="panel category-panel">
            <h2>{t('dash.opportunitiesTitle', locale)}</h2>
            {!salesModuleActive ? (
              <EmptyState title={t('dash.salesLockedTitle', locale)} body={t('dash.salesLockedBody', locale)} compact />
            ) : (
              <>
                <div className="category-row">
                  {['signe', 'bonneVoie', 'enCours', 'risque', 'perdu'].map((key) => (
                    <div className="stat-card" key={key}>
                      <span className="dot" style={{ background: OPPORTUNITY_META[key].color }} />
                      <span className="stat-number">{opportunityCounts[key] || 0}</span>
                      <span className="stat-label">{OPPORTUNITY_META[key].label}</span>
                    </div>
                  ))}
                </div>
                {deals.length > 0 && (
                  <div className="stat-chart">
                    <HorizontalBarChart
                      data={['signe', 'bonneVoie', 'enCours', 'risque', 'perdu'].map((key) => ({
                        key,
                        label: OPPORTUNITY_META[key].label,
                        value: opportunityCounts[key] || 0,
                        color: OPPORTUNITY_META[key].color,
                      }))}
                    />
                  </div>
                )}
              </>
            )}
          </section>

          <section className="panel category-panel">
            <h2>{t('dash.clientsTitle', locale)}</h2>
            {!customerModuleActive ? (
              <EmptyState title={t('dash.clientsLockedTitle', locale)} body={t('dash.clientsLockedBody', locale)} compact />
            ) : (
              <>
                <div className="category-row">
                  {['saine', 'non_evalue', 'a_surveiller', 'a_risque'].map((key) => (
                    <div className="stat-card" key={key}>
                      <span className="dot" style={{ background: HEALTH_META[key].color }} />
                      <span className="stat-number">{healthCounts[key] || 0}</span>
                      <span className="stat-label">{HEALTH_META[key].label}</span>
                    </div>
                  ))}
                </div>
                {customers.length > 0 && (
                  <div className="stat-chart">
                    <HorizontalBarChart
                      data={['saine', 'non_evalue', 'a_surveiller', 'a_risque'].map((key) => ({
                        key,
                        label: HEALTH_META[key].label,
                        value: healthCounts[key] || 0,
                        color: HEALTH_META[key].color,
                      }))}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

{selectedAppointment && (
        <ActionCardModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onDone={() => {
            setSelectedAppointment(null);
            loadAll();
          }}
        />
      )}

      {selectedRescue && (
        <RescueModal
          prospect={selectedRescue}
          onClose={() => setSelectedRescue(null)}
          onDone={() => {
            setSelectedRescue(null);
            loadAll();
          }}
        />
      )}

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
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
          max-width: 26ch;
          line-height: 1.2;
        }
        .missed-panel {
          background: rgba(229, 72, 77, 0.08);
          border: 1px solid var(--accent-red);
          border-radius: var(--radius-lg);
          margin-bottom: 1.2rem;
          overflow: hidden;
        }
        .missed-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0;
          padding: 1rem 1.3rem;
          font-size: 0.92rem;
          font-weight: 700;
          color: var(--accent-red);
        }
        .missed-title .badge {
          background: var(--accent-red);
          color: #fff;
        }
        .missed-list {
          border-top: 1px solid rgba(229, 72, 77, 0.35);
        }
        .missed-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.8rem;
          padding: 0.8rem 1.3rem;
          border-bottom: 1px solid rgba(229, 72, 77, 0.2);
          flex-wrap: wrap;
        }
        .missed-row:last-child {
          border-bottom: none;
        }
        .missed-label {
          font-size: 0.86rem;
          color: var(--text);
          flex: 1;
          min-width: 200px;
        }
        .missed-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        .missed-open,
        .missed-ack {
          border-radius: var(--radius-sm);
          padding: 0.4rem 0.8rem;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
        }
        .missed-open {
          background: var(--accent);
          border: none;
          color: #fff;
        }
        .missed-ack {
          background: none;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .actions-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          margin-bottom: 1.5rem;
          overflow: hidden;
        }
        .actions-toggle {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: none;
          border: none;
          color: var(--text);
          font-size: 0.92rem;
          font-weight: 600;
          padding: 1rem 1.3rem;
          cursor: pointer;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #f0914e;
          color: #1b0d02;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.1rem 0.5rem;
          margin-left: 0.5rem;
        }
        .chevron {
          color: var(--muted);
          font-size: 0.7rem;
        }
        .actions-list {
          border-top: 1px solid var(--border);
        }
        .empty-actions {
          padding: 1.2rem 1.3rem;
          color: var(--muted);
          font-size: 0.86rem;
          margin: 0;
        }
        .action-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.7rem;
          background: none;
          border: none;
          border-bottom: 1px solid var(--border);
          color: var(--text);
          padding: 0.9rem 1.3rem;
          font-size: 0.88rem;
          cursor: pointer;
          text-align: left;
        }
        .action-row:last-child {
          border-bottom: none;
        }
        .action-row:hover {
          background: rgba(75, 57, 239, 0.08);
        }
        .action-label {
          flex: 1;
        }
        .action-arrow {
          color: var(--muted);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .stat-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0.75rem;
          margin-bottom: 2rem;
        }
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.6rem;
          font-weight: 600;
        }
        .stat-label {
          font-size: 0.78rem;
          color: var(--muted);
        }
        .stat-sublabel {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          margin-top: 0.15rem;
        }
        .rdv-type {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-family: var(--font-body);
          font-size: 0.74rem;
          color: var(--muted);
        }
        .rdv-type-icon {
          font-size: 0.85rem;
          width: 1.1em;
          text-align: center;
          flex-shrink: 0;
        }
        .rdv-obtenu-card {
          border-color: rgba(75, 158, 240, 0.5);
        }
        .rdv-type-chart {
          margin-top: 0.5rem;
        }
        .stat-chart {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.85rem 1rem;
          margin-top: 0.75rem;
        }
        .period-note {
          font-size: 0.76rem;
          color: var(--muted);
          margin: 0 0 0.4rem;
        }
        .campaign-line {
          font-size: 0.76rem;
          color: var(--muted);
          margin: 0 0 2rem;
        }
        .day-groups {
          display: flex;
          flex-direction: column;
          gap: 1.1rem;
        }
        .day-group:last-child .list-item:last-child {
          border-bottom: none;
        }
        .day-heading {
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-size: 0.72rem;
          font-weight: 700;
          color: var(--accent);
          margin: 0 0 0.5rem;
        }
        .category-panel {
          margin-top: 1.25rem;
        }
        .category-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 0.75rem;
        }
        .grid-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.4rem;
        }
        .panel h2 {
          font-size: 1rem;
          margin: 0 0 1rem;
          font-family: var(--font-display);
        }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .list-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.9rem;
        }
        .list-item:last-child {
          border-bottom: none;
        }
        .pill {
          font-family: var(--font-mono);
          font-size: 0.76rem;
          color: var(--muted);
          white-space: nowrap;
        }
        .muted {
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .stat-row {
            grid-template-columns: repeat(2, 1fr);
          }
          .grid-two {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 480px) {
          .stat-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Shell>
  );
}

function ActionCardModal({ appointment, onClose, onDone }) {
  const [locale] = useLocale();
  const [view, setView] = useState('main'); // 'main' | 'historique' | 'fiche'
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch(`/api/prospects/${appointment.prospect_id}`)
      .then((r) => r.json())
      .then((res) => {
        setDetail(res);
        setLoading(false);
      });
  }, [appointment.prospect_id]);

  async function handleAction(action) {
    setActing(true);
    await fetch(`/api/appointments/${appointment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActing(false);
    onDone();
  }

  const STATUS_META = statusMetaFor(locale);
  const prospect = detail?.prospect;
  const meta = prospect ? (STATUS_META[prospect.status] || STATUS_META.jaune) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>

        {loading ? (
          <p className="muted center">{t('common.loading', locale)}</p>
        ) : (
          <>
            <div className="prospect-center">
              <div className="avatar">{prospect?.full_name?.[0] || '?'}</div>
              <h2>{prospect?.full_name}</h2>
              <p className="company muted">{prospect?.prospect_companies?.name || t('dash.unknownCompany', locale)}</p>
              {meta && (
                <span className="status-pill" style={{ color: meta.color, borderColor: meta.color }}>
                  {meta.label}
                </span>
              )}
            </div>

            {view === 'main' && (
              <div className="rdv-info">
                {appointment.actionType === 'annule' && (
                  <p className="cancel-label">
                    {t(appointment.cancelled_by === 'client' ? 'dash.apptCancelledByClient' : 'dash.apptNeedsReschedule', locale).replace(' — {name}', '')}
                  </p>
                )}
                <p><strong>{t(`apptType.${appointment.type}`, locale)}</strong></p>
                <p className="muted">{new Date(appointment.proposed_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}</p>
              </div>
            )}

            {view === 'historique' && (
              <div className="scroll-section">
                {(detail.messages || []).length === 0 ? (
                  <p className="muted center">{t('modal.noExchangeYet', locale)}</p>
                ) : (
                  detail.messages.map((m, i) => (
                    <div key={i} className={`msg ${m.direction}`}>
                      <p>{m.body}</p>
                      <span className="msg-date">{new Date(m.sent_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {view === 'fiche' && (
              <div className="scroll-section fiche">
                <div className="fiche-row">
                  <span className="fiche-label">{t('modal.email', locale)}</span>
                  <span>{prospect?.email}</span>
                </div>
                {prospect?.phone && (
                  <div className="fiche-row">
                    <span className="fiche-label">{t('modal.phone', locale)}</span>
                    <span>{prospect.phone}</span>
                  </div>
                )}
                <div className="fiche-row">
                  <span className="fiche-label">{t('modal.personality', locale)}</span>
                  <span>{prospect?.personality_type ? t(`personality.${prospect.personality_type}`, locale) : t('personality.notDetected', locale)}</span>
                </div>
                {prospect?.personality_notes && (
                  <div className="fiche-row">
                    <span className="fiche-label">{t('modal.notes', locale)}</span>
                    <span>{prospect.personality_notes}</span>
                  </div>
                )}
                <div className="fiche-row">
                  <span className="fiche-label">{t('modal.aaronAdvice', locale)}</span>
                  <span>{prospect?.aaron_advice || '—'}</span>
                </div>
              </div>
            )}

            <div className="toggle-row">
              <button className={view === 'historique' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setView(view === 'historique' ? 'main' : 'historique')}>
                {t('modal.historyTab', locale)}
              </button>
              <button className={view === 'fiche' ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setView(view === 'fiche' ? 'main' : 'fiche')}>
                {t('modal.fileTab', locale)}
              </button>
            </div>

            <div className="actions-row">
              {appointment.actionType === 'annule' ? (
                <>
                  <button className="btn-valid" disabled={acting} onClick={() => handleAction('relancer')}>{t('modal.followUpProspect', locale)}</button>
                  <button className="btn-neutral" disabled={acting} onClick={() => handleAction('traiter')}>{t('modal.markProcessed', locale)}</button>
                </>
              ) : (
                <>
                  <button className="btn-valid" disabled={acting} onClick={() => handleAction('valider')}>{t('modal.validate', locale)}</button>
                  <button className="btn-neutral" disabled={acting} onClick={() => handleAction('reporter')}>{t('modal.postpone', locale)}</button>
                  <button className="btn-danger" disabled={acting} onClick={() => handleAction('annuler')}>{t('common.cancel', locale)}</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 2rem;
          width: 420px;
          max-width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          position: relative;
        }
        .close-btn {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .prospect-center {
          text-align: center;
          margin-bottom: 1.4rem;
        }
        .avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: white;
          font-family: var(--font-display);
          font-size: 1.4rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 0.8rem;
        }
        .prospect-center h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 0.2rem;
        }
        .company {
          font-size: 0.86rem;
          margin: 0 0 0.6rem;
        }
        .status-pill {
          display: inline-block;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.7rem;
          font-size: 0.76rem;
        }
        .rdv-info {
          text-align: center;
          background: var(--bg);
          border-radius: var(--radius-md);
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .rdv-info p {
          margin: 0.2rem 0;
        }
        .cancel-label {
          color: var(--accent-red);
          font-weight: 600;
          font-size: 0.82rem;
        }
        .scroll-section {
          max-height: 220px;
          overflow-y: auto;
          margin-bottom: 1.2rem;
          background: var(--bg);
          border-radius: var(--radius-md);
          padding: 1rem;
        }
        .msg {
          margin-bottom: 0.9rem;
          font-size: 0.84rem;
        }
        .msg p {
          margin: 0 0 0.2rem;
          white-space: pre-wrap;
          overflow-wrap: break-word;
        }
        .msg.inbound p {
          color: var(--text);
        }
        .msg.outbound p {
          color: var(--muted);
        }
        .msg-date {
          font-size: 0.7rem;
          color: var(--muted);
        }
        .fiche-row {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          margin-bottom: 0.8rem;
          font-size: 0.86rem;
        }
        .fiche-row:last-child {
          margin-bottom: 0;
        }
        .fiche-label {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted);
        }
        .toggle-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.2rem;
        }
        .toggle-btn {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.5rem;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .toggle-btn.active {
          border-color: var(--accent);
          color: var(--text);
        }
        .actions-row {
          display: flex;
          gap: 0.6rem;
        }
        .btn-valid, .btn-neutral, .btn-danger {
          flex: 1;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.7rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
        }
        .btn-neutral {
          background: var(--border);
          color: var(--text);
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
        }
        .muted {
          color: var(--muted);
        }
        .center {
          text-align: center;
        }
      `}</style>
    </div>
  );
}

function RescueModal({ prospect, onClose, onDone }) {
  const [locale] = useLocale();
  const [acting, setActing] = useState(false);

  async function handleAction(action) {
    setActing(true);
    await fetch(`/api/prospects/${prospect.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActing(false);
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>

        <div className="prospect-center">
          <div className="avatar">{prospect.full_name?.[0] || '?'}</div>
          <h2>{prospect.full_name}</h2>
          <p className="company muted">{prospect.prospect_companies?.name || t('dash.unknownCompany', locale)}</p>
          <span className="status-pill" style={{ color: '#8B90A8', borderColor: '#8B90A8' }}>
            {t('rescue.title', locale)}
          </span>
        </div>

        <div className="scroll-section">
          <p className="rescue-subject"><strong>{prospect.rescue_proposal_subject}</strong></p>
          <p className="rescue-body">{prospect.rescue_proposal_body}</p>
        </div>

        <div className="actions-row">
          <button className="btn-valid" disabled={acting} onClick={() => handleAction('approuver_sauvetage')}>
            {t('rescue.sendAttempt', locale)}
          </button>
          <button className="btn-danger" disabled={acting} onClick={() => handleAction('rejeter_sauvetage')}>
            {t('rescue.abandon', locale)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 2rem;
          width: 420px;
          max-width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          position: relative;
        }
        .close-btn {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          color: var(--muted);
          font-size: 1rem;
          cursor: pointer;
        }
        .prospect-center {
          text-align: center;
          margin-bottom: 1.4rem;
        }
        .avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: white;
          font-family: var(--font-display);
          font-size: 1.4rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 0.8rem;
        }
        .prospect-center h2 {
          font-family: var(--font-display);
          font-size: 1.2rem;
          margin: 0 0 0.2rem;
        }
        .company {
          font-size: 0.86rem;
          margin: 0 0 0.6rem;
        }
        .status-pill {
          display: inline-block;
          border: 1px solid;
          border-radius: 999px;
          padding: 0.2rem 0.7rem;
          font-size: 0.76rem;
        }
        .scroll-section {
          max-height: 260px;
          overflow-y: auto;
          margin-bottom: 1.2rem;
          background: var(--bg);
          border-radius: var(--radius-md);
          padding: 1rem;
        }
        .rescue-subject {
          margin: 0 0 0.6rem;
          font-size: 0.9rem;
        }
        .rescue-body {
          margin: 0;
          font-size: 0.86rem;
          white-space: pre-wrap;
          overflow-wrap: break-word;
          color: var(--muted);
        }
        .actions-row {
          display: flex;
          gap: 0.6rem;
        }
        .btn-valid, .btn-danger {
          flex: 1;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.7rem;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-valid {
          background: var(--accent-green);
          color: #08130d;
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
        }
        .muted {
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}

// docx AJOUT GLOBAL A10 (2026-08-21) : remplace la pastille "En veille"/"Aaron
// travaille" (AaronPulse, activité des campagnes) par le statut de connexion
// du commercial lui-même, comme demandé. Deux états distincts : le réseau
// (navigator.onLine — coupure internet réelle, rien à voir avec la session)
// et la session (toujours "connecté" tant qu'on voit cette page, puisque
// l'app redirige vers /login sinon — voir AuthFetchInterceptor). Cliquer
// ouvre une confirmation de déconnexion, avec la même logique que le bouton
// "Se déconnecter" déjà présent en bas de la barre latérale (docx A10
// précédent) — ce badge est un raccourci en plus, pas un remplacement.
function ConnectionStatusBadge() {
  const [locale] = useLocale();
  const [online, setOnline] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  async function confirmLogout() {
    setLoggingOut(true);
    await supabaseBrowser.auth.signOut();
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const label = online ? t('connectionBadge.online', locale) : t('connectionBadge.offline', locale);

  return (
    <div className="conn-wrap">
      <button type="button" className="conn-btn" onClick={() => setShowConfirm((v) => !v)}>
        <span className={`conn-dot ${online ? 'is-online' : 'is-offline'}`} />
        <span className="conn-label">{label}</span>
      </button>
      {showConfirm && (
        <div className="conn-popover">
          <p>{t('connectionBadge.confirmLogout', locale)}</p>
          <div className="conn-actions">
            <button type="button" className="conn-cancel" onClick={() => setShowConfirm(false)}>{t('common.cancel', locale)}</button>
            <button type="button" className="conn-confirm" disabled={loggingOut} onClick={confirmLogout}>
              {loggingOut ? '…' : t('connectionBadge.logoutButton', locale)}
            </button>
          </div>
        </div>
      )}
      <style jsx>{`
        .conn-wrap {
          position: relative;
        }
        .conn-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.5rem 0.9rem;
          cursor: pointer;
        }
        .conn-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--muted);
        }
        .conn-dot.is-online {
          background: var(--accent-green);
        }
        .conn-dot.is-offline {
          background: var(--accent-red);
        }
        .conn-label {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .conn-popover {
          position: absolute;
          top: calc(100% + 0.4rem);
          right: 0;
          width: 220px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.7rem 0.8rem;
          font-size: 0.8rem;
          color: var(--text);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
          z-index: 20;
        }
        .conn-popover p {
          margin: 0 0 0.6rem;
        }
        .conn-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
        }
        .conn-cancel {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          cursor: pointer;
        }
        .conn-confirm {
          background: var(--accent-red);
          border: none;
          color: white;
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.7rem;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
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
    { label: t('nav.products', locale), slug: 'products', icon: '💰', locked: lockedModules.sales },
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
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' && item.slug !== 'suggestions') || userRole === 'patron').map((item) => (
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
