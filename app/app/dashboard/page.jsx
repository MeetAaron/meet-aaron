// app/app/dashboard/page.jsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import RailMore, { railLinkClass } from '@/components/RailMore';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import ActivityFeed from '@/components/ActivityFeed';
import SendInsightsCard from '@/components/SendInsightsCard';
import InstallPrompt from '@/components/InstallPrompt';
import Ic from '@/components/UiIcon';
import { checkNewWins } from '@/components/WinCelebration';
import { countPipeline, derivePipelinePosition, stageOrder, PIPELINE_COLORS } from '@/lib/pipeline';
import { frenchTypography } from '@/lib/text-typography';
import { HorizontalBarChart } from '@/components/charts/MiniBarChart';

// Refonte visuelle 17/10/2026 (maquettes validées par Alex) : textes du
// nouvel en-tête, de la carte « Prochain rendez-vous », de l'entonnoir en
// colonnes et de la suggestion d'Aaron. Dictionnaire local (lib/i18n.js
// dépasse la taille acceptée par l'envoi GitHub — même compromis que
// components/ContactCard.jsx et components/ActivityFeed.jsx).
const DASH_TEXT = {
  fr: { hello: 'Bonjour {name}', helloAnon: 'Bonjour', next: 'Prochain rendez-vous', agenda: 'Agenda', brief: "Brief d'Aaron :", prepare: 'Préparer', join: 'Rejoindre', then: 'Ensuite', funnel: 'Ton entonnoir', results: 'Résultats', funnelRead: '{rate} % des contacts obtiennent un rendez-vous · 1 contact sur {ratio} devient client', funnelReadNoClient: '{rate} % des contacts obtiennent un rendez-vous', funnelEmpty: 'Dès que la première campagne tourne, tes chiffres apparaissent ici.', byType: 'Rendez-vous obtenus aujourd\'hui', campaign: 'Campagne en cours', campaigns: 'Campagnes', see: 'Voir', suggestion: "Suggestion d'Aaron", suggestDone: 'La campagne « {name} » a atteint son objectif ({n} contacts). On en lance une nouvelle sur une zone voisine ?', suggestBest: 'La campagne « {name} » a déjà signé {n} {w} : c\'est ta meilleure zone pour l\'instant.', client1: 'client', clientN: 'clients', launch: 'Lancer', inProgress: '{active} en cours · {won} {w}', newsPill: 'Actualité repérée', newsLead: 'Aaron a repéré du nouveau chez {company} :', newsSend: 'Envoyer cette relance', newsSkip: 'Laisser de côté', newsSource: 'Voir la source' },
  en: { hello: 'Hello {name}', helloAnon: 'Hello', next: 'Next meeting', agenda: 'Calendar', brief: "Aaron's brief:", prepare: 'Prepare', join: 'Join', then: 'Then', funnel: 'Your funnel', results: 'Results', funnelRead: '{rate}% of contacts get a meeting · 1 contact in {ratio} becomes a client', funnelReadNoClient: '{rate}% of contacts get a meeting', funnelEmpty: 'As soon as your first campaign runs, your numbers show up here.', byType: 'Meetings booked today', campaign: 'Running campaign', campaigns: 'Campaigns', see: 'View', suggestion: "Aaron's suggestion", suggestDone: 'Campaign “{name}” reached its target ({n} contacts). Launch a new one in a nearby area?', suggestBest: 'Campaign “{name}” already signed {n} {w}: your best area so far.', client1: 'client', clientN: 'clients', launch: 'Launch', inProgress: '{active} active · {won} {w}', newsPill: 'News spotted', newsLead: 'Aaron spotted something new at {company}:', newsSend: 'Send this follow-up', newsSkip: 'Leave it', newsSource: 'View source' },
  de: { hello: 'Hallo {name}', helloAnon: 'Hallo', next: 'Nächster Termin', agenda: 'Kalender', brief: 'Aarons Briefing:', prepare: 'Vorbereiten', join: 'Beitreten', then: 'Danach', funnel: 'Dein Funnel', results: 'Ergebnisse', funnelRead: '{rate} % der Kontakte führen zu einem Termin · 1 von {ratio} Kontakten wird Kunde', funnelReadNoClient: '{rate} % der Kontakte führen zu einem Termin', funnelEmpty: 'Sobald die erste Kampagne läuft, erscheinen hier deine Zahlen.', byType: 'Heute vereinbarte Termine', campaign: 'Laufende Kampagne', campaigns: 'Kampagnen', see: 'Ansehen', suggestion: 'Aarons Vorschlag', suggestDone: 'Die Kampagne „{name}“ hat ihr Ziel erreicht ({n} Kontakte). Eine neue in einer Nachbarregion starten?', suggestBest: 'Die Kampagne „{name}“ hat bereits {n} {w} gewonnen: bisher deine beste Region.', client1: 'Kunden', clientN: 'Kunden', launch: 'Starten', inProgress: '{active} aktiv · {won} {w}', newsPill: 'Neuigkeit entdeckt', newsLead: 'Aaron hat bei {company} etwas Neues entdeckt:', newsSend: 'Diese Nachfassmail senden', newsSkip: 'Liegen lassen', newsSource: 'Quelle ansehen' },
  it: { hello: 'Ciao {name}', helloAnon: 'Ciao', next: 'Prossimo appuntamento', agenda: 'Agenda', brief: 'Brief di Aaron:', prepare: 'Preparare', join: 'Partecipa', then: 'Poi', funnel: 'Il tuo funnel', results: 'Risultati', funnelRead: 'Il {rate} % dei contatti ottiene un appuntamento · 1 contatto su {ratio} diventa cliente', funnelReadNoClient: 'Il {rate} % dei contatti ottiene un appuntamento', funnelEmpty: 'Appena la prima campagna parte, i tuoi numeri compaiono qui.', byType: 'Appuntamenti ottenuti oggi', campaign: 'Campagna in corso', campaigns: 'Campagne', see: 'Vedi', suggestion: 'Suggerimento di Aaron', suggestDone: 'La campagna « {name} » ha raggiunto l\'obiettivo ({n} contatti). Ne lanciamo una nuova in una zona vicina?', suggestBest: 'La campagna « {name} » ha già firmato {n} {w}: la tua zona migliore finora.', client1: 'cliente', clientN: 'clienti', launch: 'Lancia', inProgress: '{active} in corso · {won} {w}', newsPill: 'Novità individuata', newsLead: 'Aaron ha notato una novità da {company}:', newsSend: 'Invia questo follow-up', newsSkip: 'Lascia stare', newsSource: 'Vedi la fonte' },
  es: { hello: 'Hola {name}', helloAnon: 'Hola', next: 'Próxima cita', agenda: 'Agenda', brief: 'Brief de Aaron:', prepare: 'Preparar', join: 'Unirse', then: 'Después', funnel: 'Tu embudo', results: 'Resultados', funnelRead: 'El {rate} % de los contactos consigue una cita · 1 contacto de cada {ratio} se convierte en cliente', funnelReadNoClient: 'El {rate} % de los contactos consigue una cita', funnelEmpty: 'En cuanto arranque la primera campaña, tus cifras aparecen aquí.', byType: 'Citas conseguidas hoy', campaign: 'Campaña en curso', campaigns: 'Campañas', see: 'Ver', suggestion: 'Sugerencia de Aaron', suggestDone: 'La campaña « {name} » alcanzó su objetivo ({n} contactos). ¿Lanzamos otra en una zona cercana?', suggestBest: 'La campaña « {name} » ya firmó {n} {w}: tu mejor zona por ahora.', client1: 'cliente', clientN: 'clientes', launch: 'Lanzar', inProgress: '{active} en curso · {won} {w}', newsPill: 'Novedad detectada', newsLead: 'Aaron ha detectado algo nuevo en {company}:', newsSend: 'Enviar este seguimiento', newsSkip: 'Dejarlo', newsSource: 'Ver la fuente' },
  pt: { hello: 'Olá {name}', helloAnon: 'Olá', next: 'Próxima reunião', agenda: 'Agenda', brief: 'Brief do Aaron:', prepare: 'Preparar', join: 'Entrar', then: 'Depois', funnel: 'O teu funil', results: 'Resultados', funnelRead: '{rate} % dos contactos obtêm uma reunião · 1 contacto em {ratio} torna-se cliente', funnelReadNoClient: '{rate} % dos contactos obtêm uma reunião', funnelEmpty: 'Assim que a primeira campanha arrancar, os teus números aparecem aqui.', byType: 'Reuniões obtidas hoje', campaign: 'Campanha em curso', campaigns: 'Campanhas', see: 'Ver', suggestion: 'Sugestão do Aaron', suggestDone: 'A campanha « {name} » atingiu o objetivo ({n} contactos). Lançamos uma nova numa zona vizinha?', suggestBest: 'A campanha « {name} » já fechou {n} {w}: a tua melhor zona até agora.', client1: 'cliente', clientN: 'clientes', launch: 'Lançar', inProgress: '{active} em curso · {won} {w}', newsPill: 'Novidade detetada', newsLead: 'O Aaron detetou algo novo na {company}:', newsSend: 'Enviar este seguimento', newsSkip: 'Deixar de lado', newsSource: 'Ver a fonte' },
  nl: { hello: 'Hallo {name}', helloAnon: 'Hallo', next: 'Volgende afspraak', agenda: 'Agenda', brief: 'Briefing van Aaron:', prepare: 'Voorbereiden', join: 'Deelnemen', then: 'Daarna', funnel: 'Je funnel', results: 'Resultaten', funnelRead: '{rate} % van de contacten levert een afspraak op · 1 op {ratio} contacten wordt klant', funnelReadNoClient: '{rate} % van de contacten levert een afspraak op', funnelEmpty: 'Zodra je eerste campagne loopt, verschijnen je cijfers hier.', byType: 'Vandaag geregelde afspraken', campaign: 'Lopende campagne', campaigns: 'Campagnes', see: 'Bekijk', suggestion: 'Suggestie van Aaron', suggestDone: 'Campagne « {name} » heeft haar doel bereikt ({n} contacten). Een nieuwe starten in een naburige regio?', suggestBest: 'Campagne « {name} » leverde al {n} {w} op: tot nu toe je beste regio.', client1: 'klant', clientN: 'klanten', launch: 'Starten', inProgress: '{active} actief · {won} {w}', newsPill: 'Nieuws gespot', newsLead: 'Aaron zag iets nieuws bij {company}:', newsSend: 'Deze opvolging versturen', newsSkip: 'Laten liggen', newsSource: 'Bron bekijken' },
};
const dt = (key, locale) => (DASH_TEXT[locale] || DASH_TEXT.fr)[key] || DASH_TEXT.fr[key];
const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k]), s);

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

// Checklist résiduelle (22/10/2026). Textes locaux : lib/i18n.js est trop
// lourd pour l'envoi web de GitHub.
const CHECK_TEXT = {
  fr: { title: 'Derniers réglages', pushPc: 'Notifications sur ton ordinateur', pushPhone: 'Notifications sur ton téléphone', phoneCalendar: 'Agenda Aaron sur ton téléphone' },
  en: { title: 'Last settings', pushPc: 'Notifications on your computer', pushPhone: 'Notifications on your phone', phoneCalendar: 'Aaron calendar on your phone' },
  de: { title: 'Letzte Einstellungen', pushPc: 'Benachrichtigungen auf Ihrem Computer', pushPhone: 'Benachrichtigungen auf Ihrem Telefon', phoneCalendar: 'Aaron-Kalender auf Ihrem Telefon' },
  it: { title: 'Ultime impostazioni', pushPc: 'Notifiche sul computer', pushPhone: 'Notifiche sul telefono', phoneCalendar: 'Calendario Aaron sul telefono' },
  es: { title: 'Últimos ajustes', pushPc: 'Notificaciones en tu ordenador', pushPhone: 'Notificaciones en tu móvil', phoneCalendar: 'Calendario de Aaron en tu móvil' },
  pt: { title: 'Últimas configurações', pushPc: 'Notificações no computador', pushPhone: 'Notificações no telemóvel', phoneCalendar: 'Calendário do Aaron no telemóvel' },
  nl: { title: 'Laatste instellingen', pushPc: 'Meldingen op je computer', pushPhone: 'Meldingen op je telefoon', phoneCalendar: 'Aaron-agenda op je telefoon' },
};
const ckt = (key, locale) => (CHECK_TEXT[locale] || CHECK_TEXT.fr)[key] || CHECK_TEXT.fr[key];

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
  // Checklist de mise en route (demande Alex, 2026-08-26 : "tu me garantis
  // que quand on crée un nouveau compte il y a la visite guidée + création
  // profil business + connexion google/microsoft + création première
  // campagne/prospect test ?") — aucune de ces 4 étapes n'est bloquante côté
  // inscription (voir app/api/webhooks/stripe/route.ts et app/onboarding),
  // donc plutôt qu'un blocage dur, ce bandeau non-bloquant et persistant
  // (visible tant que les 4 étapes ne sont pas toutes faites) sert de
  // "garantie souple" : personne ne peut manquer ces étapes sans s'en rendre
  // compte à chaque passage sur le tableau de bord.
  const [onboardingTourSeen, setOnboardingTourSeen] = useState(true);
  // Refonte 17/10/2026 : « Bonjour {prénom} » — full_name vient déjà de
  // /api/preferences, chargé ci-dessous, pas d'appel de plus.
  const [firstName, setFirstName] = useState('');
  const [businessSummaryDone, setBusinessSummaryDone] = useState(true);
  const [emailConnected, setEmailConnected] = useState(true);
  // Étape "Agenda synchronisé" de la checklist (demande Alex, 29/08/2026) —
  // voir onboardingSteps plus bas. true par défaut comme les autres flags de
  // la checklist, pour ne jamais afficher l'étape comme "à faire" avant que
  // /api/preferences ait répondu (évite un flash trompeur au chargement).
  const [icsLinkGenerated, setIcsLinkGenerated] = useState(true);
  // Checklist résiduelle (refonte de l'onboarding, 22/10/2026) : les
  // notifications se règlent APPAREIL PAR APPAREIL — ordinateur et téléphone
  // ont chacun leur ligne. On lit les appareils déjà abonnés (user_agent) ;
  // isMobileDevice dit sur quel type d'appareil on est en ce moment.
  const [pushDevices, setPushDevices] = useState({ desktop: false, mobile: false });
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  // Agenda sur le téléphone : seulement pour une boîte SANS agenda (IMAP).
  // Avec Google ou Microsoft, les RDV vont déjà dans l'agenda du compte.
  const [mailboxHasCalendar, setMailboxHasCalendar] = useState(true);
  const [onboardingChecklistOpen, setOnboardingChecklistOpen] = useState(true);
  // Étape "notifications push" de la checklist (demande Alex, 28/08/2026 :
  // "il faut ajouter une autre tache : activer les notifications push sur cet
  // appareil [...] ca doit etre guidé par aaron") — même mécanisme
  // d'abonnement que components/PushNotificationManager.jsx (utilisé dans
  // Préférences), mais déclenché directement depuis la checklist plutôt que
  // de renvoyer vers une autre page : pushSubscribed reflète l'état RÉEL du
  // navigateur (Service Worker + PushManager), pas une simple préférence en
  // base. pushJustEnabled déclenche le message d'Aaron ("C'est fait ! [...]")
  // juste après une activation réussie dans CETTE session — ne persiste pas
  // au rechargement (pas besoin : l'étape passe simplement à "fait" ensuite).
  // Limite assumée : sur un navigateur/appareil qui ne supporte pas les
  // notifications push (Safari desktop, iOS hors PWA installée...), cette
  // étape ne peut structurellement jamais passer à "fait" — la checklist
  // reste alors affichée avec 4/5 pour ces commerciaux. Accepté plutôt que de
  // masquer l'étape ou de la faire compter à moitié : un clic dessus affiche
  // toujours l'explication (même texte que PushNotificationManager) plutôt
  // que d'échouer silencieusement.
  const [pushSupported, setPushSupported] = useState(true);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);
  const [pushJustEnabled, setPushJustEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(true);
 const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedRescue, setSelectedRescue] = useState(null);
  const [acknowledging, setAcknowledging] = useState(null);

  async function loadAll() {
    setLoading(true);
    const [pRes, cRes, aRes, dRes, cuRes, prefRes, bsRes, connRes] = await Promise.all([
      fetch(`/api/prospects?user_id=${userId}&scope=all`).then((r) => r.json()),
      fetch(`/api/campaigns?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/appointments?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/sales/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/customers/pipeline?user_id=${userId}`).then((r) => r.json()),
      fetch(`/api/preferences?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
      // Checklist de mise en route (voir déclaration des states ci-dessus) :
      // deux appels de plus, déjà légers et déjà utilisés ailleurs dans
      // l'appli (Préférences, Mon compte > Connexion) — pas de nouvelle route
      // nécessaire.
      // ok: false remonté explicitement (01/09/2026) : sur une erreur de la
      // route, on ne doit PAS conclure "profil business non complété" et
      // afficher une étape à faire alors que le profil existe — bug remonté
      // par Alex (checklist "à faire" alors que le PDF contenait le profil).
      fetch(`/api/business-summary?user_id=${userId}`)
        .then((r) => r.json().then((b) => ({ ...b, _ok: r.ok })))
        .catch(() => ({ _ok: false })),
      fetch(`/api/oauth-connections?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
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
    setOnboardingTourSeen(prefs.onboarding_tour_seen === true);
    setFirstName(String(prefs.full_name || '').trim().split(/\s+/)[0] || '');
    // Sur erreur (_ok false), on laisse la valeur optimiste par défaut
    // (true) plutôt que d'inventer une étape à faire.
    if (bsRes._ok !== false) setBusinessSummaryDone(!!bsRes.summary);
    setEmailConnected((connRes.connections || []).length > 0);
    setMailboxHasCalendar((connRes.connections || []).some((c) => c.provider === 'google' || c.provider === 'microsoft'));
    setIcsLinkGenerated(prefs.ics_link_generated === true);
    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  // Parcours de première connexion (22/10/2026) : un compte qui ne l'a pas
  // fini y retourne, à l'écran où il s'était arrêté — sauf s'il vient de
  // cliquer « Reprendre plus tard » (le temps de cette session ; le parcours
  // se rouvre à la prochaine connexion). Remplace l'ancienne redirection
  // quotidienne vers la checklist.
  useEffect(() => {
    if (!userId) return;
    try {
      if (window.sessionStorage.getItem('aaron-welcome-later')) return;
    } catch (err) {}
    fetch('/api/welcome')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b && b.done === false) window.location.replace(`/app/bienvenue?user_id=${userId}`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const mobileRe = /Android|iPhone|iPad|iPod|Mobile/i;
    setIsMobileDevice(mobileRe.test(navigator.userAgent || ''));
    if (!userId) return;
    fetch('/api/push/subscribe')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const devices = b?.devices || [];
        setPushDevices({
          desktop: devices.some((d) => d.user_agent && !mobileRe.test(d.user_agent)),
          mobile: devices.some((d) => d.user_agent && mobileRe.test(d.user_agent)),
        });
      })
      .catch(() => {});
  }, [userId, pushSubscribed]);

  // Détecte l'état RÉEL de l'abonnement push de cet appareil (voir le
  // commentaire sur les states plus haut) — même logique que
  // components/PushNotificationManager.jsx.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushSupported(false);
      return;
    }
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setPushSubscribed(!!existing);
    }).catch(() => {});
  }, []);

  function urlBase64ToUint8ArrayForPush(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // Abonnement push déclenché directement depuis la checklist (guidé par
  // Aaron — voir le commentaire sur les states plus haut). Sur succès,
  // affiche le message d'Aaron recommandant de faire pareil sur les autres
  // appareils du commercial.
  async function enablePushFromChecklist() {
    if (!pushSupported) {
      setPushError(t('preferences.pushUnsupportedHint', locale));
      return;
    }
    setPushBusy(true);
    setPushError(null);
    try {
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error('Notifications push pas encore configurées côté serveur.');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        throw new Error(t('preferences.pushPermissionDenied', locale));
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8ArrayForPush(vapidPublicKey),
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error("Échec de l'enregistrement côté serveur.");

      setPushSubscribed(true);
      setPushJustEnabled(true);
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

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

  // Lot 4 « Résultats du jour » (docx « mon avis », 31/08/2026) : 4 chiffres
  // clés du jour + entonnoir global du pipeline fusionné (lib/pipeline.ts).
  const prospectsContactesToday = prospects.filter((p) => p.created_at && new Date(p.created_at) >= startOfToday).length;
  const propositionsToday = prospects.filter((p) => p.quote_requested_at && new Date(p.quote_requested_at) >= startOfToday).length;
  const clientsGagnesToday = prospects.filter((p) => p.won_at && p.first_order_confirmed_at && new Date(p.won_at) >= startOfToday).length;
  const pipelineCounts = countPipeline(prospects);
  const funnelActive = prospects.filter((p) => !derivePipelinePosition(p).lost);
  const funnelContacts = funnelActive.length;
  const funnelRdv = funnelActive.filter((p) => stageOrder(derivePipelinePosition(p).stage) >= 2).length;
  const funnelPropositions = funnelActive.filter((p) => stageOrder(derivePipelinePosition(p).stage) >= 3).length;
  const funnelClients = pipelineCounts.byCategory.client;
  const funnelSteps = [
    { key: 'contacts', label: t('dash.funnelContacts', locale), value: funnelContacts, color: PIPELINE_COLORS.prospect },
    { key: 'rdv', label: t('pipeline.stage.rdvObtenu', locale), value: funnelRdv, color: PIPELINE_COLORS.opportunite },
    { key: 'propositions', label: t('dash.funnelPropositions', locale), value: funnelPropositions, color: '#b07cf5' },
    { key: 'clients', label: t('pipeline.cat.clients', locale), value: funnelClients, color: PIPELINE_COLORS.client },
  ];

  // #5 — au moins les 20 prochains RDV validés, regroupés par jour.
  const upcomingAppointments = appointments
    .filter((a) => a.status === 'validé' && new Date(a.proposed_at) > now)
    .slice(0, 20);
  const upcomingGroups = groupAppointmentsByDay(upcomingAppointments, locale);

  // Refonte 17/10/2026 : UN prochain rendez-vous mis en avant (pastille date,
  // brief d'Aaron déjà en cache sur appointments.pre_brief — aucun appel en
  // plus, et rien d'affiché tant qu'il n'a pas été généré depuis l'Agenda),
  // puis les suivants en liste courte.
  const nextAppt = upcomingAppointments[0] || null;
  const laterAppts = upcomingAppointments.slice(1, 4);
  const nextBrief = nextAppt?.pre_brief?.angle_approche_suggere || null;

  // Lecture en toutes lettres de l'entonnoir (« je ne comprends pas les % »,
  // Alex, 04/09/2026) : une phrase, pas des pourcentages par étape.
  const funnelRdvRate = funnelContacts > 0 ? Math.round((funnelRdv / funnelContacts) * 100) : null;
  const funnelClientRatio = funnelClients > 0 ? Math.max(1, Math.round(funnelContacts / funnelClients)) : null;

  // « Suggestion d'Aaron » (ampoule — Alex : « ça par contre j'adore »).
  // Pour l'instant une règle déterministe sur les données réelles, pas un
  // appel modèle : (1) campagne qui a atteint son objectif → en relancer
  // une ; (2) campagne qui a déjà signé le plus de clients → la meilleure
  // zone. Rien à dire → pas de bloc (pas de conseil creux).
  function campaignSuggestion() {
    const done = campaigns.find((c) => c.target_count > 0 && c.contacts_found >= c.target_count && (c.status === 'en_cours' || c.status === 'terminee' || c.status === 'terminée'));
    if (done) {
      return { text: fill(dt('suggestDone', locale), { name: done.zone_label, n: done.contacts_found }), href: `/app/campaigns${userId ? `?user_id=${userId}` : ''}`, cta: dt('launch', locale) };
    }
    const best = campaigns.filter((c) => (c.stats?.won || 0) > 0).sort((a, b) => (b.stats?.won || 0) - (a.stats?.won || 0))[0];
    if (best && campaigns.length > 1) {
      const n = best.stats.won;
      return { text: fill(dt('suggestBest', locale), { name: best.zone_label, n, w: dt(n > 1 ? 'clientN' : 'client1', locale) }), href: `/app/campaigns${userId ? `?user_id=${userId}` : ''}`, cta: dt('see', locale) };
    }
    return null;
  }
  const suggestion = loading ? null : campaignSuggestion();

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

  // Checklist de mise en route — voir le commentaire sur les states plus
  // haut. "Première campagne ou prospect" : un prospect ajouté à la main
  // compte autant qu'une campagne lancée, les deux prouvent que le
  // commercial a réellement mis un premier pied dans l'outil.
  // Checklist RÉSIDUELLE (refonte de l'onboarding validée par Alex, 21/10) :
  // la visite, la fiche entreprise et la première campagne sont faites dans
  // le parcours /app/bienvenue. Il ne reste ici que les derniers réglages,
  // et la liste disparaît une fois complète :
  //   - la boîte mail, seulement si elle n'est pas encore liée ;
  //   - les notifications sur l'ordinateur ET sur le téléphone (un appareil
  //     = une autorisation : deux lignes distinctes) ;
  //   - l'agenda sur le téléphone, seulement pour une boîte IMAP (sans
  //     agenda) : abonnement au flux ICS d'Aaron.
  // L'appareil sur lequel on est active sa propre ligne directement ; l'autre
  // ligne mène à Mon compte > Connexion (QR code pour le téléphone).
  const checklistConnexionHref = `/app/connexions?user_id=${userId}&tab=connection`;
  const onboardingSteps = [
    // Fiche entreprise sautée dans le parcours (ou génération ratée) : seul
    // rappel restant, sinon Aaron écrit sans savoir ce que vend le client
    // (relecture 22/10).
    !businessSummaryDone && {
      key: 'profile',
      done: false,
      label: t('dash.onboardingStepProfile', locale),
      href: `/app/chat?user_id=${userId}&restart_questionnaire=1`,
    },
    !emailConnected && {
      key: 'email',
      done: false,
      label: t('dash.onboardingStepEmail', locale),
      href: checklistConnexionHref,
    },
    {
      key: 'push_pc',
      done: pushDevices.desktop || (!isMobileDevice && pushSubscribed),
      label: pushBusy && !isMobileDevice ? t('dash.onboardingStepPushBusy', locale) : ckt('pushPc', locale),
      ...(isMobileDevice ? { href: checklistConnexionHref } : { action: enablePushFromChecklist }),
    },
    {
      key: 'push_phone',
      done: pushDevices.mobile || (isMobileDevice && pushSubscribed),
      label: pushBusy && isMobileDevice ? t('dash.onboardingStepPushBusy', locale) : ckt('pushPhone', locale),
      ...(isMobileDevice ? { action: enablePushFromChecklist } : { href: checklistConnexionHref }),
    },
    emailConnected && !mailboxHasCalendar && {
      key: 'calendar',
      done: icsLinkGenerated,
      label: ckt('phoneCalendar', locale),
      href: checklistConnexionHref,
    },
  ].filter(Boolean);
  const onboardingDoneCount = onboardingSteps.filter((s) => s.done).length;
  const onboardingComplete = onboardingDoneCount === onboardingSteps.length;
  // Item 13 (docx Modifs Aaron 30/08/2026) : "Aaron oblige à suivre les
  // étapes dans l'ordre" — seule la première étape non faite est
  // actionnable, les suivantes attendent leur tour (verrouillées).
  const firstPendingStep = onboardingSteps.find((step) => !step.done) || null;

  // Stories « mise en route » (Alex, 04/09/2026 : « les notifications
  // onboarding doivent apparaître comme une notification sur l'appli, donc
  // comme une story insta »). Une seule story, celle de l'étape en attente :
  // les étapes se font dans l'ordre (voir firstPendingStep), afficher les
  // suivantes n'apporterait qu'un bouton verrouillé.
  const onboardingStoryGroups = firstPendingStep && !loading
    ? [{
        type: 'mise_en_route',
        count: onboardingSteps.length - onboardingDoneCount,
        items: [{
          id: `mise_en_route:${firstPendingStep.key}`,
          type: 'mise_en_route',
          prospect_id: null,
          appointment_id: null,
          prospect_name: firstPendingStep.label,
          company_name: t('dash.onboardingStoryStep', locale).replace('{n}', onboardingDoneCount + 1).replace('{total}', onboardingSteps.length),
          personality_type: null,
          at: null,
          days_waiting: null,
          meta: {
            href: firstPendingStep.href,
            lead: t('dash.onboardingStoryLead', locale),
            hint: t('dash.onboardingStoryHint', locale),
            cta: t('dash.onboardingStepCta', locale),
          },
        }],
      }]
    : [];

  // Ancienne redirection automatique une fois par jour vers l'étape en
  // attente : SUPPRIMÉE le 22/10/2026 (refonte de l'onboarding validée par
  // Alex). La checklist reste un widget calme ; c'est le parcours
  // /app/bienvenue qui gère la reprise au bon endroit.

  // Item 13 (fin) : "une fois toutes les étapes faites, une fenêtre s'ouvre :
  // Félicitations ! tu es maintenant prêt à utiliser Aaron". Affichée une
  // seule fois, et seulement pour un compte qui a vu la checklist incomplète
  // sur cet appareil (les comptes déjà installés de longue date ne la
  // voient pas surgir sans raison).
  // Modernisation 16/10/2026, point 3 : clients signés depuis la dernière
  // visite (détectés par Aaron dans les emails, ou signature Youtrust) →
  // célébration plein écran, une fois. Voir components/WinCelebration.jsx.
  useEffect(() => {
    if (loading || !userId) return;
    checkNewWins(userId);
  }, [loading, userId]);

  const [congratsOpen, setCongratsOpen] = useState(false);
  useEffect(() => {
    if (loading || !userId) return;
    const seenKey = `aaron-onboarding-incomplete-seen-${userId}`;
    const shownKey = `aaron-onboarding-congrats-shown-${userId}`;
    try {
      if (!onboardingComplete) {
        window.localStorage.setItem(seenKey, '1');
        return;
      }
      if (window.localStorage.getItem(seenKey) && !window.localStorage.getItem(shownKey)) {
        window.localStorage.setItem(shownKey, '1');
        setCongratsOpen(true);
      }
    } catch (err) {
      // Stockage indisponible : pas de fenêtre, rien de bloquant.
    }
  }, [loading, userId, onboardingComplete]);

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
    <Shell active={t('nav.dashboard', locale)} userId={userId} onNotificationsChanged={loadAll} extraStoryGroups={onboardingStoryGroups} storiesAllClear>
      <header className="header">
        <div>
          {/* Refonte 17/10/2026 : la date du jour en sur-titre et un bonjour
              au prénom — le titre « Tableau de bord » n'apprenait rien. */}
          <p className="eyebrow">{(() => { const d = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }); return d.charAt(0).toUpperCase() + d.slice(1); })()}</p>
          <h1>{firstName ? fill(dt('hello', locale), { name: firstName }) : dt('helloAnon', locale)}</h1>
        </div>
        <ConnectionStatusBadge />
      </header>


      {loading ? (
        <p className="muted">{t('common.loading', locale)}</p>
      ) : (
        <>
          {congratsOpen && (
            <div className="congrats-overlay" role="dialog" aria-modal="true">
              <div className="congrats-card">
                <div className="congrats-emoji" aria-hidden="true"><Ic name="party" size={40} strokeWidth={1.8} /></div>
                <h2 className="congrats-title">{t('dash.onboardingCongratsTitle', locale)}</h2>
                <p className="congrats-body">{t('dash.onboardingCongratsBody', locale)}</p>
                <button type="button" className="congrats-btn" onClick={() => setCongratsOpen(false)}>
                  {t('dash.onboardingCongratsButton', locale)}
                </button>
              </div>
            </div>
          )}
          {!onboardingComplete && (
            <section className="onboarding-panel">
              <button className="onboarding-toggle" onClick={() => setOnboardingChecklistOpen(!onboardingChecklistOpen)}>
                <span>
                  {ckt('title', locale)}{' '}
                  <span className="badge">{onboardingDoneCount}/{onboardingSteps.length}</span>
                </span>
                <span className="chevron"><Ic name={onboardingChecklistOpen ? 'chevronUp' : 'chevronDown'} size={14} /></span>
              </button>
              {onboardingChecklistOpen && (
                <div className="onboarding-list">
                  {onboardingSteps.map((step) =>
                    step.done ? (
                      <div key={step.key} className="onboarding-row done">
                        <span className="onboarding-check done-check"><Ic name="check" size={12} strokeWidth={3} /></span>
                        <span className="onboarding-label">{step.label}</span>
                      </div>
                    ) : step.locked ? (
                      // Item 13 : étape verrouillée tant que la précédente
                      // n'est pas faite (ordre imposé, une chose à la fois).
                      <div key={step.key} className="onboarding-row locked" aria-disabled="true">
                        <span className="onboarding-check locked-check" aria-hidden="true"><Ic name="lock" size={11} /></span>
                        <span className="onboarding-label">{step.label}</span>
                        <span className="onboarding-cta onboarding-cta-locked">{t('dash.onboardingStepLocked', locale)}</span>
                      </div>
                    ) : step.action ? (
                      <button
                        key={step.key}
                        type="button"
                        className="onboarding-row onboarding-row-btn"
                        onClick={step.action}
                        disabled={pushBusy}
                      >
                        <span className="onboarding-check pending-check" aria-hidden="true" />
                        <span className="onboarding-label">{step.label}</span>
                        <span className="onboarding-cta">{t('dash.onboardingStepCta', locale)}</span>
                      </button>
                    ) : (
                      // Élément <a> natif et non <Link> (correctif 31/08/2026,
                      // capture Alex : puce décalée à gauche, CTA collé au
                      // texte) : styled-jsx n'ajoute sa classe de scope
                      // qu'aux éléments natifs, donc une ligne rendue via le
                      // composant Link ne recevait AUCUN des styles
                      // .onboarding-row/.onboarding-label/.onboarding-cta
                      // ci-dessous — les lignes "faites" (div) et "push"
                      // (button) étaient stylées, celle-ci jamais. Les
                      // rustines de hauteur fixe du 29/08 compensaient ce
                      // symptôme sans en voir la cause.
                      <a key={step.key} href={step.href} className="onboarding-row">
                        <span className="onboarding-check pending-check" aria-hidden="true" />
                        <span className="onboarding-label">{step.label}</span>
                        <span className="onboarding-cta">{t('dash.onboardingStepCta', locale)}</span>
                      </a>
                    )
                  )}
                  {pushError && <p className="onboarding-push-error">{pushError}</p>}
                  {pushJustEnabled && (
                    <div className="onboarding-aaron-note">
                      <span className="onboarding-aaron-avatar" aria-hidden="true"><Ic name="bot" size={16} /></span>
                      <span>{t('dash.onboardingPushDoneMessage', locale)}</span>
                    </div>
                  )}
                  {pushJustEnabled && !emailConnected && (
                    <div className="onboarding-aaron-note">
                      <span className="onboarding-aaron-avatar" aria-hidden="true"><Ic name="bot" size={16} /></span>
                      <span>
                        {t('dash.onboardingPushCalendarTip', locale)}{' '}
                        <Link href="/app/connexions?tab=connection">{t('dash.onboardingStepCta', locale)}</Link>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Actions requises et RDV manqués : remplacés par les stories de
              notifications en haut de page (components/Stories.jsx, docx
              « mon avis » 31/08/2026) — mêmes actions, une notif à la fois. */}

          {/* Réorganisation demandée par Alex (2026-08-25) : "Prochains
              rendez-vous" et "Campagnes en cours" remontent juste sous
              "Actions requises" (avant : après le bloc Prospect). Suivent
              ensuite, dans l'ordre, Prospect puis Opportunité puis Clients. */}
          {/* Refonte 04/09/2026 (Alex : « prochains rendez-vous et campagnes
              en cours — ça manque de modernité, de punch, de puissance »).
              Les deux blocs reprennent le langage visuel des pages qu'ils
              résument : la pastille jour/mois/heure de l'Agenda, la barre de
              progression avec pourcentage des Campagnes. Un en-tête avec
              lien « Voir tout » : le bloc est un aperçu, pas la page. */}

          {/* Modernisation 16/10/2026, point 1 (Alex : « ça manque de
              sérotonine ») : fil « Pendant ton absence » — ce qu'Aaron a
              fait pour l'utilisateur ces 7 derniers jours, façon fil
              Instagram. Lecture seule, zéro action demandée ; cliquer une
              ligne ouvre la fiche. */}
          {/* Refonte 17/10/2026 (maquettes validées) : rangée haute = résumé
              « Pendant ton absence » + prochain rendez-vous ; rangée basse =
              entonnoir en colonnes + campagne en cours avec la suggestion
              d'Aaron. La checklist de mise en route reste au-dessus tant
              qu'elle n'est pas finie — et revient si la boîte mail est
              déconnectée (emailConnected relu à chaque chargement). */}
          <section className="top-row">
            {userId && (
              <ActivityFeed
                userId={userId}
                locale={locale}
                onOpenContact={(id) => { window.location.href = `/app/prospects?user_id=${userId}&contact=${id}`; }}
              />
            )}

            <div className="panel next-panel">
              <div className="panel-head">
                <h2>{dt('next', locale)}</h2>
                <a className="panel-link" href={`/app/agenda${userId ? `?user_id=${userId}` : ''}`}>{dt('agenda', locale)} →</a>
              </div>
              {!nextAppt ? (
                <EmptyState
                  title={t('dash.emptyNothingPlanned', locale)}
                  body={t('dash.emptyNoConfirmedAppt', locale)}
                  compact
                  ctaHref="/app/agenda"
                  ctaLabel={t('dash.emptyApptCta', locale)}
                />
              ) : (() => {
                const d = new Date(nextAppt.proposed_at);
                const isToday = d.toDateString() === now.toDateString();
                const company = nextAppt.prospects?.prospect_companies?.name;
                return (
                  <>
                    <div className="next-main">
                      <span className={`next-date${isToday ? ' today' : ''}`} aria-hidden="true">
                        <span className="next-dow">{d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')}</span>
                        <b>{d.toLocaleDateString(locale, { day: 'numeric' })}</b>
                        <em>{d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</em>
                      </span>
                      <div className="next-body">
                        <strong>{nextAppt.prospects?.full_name || t('dash.unknownCompany', locale)}</strong>
                        <span className="muted next-sub">
                          {company || t('dash.unknownCompany', locale)}
                          {nextAppt.type ? ` · ${t(`apptType.${nextAppt.type}`, locale)}` : ''}
                        </span>
                      </div>
                    </div>
                    {nextBrief && (
                      <p className="next-tip"><b>{dt('brief', locale)}</b> {frenchTypography(nextBrief)}</p>
                    )}
                    <div className="next-actions">
                      <a className="btn-primary" href={`/app/agenda${userId ? `?user_id=${userId}` : ''}`}>{dt('prepare', locale)}</a>
                      {nextAppt.meet_link && (
                        <a className="btn-ghost" href={nextAppt.meet_link} target="_blank" rel="noreferrer">{dt('join', locale)}</a>
                      )}
                    </div>
                    {laterAppts.length > 0 && (
                      <>
                        <p className="next-then">{dt('then', locale)}</p>
                        <div className="mini-list">
                          {laterAppts.map((a) => {
                            const dd = new Date(a.proposed_at);
                            return (
                              <a key={a.id} className="mini-row" href="/app/agenda">
                                <span className="mini-chip" aria-hidden="true">
                                  <span className="mini-chip-num">{dd.toLocaleDateString(locale, { day: 'numeric' })}</span>
                                  <span className="mini-chip-mon">{dd.toLocaleDateString(locale, { month: 'short' }).replace('.', '')}</span>
                                </span>
                                <span className="mini-body">
                                  <strong>{a.prospects?.full_name}</strong>
                                  <span className="muted mini-sub">
                                    {a.prospects?.prospect_companies?.name || t('dash.unknownCompany', locale)}
                                    {a.type ? ` · ${t(`apptType.${a.type}`, locale)}` : ''}
                                  </span>
                                </span>
                                <span className="mini-time">{dd.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                              </a>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          </section>

          <section className="grid-two">
            <div className="panel">
              <div className="panel-head">
                <h2>{dt('funnel', locale)}</h2>
                <a className="panel-link" href={`/app/resultats${userId ? `?user_id=${userId}` : ''}`}>{dt('results', locale)} →</a>
              </div>
              {funnelContacts === 0 ? (
                <p className="muted funnel-empty">{dt('funnelEmpty', locale)}</p>
              ) : (
                <>
                  {/* Entonnoir en colonnes (maquette) : une colonne par étape,
                      hauteur = part des contacts, le chiffre au-dessus. */}
                  <a className="funnel-cols" href={`/app/prospects?user_id=${userId}`}>
                    {funnelSteps.map((step) => {
                      const h = Math.max(6, Math.round((step.value / funnelContacts) * 100));
                      return (
                        <div className="fcol" key={step.key}>
                          <b>{step.value}</b>
                          <span className="fbar-track"><i style={{ height: `${h}%`, background: step.color }} /></span>
                          <span className="flabel">{step.label}</span>
                        </div>
                      );
                    })}
                  </a>
                  <p className="funnel-read">
                    {funnelClientRatio
                      ? fill(dt('funnelRead', locale), { rate: funnelRdvRate, ratio: funnelClientRatio })
                      : fill(dt('funnelReadNoClient', locale), { rate: funnelRdvRate })}
                    {pipelineCounts.risk > 0 ? ` · ${pipelineCounts.risk} ${t('pipeline.riskLabel', locale).toLowerCase()}` : ''}
                    {pipelineCounts.lost > 0 ? ` · ${pipelineCounts.lost} ${t('pipeline.lostLabel', locale).toLowerCase()}` : ''}.
                  </p>
                </>
              )}

              {/* Les chiffres du jour (remise à zéro à minuit) : une ligne
                  discrète, avec le détail des RDV obtenus par type (option 2
                  d'Alex, 04/09/2026) en toutes lettres. */}
              <div className="today-inline">
                <span className="today-chip">{t('dash.todayResultsTitle', locale)}</span>
                <span className="today-stat"><b style={{ color: PIPELINE_COLORS.prospect }}>{prospectsContactesToday}</b> {t('dash.todayProspects', locale)}</span>
                <span className="today-stat"><b style={{ color: '#4B9EF0' }}>{rdvObtenus24h.length}</b> {t('dash.todayRdv', locale)}</span>
                <span className="today-stat"><b style={{ color: '#b07cf5' }}>{propositionsToday}</b> {t('dash.todayPropositions', locale)}</span>
                <span className="today-stat"><b style={{ color: PIPELINE_COLORS.client }}>{clientsGagnesToday}</b> {t('dash.todayClients', locale)}</span>
              </div>
              {userId && <SendInsightsCard userId={userId} locale={locale} compact />}
              {rdvObtenus24h.length > 0 && (
                <p className="today-types">
                  {dt('byType', locale)} : {t('apptType.visio', locale)} {rdvObtenusByType.visio} · {t('apptType.telephonique', locale)} {rdvObtenusByType.telephonique} · {t('apptType.physique', locale)} {rdvObtenusByType.physique}
                </p>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>{activeCampaigns.length > 1 ? t('dash.ongoingCampaigns', locale) : dt('campaign', locale)}</h2>
                <a className="panel-link" href={`/app/campaigns${userId ? `?user_id=${userId}` : ''}`}>{dt('see', locale)} →</a>
              </div>
              {activeCampaigns.length === 0 ? (
                <EmptyState
                  title={t('dash.emptyNoActiveCampaign', locale)}
                  body={t('dash.emptyLaunchCampaign', locale)}
                  compact
                  ctaHref={`/app/campaigns${userId ? `?user_id=${userId}` : ''}`}
                  ctaLabel={t('dash.emptyCampaignCta', locale)}
                />
              ) : (
                <div className="mini-list">
                  {activeCampaigns.slice(0, 3).map((c) => {
                    const pct = c.target_count > 0 ? Math.min(100, Math.round((c.contacts_found / c.target_count) * 100)) : 0;
                    const won = c.stats?.won || 0;
                    return (
                      <a key={c.id} className="mini-camp" href={`/app/campaigns${userId ? `?user_id=${userId}` : ''}`}>
                        <span className="mini-camp-head">
                          <strong>{c.zone_label}</strong>
                          <span className="mini-camp-pct">{c.contacts_found} / {c.target_count}</span>
                        </span>
                        <span className="muted mini-sub">{c.sector_keywords?.join(', ')}</span>
                        <span className="mini-camp-track"><span className="mini-camp-fill" style={{ width: `${pct}%` }} /></span>
                        <span className="muted mini-sub">{fill(dt('inProgress', locale), { active: c.stats?.active || 0, won, w: dt(won > 1 ? 'clientN' : 'client1', locale) })}</span>
                      </a>
                    );
                  })}
                </div>
              )}
              {suggestion && (
                <div className="suggest">
                  <span className="suggest-ic" aria-hidden="true"><Ic name="bulb" size={16} /></span>
                  <div className="suggest-body">
                    <b>{dt('suggestion', locale)}</b>
                    <span>{suggestion.text}</span>
                  </div>
                  {suggestion.href && <a className="btn-ghost small" href={suggestion.href}>{suggestion.cta}</a>}
                </div>
              )}
            </div>
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
        .onboarding-panel {
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid var(--accent);
          border-radius: var(--radius-lg);
          margin-bottom: 1.2rem;
          overflow: hidden;
        }
        .onboarding-toggle {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.3rem;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 0.92rem;
          font-weight: 700;
          color: var(--accent);
          font-family: inherit;
        }
        .onboarding-toggle .badge {
          background: var(--accent);
          color: #fff;
          border-radius: 999px;
          padding: 0.1rem 0.55rem;
          font-size: 0.78rem;
          margin-left: 0.4rem;
        }
        .onboarding-list {
          border-top: 1px solid rgba(59, 130, 246, 0.25);
        }
        .onboarding-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          gap: 0.7rem;
          padding: 0.75rem 1.3rem;
          border-bottom: 1px solid rgba(59, 130, 246, 0.15);
          text-decoration: none;
          color: var(--text);
          transition: background 0.15s;
          box-sizing: border-box;
          /* Bug remonté par Alex (29/08/2026, capture à l'appui) : la ligne
             "à faire" (celle qui a le CTA "À faire →", voir .onboarding-cta
             plus bas) s'affichait nettement plus haute que les autres —
             comme si un espace vide s'ajoutait sous le texte. Un premier
             correctif avec min-height n'a pas suffi (capture de suivi encore
             "moche"), donc on verrouille cette fois une hauteur FIXE (pas
             juste minimale) + overflow:hidden : quelle que soit la cause
             exacte de ce surplus de hauteur (poussée par du contenu qui
             déborde), la ligne ne peut plus dépasser cette taille — garantie
             plus forte que min-height, qui ne fait qu'empêcher d'être plus
             PETIT. */
          height: 2.9rem;
          overflow: hidden;
        }
        .onboarding-row:last-child {
          border-bottom: none;
        }
        a.onboarding-row:hover {
          background: rgba(59, 130, 246, 0.08);
        }
        .onboarding-check {
          flex-shrink: 0;
          width: 1.3rem;
          height: 1.3rem;
          box-sizing: border-box;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1;
        }
        .done-check {
          background: var(--accent-green, #2ecc71);
          color: #fff;
        }
        .pending-check {
          background: transparent;
          border: 2px solid var(--muted);
          opacity: 0.6;
        }
        .onboarding-label {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 0.9rem;
          /* Bug remonté par Alex (29/08/2026) : sur les lignes "à faire", le
             libellé partage la ligne avec la puce ronde ET le CTA "À faire →"
             (qui, lui, ne rétrécit jamais — voir flex-shrink:0 sur
             .onboarding-cta). Sans ceci, un libellé un peu long (ex: "Boîte
             email connectée (Gmail ou Outlook)") se mettait à passer sur 2
             lignes dès que l'écran était moins large qu'un grand bureau —
             cassant l'alignement avec les lignes "faites" (qui n'ont pas de
             CTA et ne wrappent donc presque jamais). On tronque proprement
             avec "…" plutôt que de laisser le texte déborder sur 2 lignes.
             Testé jusqu'à 320px de large (plus petit téléphone courant). */
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .onboarding-row.done .onboarding-label {
          color: var(--muted);
          text-decoration: line-through;
        }
        .onboarding-row.locked {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .locked-check {
          font-size: 0.8rem;
          width: 22px;
          text-align: center;
        }
        .onboarding-cta-locked {
          color: var(--muted) !important;
          font-weight: 500 !important;
        }
        .congrats-overlay {
          position: fixed;
          inset: 0;
          z-index: 130;
          background: rgba(5, 6, 12, 0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .congrats-card {
          background: var(--surface);
          border: 1px solid rgba(61, 214, 140, 0.4);
          border-radius: var(--radius-xl);
          padding: 2.2rem 1.9rem;
          width: min(460px, 100%);
          text-align: center;
          box-shadow: var(--shadow-lg), 0 0 60px rgba(61, 214, 140, 0.15);
        }
        .congrats-emoji {
          font-size: 2.6rem;
          margin-bottom: 0.6rem;
        }
        .congrats-title {
          margin: 0 0 0.6rem;
          font-family: var(--font-display);
          font-size: 1.45rem;
        }
        .congrats-body {
          margin: 0 0 1.4rem;
          color: var(--muted);
          font-size: 0.92rem;
          line-height: 1.5;
        }
        .congrats-btn {
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.8rem 1.4rem;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
        }
        .onboarding-cta {
          flex-shrink: 0;
          margin-left: auto;
          padding-left: 0.7rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--accent);
          white-space: nowrap;
        }
        .onboarding-row-btn {
          background: none;
          border: none;
          text-align: left;
          font-family: inherit;
          font-size: inherit;
          color: var(--text);
          cursor: pointer;
        }
        .onboarding-row-btn:hover {
          background: rgba(59, 130, 246, 0.08);
        }
        .onboarding-row-btn:disabled {
          cursor: wait;
          opacity: 0.7;
        }
        .onboarding-push-error {
          margin: 0;
          padding: 0.6rem 1.3rem;
          font-size: 0.8rem;
          color: var(--accent-red, #e5484d);
          background: rgba(229, 72, 77, 0.08);
          border-top: 1px solid rgba(229, 72, 77, 0.2);
        }
        .onboarding-aaron-note {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          padding: 0.8rem 1.3rem;
          font-size: 0.85rem;
          color: var(--text);
          background: rgba(46, 204, 113, 0.1);
          border-top: 1px solid rgba(46, 204, 113, 0.25);
        }
        .onboarding-aaron-avatar {
          flex-shrink: 0;
          font-size: 1.05rem;
          line-height: 1.3;
        }
        /* Checklist "mise en route du compte" trop serrée/mal calibrée sur
           petit écran (demande Alex, 29/08/2026, capture à l'appui, "sur le
           pc de mon père c'est encore pire") : en plus du correctif structurel
           ci-dessus (min-height + troncature du libellé), on resserre le
           padding et le CTA sous 480px pour laisser plus de place au libellé
           avant que la troncature "…" n'intervienne. 480px couvre déjà tous
           les téléphones courants (portrait ET la plupart des petits
           bureaux/laptops zoomés) — pas seulement le viewport "mobile" au
           sens strict, ce cas concret (PC avec petite résolution ou zoom
           navigateur élevé) déclenche exactement la même largeur effective. */
        @media (max-width: 480px) {
          .onboarding-toggle {
            padding: 0.85rem 1rem;
            font-size: 0.85rem;
          }
          .onboarding-row {
            padding: 0.7rem 1rem;
            gap: 0.5rem;
          }
          .onboarding-check {
            width: 1.15rem;
            height: 1.15rem;
          }
          .onboarding-label {
            font-size: 0.83rem;
          }
          .onboarding-cta {
            font-size: 0.74rem;
            padding-left: 0.4rem;
          }
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
        .today-panel h2 { margin-bottom: 1rem; }
        .funnel {
          display: block;
          margin-top: 1.4rem;
          text-decoration: none;
          color: inherit;
          border-top: 1px solid var(--border);
          padding-top: 1.1rem;
        }
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
          transition: width 0.4s var(--ease);
        }
        .funnel-hint { display: block; margin-top: 0.6rem; font-size: 0.72rem; color: var(--muted); }
        .funnel:hover .funnel-label { color: var(--text); }
        .category-panel {
          margin-top: 1.25rem;
        }
        /* « Entre les blocs campagnes en cours et les résultats du jour il n'y
           a pas d'espace » (Alex, 04/09/2026) : .grid-two et le bloc suivant
           étaient collés. */
        .today-panel {
          margin-top: 1.25rem;
        }
        /* Aperçus « Prochains rendez-vous » / « Campagnes en cours »
           (04/09/2026). */
        .panel-link {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--accent-light);
          text-decoration: none;
        }
        .panel-link:hover { color: var(--text); }
        .mini-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .mini-row,
        .mini-camp {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          padding: 0.7rem 0.85rem;
          border-radius: var(--radius-md);
          background: var(--bg);
          border: 1px solid var(--border);
          text-decoration: none;
          color: var(--text);
          transition: border-color var(--fast), transform var(--fast);
        }
        .mini-row:hover,
        .mini-camp:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
        }
        .mini-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 44px;
          flex-shrink: 0;
          padding: 0.3rem 0;
          border-radius: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
        }
        .mini-chip.today {
          background: rgba(75, 57, 239, 0.14);
          border-color: rgba(75, 57, 239, 0.5);
        }
        .mini-chip-num {
          font-family: var(--font-mono);
          font-size: 0.95rem;
          line-height: 1;
        }
        .mini-chip.today .mini-chip-num { color: var(--accent-light); }
        .mini-chip-mon {
          font-size: 0.58rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted);
          margin-top: 2px;
        }
        .mini-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
          font-size: 0.86rem;
        }
        .mini-sub {
          font-size: 0.74rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mini-time {
          font-family: var(--font-mono);
          font-size: 0.82rem;
          color: var(--accent-light);
          flex-shrink: 0;
        }
        .mini-camp {
          flex-direction: column;
          align-items: stretch;
          gap: 0.35rem;
        }
        .mini-camp-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 0.88rem;
        }
        .mini-camp-pct {
          font-family: var(--font-mono);
          font-size: 0.78rem;
        }
        .mini-camp-track {
          display: block;
          height: 7px;
          border-radius: 999px;
          background: var(--surface-hover);
          overflow: hidden;
        }
        .mini-camp-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), #c93f8c);
        }
        .panel-head {
          display: flex;
          align-items: baseline;
          gap: 0.6rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }
        .panel-head h2 { margin: 0; }
        .reset-chip {
          font-size: 0.7rem;
          color: var(--muted);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.15rem 0.55rem;
          white-space: nowrap;
        }
        .rdv-split {
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          margin: 0.45rem 0 0.1rem;
          padding-left: 0.9rem;
          border-left: 2px solid var(--border);
        }
        .rdv-split-row {
          display: grid;
          grid-template-columns: 4.6rem 1fr 1.6rem;
          align-items: center;
          gap: 0.5rem;
        }
        .rdv-split-label { font-size: 0.68rem; color: var(--muted); }
        .rdv-split-track { height: 6px; border-radius: 999px; background: var(--bg); overflow: hidden; }
        .rdv-split-bar { display: block; height: 100%; border-radius: 999px; background: #4B9EF0; transition: width 0.4s var(--ease); }
        .rdv-split-value { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text); text-align: right; }
        .today-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem 1.4rem;
          margin-top: 1.1rem;
          padding-top: 0.9rem;
          border-top: 1px solid var(--border);
          font-size: 0.76rem;
          color: var(--muted);
        }
        .today-stat b { font-family: var(--font-mono); font-size: 0.95rem; margin-right: 0.25rem; }
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
        /* Refonte 17/10/2026 — rangée haute : fil « Pendant ton absence »
           (components/ActivityFeed.jsx) + prochain rendez-vous. */
        .top-row {
          display: grid;
          grid-template-columns: 1.35fr 1fr;
          gap: 1.25rem;
          align-items: start;
          margin-bottom: 1.25rem;
        }
        .top-row :global(.feed) { margin-bottom: 0; }
        .next-main {
          display: flex;
          gap: 0.9rem;
          align-items: flex-start;
        }
        .next-date {
          flex: 0 0 auto;
          width: 58px;
          border-radius: 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          text-align: center;
          padding: 0.5rem 0 0.45rem;
          line-height: 1.1;
        }
        .next-date.today {
          background: rgba(75, 57, 239, 0.14);
          border-color: rgba(75, 57, 239, 0.5);
        }
        .next-dow { display: block; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
        .next-date b { display: block; font-size: 1.35rem; font-weight: 700; margin: 0.1rem 0; font-variant-numeric: tabular-nums; }
        .next-date.today b { color: var(--accent-light); }
        .next-date em { display: block; font-style: normal; font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-light); }
        .next-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-top: 0.2rem; }
        .next-body strong { font-size: 1rem; line-height: 1.25; }
        .next-sub { font-size: 0.82rem; }
        .next-tip {
          margin: 0.9rem 0 0;
          padding: 0.6rem 0.8rem;
          border-left: 3px solid var(--accent-green, #3dd68c);
          background: var(--state-good-bg);
          border-radius: 0 10px 10px 0;
          font-size: 0.86rem;
          line-height: 1.45;
        }
        .next-tip b { color: var(--state-good-text); font-weight: 600; }
        .next-actions { display: flex; gap: 0.5rem; margin-top: 0.9rem; }
        .btn-primary,
        .btn-ghost {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 40px;
          padding: 0 0.9rem;
          border-radius: 12px;
          font-size: 0.86rem;
          font-weight: 600;
          text-decoration: none;
          white-space: nowrap;
        }
        .btn-primary {
          background: linear-gradient(135deg, var(--accent), var(--accent-light));
          color: #fff;
          box-shadow: 0 6px 18px rgba(75, 57, 239, 0.28);
        }
        .btn-ghost {
          border: 1px solid var(--border);
          color: var(--text);
          background: var(--bg);
        }
        .btn-ghost.small { flex: 0 0 auto; height: 34px; padding: 0 0.75rem; font-size: 0.8rem; }
        .btn-primary:hover { filter: brightness(1.08); }
        .btn-ghost:hover { border-color: var(--accent); }
        .next-then {
          margin: 1rem 0 0.45rem;
          font-size: 0.68rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted);
        }
        /* Entonnoir en colonnes. */
        .funnel-cols {
          display: flex;
          gap: 0.5rem;
          align-items: stretch;
          height: 150px;
          text-decoration: none;
          color: inherit;
        }
        .fcol {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          gap: 0.35rem;
          min-width: 0;
        }
        .fcol b { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
        .fbar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
        .fbar-track i { display: block; width: 100%; border-radius: 8px 8px 4px 4px; transition: height 0.4s var(--ease); }
        .flabel {
          font-size: 0.7rem; color: var(--muted); text-align: center; line-height: 1.15;
          /* Hauteur fixe = 2 lignes pour TOUTES les colonnes. Sans ça, un
             libellé qui passe sur 2 lignes (« Contacts actifs ») prend plus
             de hauteur que les libellés sur 1 ligne, ce qui remonte la base
             de SA barre : la barre bleue paraissait « surélevée » par rapport
             aux autres (signalé par Alex, 19/10/2026). En réservant la même
             hauteur de libellé partout, toutes les barres repartent de la
             même ligne de base. */
          height: 1.7rem;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .funnel-cols:hover .flabel { color: var(--text); }
        .funnel-read { margin: 0.8rem 0 0; font-size: 0.8rem; color: var(--muted); line-height: 1.45; }
        .funnel-empty { font-size: 0.88rem; }
        .today-chip {
          font-size: 0.68rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          flex-basis: 100%;
        }
        .today-types { margin: 0.4rem 0 0; font-size: 0.74rem; color: var(--muted); }
        /* Suggestion d'Aaron (ampoule). */
        .suggest {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-top: 0.9rem;
          padding: 0.7rem 0.85rem;
          border-radius: var(--radius-md);
          background: var(--state-warn-bg);
          border: 1px solid rgba(245, 166, 35, 0.35);
        }
        .suggest-ic {
          flex: 0 0 auto;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(245, 166, 35, 0.16);
          color: var(--state-warn-text);
        }
        .suggest-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .suggest-body b { font-size: 0.82rem; color: var(--state-warn-text); }
        .suggest-body span { font-size: 0.84rem; line-height: 1.4; }
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
          .grid-two,
          .top-row {
            grid-template-columns: 1fr;
          }
          .funnel-cols { height: 130px; }
          .suggest { flex-wrap: wrap; }
          .suggest .btn-ghost.small { flex-basis: 100%; }
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
        <button className="close-btn" onClick={onClose}><Ic name="x" size={16} /></button>

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
                    <span>{frenchTypography(prospect.personality_notes)}</span>
                  </div>
                )}
                <div className="fiche-row">
                  <span className="fiche-label">{t('modal.aaronAdvice', locale)}</span>
                  <span>{prospect?.aaron_advice ? frenchTypography(prospect.aaron_advice) : '—'}</span>
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
  // Relance d'actualité (lib/news-triggers.ts) : même circuit de validation
  // que le sauvetage, mais on montre POURQUOI Aaron écrit maintenant.
  const isNews = prospect.rescue_proposal_source === 'actualite';
  const newsSignal = prospect.prospect_companies?.news_signal || null;

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
        <button className="close-btn" onClick={onClose}><Ic name="x" size={16} /></button>

        <div className="prospect-center">
          <div className="avatar">{prospect.full_name?.[0] || '?'}</div>
          <h2>{prospect.full_name}</h2>
          <p className="company muted">{prospect.prospect_companies?.name || t('dash.unknownCompany', locale)}</p>
          <span className="status-pill" style={isNews ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : { color: '#8B90A8', borderColor: '#8B90A8' }}>
            {isNews ? dt('newsPill', locale) : t('rescue.title', locale)}
          </span>
        </div>

        {isNews && newsSignal && (
          <div className="news-box">
            <Ic name="newspaper" size={15} />
            <div>
              <p className="news-lead">{fill(dt('newsLead', locale), { company: prospect.prospect_companies?.name || prospect.full_name })}</p>
              <p className="news-signal">{newsSignal}</p>
              {prospect.prospect_companies?.news_signal_url && (
                <a className="news-src" href={prospect.prospect_companies.news_signal_url} target="_blank" rel="noopener noreferrer">
                  {dt('newsSource', locale)}
                </a>
              )}
            </div>
          </div>
        )}

        <div className="scroll-section">
          <p className="rescue-subject"><strong>{prospect.rescue_proposal_subject}</strong></p>
          <p className="rescue-body">{prospect.rescue_proposal_body}</p>
        </div>

        <div className="actions-row">
          <button className="btn-valid" disabled={acting} onClick={() => handleAction('approuver_sauvetage')}>
            {isNews ? dt('newsSend', locale) : t('rescue.sendAttempt', locale)}
          </button>
          <button className="btn-danger" disabled={acting} onClick={() => handleAction('rejeter_sauvetage')}>
            {isNews ? dt('newsSkip', locale) : t('rescue.abandon', locale)}
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
        .news-box {
          display: flex;
          gap: 0.6rem;
          align-items: flex-start;
          margin-bottom: 0.9rem;
          padding: 0.75rem 0.9rem;
          border-radius: var(--radius-md);
          background: var(--accent-soft, rgba(99, 102, 241, 0.1));
          color: var(--text);
        }
        .news-box :global(svg) {
          flex-shrink: 0;
          margin-top: 2px;
          color: var(--accent);
        }
        .news-lead {
          margin: 0 0 0.2rem;
          font-size: 0.78rem;
          color: var(--muted);
        }
        .news-signal {
          margin: 0;
          font-size: 0.88rem;
          font-weight: 500;
        }
        .news-src {
          display: inline-block;
          margin-top: 0.3rem;
          font-size: 0.76rem;
          color: var(--accent);
          text-decoration: underline;
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

// `ctaHref`/`ctaLabel` (04/09/2026, demande Alex : « s'il n'y en a aucune il
// faut un + ou quelque chose de plus joli qui donne envie de créer une
// campagne ») transforment le vide en invitation : un grand bouton rond « + »
// au lieu d'un simple constat d'absence.
function EmptyState({ title, body, compact, ctaHref, ctaLabel }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      {/* Balises <a> natives et non <Link> (bug vu par Alex, 04/09/2026 :
          « le + est mal mis ») : styled-jsx n'applique pas sa classe de
          scope au className d'un <Link>, donc .empty-plus et .empty-cta
          n'étaient JAMAIS stylés — le + s'affichait nu, collé à gauche, et
          le bouton d'appel n'était qu'un texte. */}
      {ctaHref && (
        <a href={ctaHref} className="empty-plus" aria-label={ctaLabel} title={ctaLabel}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </a>
      )}
      {/* Les deux textes sont groupés pour pouvoir se placer EN COLONNE à
          droite du rond quand l'état vide passe en ligne sur téléphone (voir
          la media query plus bas). Sans ce groupe, titre et texte
          deviendraient deux colonnes côte à côte. */}
      <div className="empty-text">
        <p className="empty-title">{title}</p>
        <p className="empty-body">{body}</p>
      </div>
      {/* Plus de bouton texte sous le « + » (Alex, 05/09/2026 : « supprime
          "ajouter un rdv" et "lancer une campagne" puisqu'on a le + ») : le
          rond est l'action, son libellé reste en info-bulle et pour les
          lecteurs d'écran. */}
      <style jsx>{`
        .empty {
          display: flex;
          flex-direction: column;
          align-items: center;
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
        .empty-plus {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          margin-bottom: 0.85rem;
          color: var(--accent-light);
          background: rgba(75, 57, 239, 0.12);
          border: 1px solid rgba(75, 57, 239, 0.45);
          transition: transform var(--fast), background var(--fast);
        }
        .empty-plus:hover {
          transform: scale(1.06);
          background: rgba(75, 57, 239, 0.2);
        }
        .empty-cta {
          display: inline-block;
          margin-top: 0.9rem;
          background: linear-gradient(135deg, var(--accent), var(--accent-light));
          color: #fff;
          text-decoration: none;
          font-size: 0.82rem;
          font-weight: 600;
          padding: 0.55rem 1.1rem;
          border-radius: 999px;
          box-shadow: var(--shadow-glow);
        }
        /* ÉTAT VIDE SUR TÉLÉPHONE (13/10/2026). Capture d'Alex : son tableau
           de bord n'affichait que deux grands cadres vides empilés, 4rem de
           marge verticale chacun, un gros rond « + » centré, et rien d'autre
           sur tout l'écran. Ce n'est pas un problème de couleurs : c'est du
           vide qui occupe la place du contenu.
           Sur téléphone, l'état vide passe donc en LIGNE — le rond à gauche,
           le texte à côté, aligné à gauche comme le reste de la page. Deux
           pavés de 250 px deviennent deux lignes de 80 px, et l'écran cesse
           de ressembler à une page qui n'a pas fini de charger. */
        @media (max-width: 900px) {
          .empty {
            flex-direction: row;
            align-items: center;
            text-align: left;
            gap: 1rem;
            padding: 1.35rem 1.1rem;
          }
          .empty-plus {
            margin-bottom: 0;
            flex: 0 0 auto;
            width: 46px;
            height: 46px;
          }
          .empty-text {
            min-width: 0;
          }
          .empty-title {
            font-size: 1rem;
          }
          .empty-body {
            font-size: 0.86rem;
            line-height: 1.45;
          }
        }
      `}</style>
    </div>
  );
}

function Shell({ children, active, userId, onNotificationsChanged, onNotificationContact, extraStoryGroups, storiesAllClear = false }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  // Docx « derniers ajouts » (05/09/2026) : « Mon équipe » disparaissait
  // 1–2 s à chaque changement de rubrique, le temps que /api/preferences
  // réponde, puis réapparaissait. On relit d'abord le rôle mémorisé lors de
  // la dernière réponse (par utilisateur), puis la réponse le confirme : la
  // rubrique est là dès le premier rendu et ne bouge plus.
  useEffect(() => {
    if (!userId) return;
    try {
      const cached = window.localStorage.getItem(`aaron_role:${userId}`);
      if (cached) setUserRole(cached);
    } catch {
      // stockage indisponible : on attend simplement la réponse réseau
    }
  }, [userId]);
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
        try {
          window.localStorage.setItem(`aaron_role:${userId}`, prefs.role || '');
        } catch {
          // idem : best effort
        }
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
        {/* Rail replié (≥901px) : le nom de la langue ne tient pas dans 78 px
            (« França… », capture Alex 05/09) — .lang-wrap affiche le code (FR)
            par-dessus le select, qui garde les noms complets dans sa liste. */}
        <div className="lang-wrap" data-code={locale.toUpperCase()}>
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
            <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
          ))}
        </select>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className={railLinkClass(item.slug, item.label, active)}
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        {/* Rubriques rares dans « Plus » (modernisation 16/10/2026, point 4) — components/RailMore.jsx */}
        <RailMore items={NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron'))} active={active} userId={userId} label={t('shell.more', locale)} notIncludedLabel={t('shell.notIncluded', locale)} />
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon"><NavIcon slug="logout" /></span>
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
        <Stories userId={userId} locale={locale} onChanged={onNotificationsChanged} onOpenContact={onNotificationContact} extraGroups={extraStoryGroups || []} allClear={storiesAllClear} />
        {/* Installation sur l'écran d'accueil (08/09/2026) — voir
            components/InstallPrompt.jsx. Uniquement sur le tableau de bord :
            c'est la page d'arrivée, une fois suffit. */}
        <InstallPrompt locale={locale} />
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
          --border-soft: var(--tint-7);
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
          box-shadow: 0 0 0 1px var(--tint-8), 0 4px 14px rgba(75, 57, 239, 0.35);
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
          background: var(--tint-4);
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
