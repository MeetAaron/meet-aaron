// components/SetupChecklist.jsx
//
// CHECKLIST DE MISE EN ROUTE, extraite du tableau de bord (06/11/2026).
//
// Décision d'Alex (docx du 05/11, confirmée le 06/11) : Campagnes devient
// l'accueil et l'onglet Tableau de bord disparaît. Ce composant reprend tel
// quel ce que le tableau de bord faisait pour un compte neuf : les derniers
// réglages (fiche entreprise, boîte mail, notifications sur chaque appareil,
// agenda du téléphone), la story « mise en route » qui ne montre que l'étape
// en attente, la fenêtre de félicitations une fois tout fait, la bascule
// vers /app/bienvenue tant que le parcours d'accueil n'est pas terminé, et
// la célébration des clients signés depuis la dernière visite.
//
// Autonome : il charge ce dont il a besoin et remonte la story au parent par
// onStoryGroups (le Shell la passe aux Stories en `extraGroups`). Rend null
// quand tout est fait — aucune hauteur perdue sur un compte rodé.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import Ic from '@/components/UiIcon';
import { checkNewWins } from '@/components/WinCelebration';

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

export default function SetupChecklist({ userId, locale, onStoryGroups }) {
  const [loading, setLoading] = useState(true);
  const [businessSummaryDone, setBusinessSummaryDone] = useState(true);
  const [emailConnected, setEmailConnected] = useState(true);
  const [icsLinkGenerated, setIcsLinkGenerated] = useState(true);
  const [pushDevices, setPushDevices] = useState({ desktop: false, mobile: false });
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [mailboxHasCalendar, setMailboxHasCalendar] = useState(true);
  const [open, setOpen] = useState(true);
  const [pushSupported, setPushSupported] = useState(true);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);
  const [pushJustEnabled, setPushJustEnabled] = useState(false);
  const [congratsOpen, setCongratsOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let stop = false;
    (async () => {
      const [prefRes, bsRes, connRes] = await Promise.all([
        fetch(`/api/preferences?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/business-summary?user_id=${userId}`)
          .then((r) => r.json().then((b) => ({ ...b, _ok: r.ok })))
          .catch(() => ({ _ok: false })),
        fetch(`/api/oauth-connections?user_id=${userId}`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (stop) return;
      const prefs = prefRes.preferences || {};
      if (bsRes._ok !== false) setBusinessSummaryDone(!!bsRes.summary);
      setEmailConnected((connRes.connections || []).length > 0);
      setMailboxHasCalendar((connRes.connections || []).some((c) => c.provider === 'google' || c.provider === 'microsoft'));
      setIcsLinkGenerated(prefs.ics_link_generated === true);
      setLoading(false);
    })();
    return () => { stop = true; };
  }, [userId]);

  // Parcours d'accueil pas terminé : on y renvoie (sauf « reprendre plus
  // tard » posé pour la session).
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

  useEffect(() => {
    if (loading || !userId) return;
    checkNewWins(userId);
  }, [loading, userId]);

  function urlBase64ToUint8ArrayForPush(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function enablePushFromChecklist() {
    if (!pushSupported) {
      setPushError(t('preferences.pushUnsupportedHint', locale));
      return;
    }
    setPushBusy(true);
    setPushError(null);
    try {
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) throw new Error('Notifications push pas encore configurées côté serveur.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(t('preferences.pushPermissionDenied', locale));
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

  const checklistConnexionHref = `/app/connexions?user_id=${userId}&tab=connection`;
  const steps = [
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
  const doneCount = steps.filter((s) => s.done).length;
  const complete = doneCount === steps.length;
  const firstPending = steps.find((step) => !step.done) || null;

  // Story « mise en route » : une seule, l'étape en attente.
  useEffect(() => {
    if (!onStoryGroups) return;
    if (loading || !firstPending) {
      onStoryGroups([]);
      return;
    }
    onStoryGroups([{
      type: 'mise_en_route',
      count: steps.length - doneCount,
      items: [{
        id: `mise_en_route:${firstPending.key}`,
        type: 'mise_en_route',
        prospect_id: null,
        appointment_id: null,
        prospect_name: firstPending.label,
        company_name: t('dash.onboardingStoryStep', locale).replace('{n}', doneCount + 1).replace('{total}', steps.length),
        personality_type: null,
        at: null,
        days_waiting: null,
        meta: {
          href: firstPending.href,
          lead: t('dash.onboardingStoryLead', locale),
          hint: t('dash.onboardingStoryHint', locale),
          cta: t('dash.onboardingStepCta', locale),
        },
      }],
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, firstPending?.key, firstPending?.label, doneCount, steps.length, locale]);

  useEffect(() => {
    if (loading || !userId) return;
    const seenKey = `aaron-onboarding-incomplete-seen-${userId}`;
    const shownKey = `aaron-onboarding-congrats-shown-${userId}`;
    try {
      if (!complete) {
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
  }, [loading, userId, complete]);

  if (loading) return null;

  return (
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
      {!complete && (
        <section className="onboarding-panel">
          <button className="onboarding-toggle" onClick={() => setOpen(!open)}>
            <span>
              {ckt('title', locale)}{' '}
              <span className="badge">{doneCount}/{steps.length}</span>
            </span>
            <span className="chevron"><Ic name={open ? 'chevronUp' : 'chevronDown'} size={14} /></span>
          </button>
          {open && (
            <div className="onboarding-list">
              {steps.map((step) =>
                step.done ? (
                  <div key={step.key} className="onboarding-row done">
                    <span className="onboarding-check done-check"><Ic name="check" size={12} strokeWidth={3} /></span>
                    <span className="onboarding-label">{step.label}</span>
                  </div>
                ) : step.action ? (
                  <button key={step.key} type="button" className="onboarding-row onboarding-row-btn" onClick={step.action} disabled={pushBusy}>
                    <span className="onboarding-check pending-check" aria-hidden="true" />
                    <span className="onboarding-label">{step.label}</span>
                    <span className="onboarding-cta">{t('dash.onboardingStepCta', locale)}</span>
                  </button>
                ) : (
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
      <style jsx>{`
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
      `}</style>
    </>
  );
}
