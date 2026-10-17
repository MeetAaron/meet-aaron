// components/WinCelebration.jsx
//
// Modernisation 16/10/2026, point 3 (validé par Alex) : quand un client est
// gagné, l'app le fête en plein écran — titre, nom du client, pluie de
// confettis — au lieu d'un simple changement d'étiquette dans une liste.
// C'est LE moment de satisfaction du métier de commercial ; il doit se voir.
//
// Monté une seule fois dans app/layout.jsx. Deux déclencheurs, un seul
// affichage :
//   1. celebrateWin({ name, company, prospectId }) — appelé par la fiche
//      contact quand le commercial marque lui-même un client gagné ;
//   2. checkNewWins(userId) — appelé par le tableau de bord : fête les
//      clients signés depuis la dernière visite (Aaron les détecte seul dans
//      les emails, ou via la signature électronique Youtrust, pendant que le
//      commercial n'est pas devant l'écran).
//
// Mémoire par appareil (localStorage, clé par utilisateur) : la date du
// dernier client déjà fêté. Première visite = on mémorise sans fêter, pour
// ne pas fêter d'un coup tous les clients historiques d'un compte existant.
// Un client fêté à la main est aussi mémorisé, pour ne pas le refêter au
// retour sur le tableau de bord.
//
// Confettis dessinés à la main sur un <canvas> (aucune dépendance), coupés
// si l'utilisateur a demandé moins d'animations (prefers-reduced-motion).

'use client';

import { useEffect, useRef, useState } from 'react';
import Ic from '@/components/UiIcon';
import { useLocale } from '@/lib/i18n';

// Textes de la célébration, dans les 7 langues de l'app. Gardés ici plutôt
// que dans lib/i18n.js : ce fichier dépasse 1 Mo et l'envoi web de GitHub
// bloque dessus ; ces six phrases n'ont pas besoin d'y être.
const TEXT = {
  fr: { title: 'Nouveau client !', titleMany: '{n} nouveaux clients !', body: "Il vient de signer. Aaron s'occupe de son accueil.", bodyMany: "Ils viennent de signer. Aaron s'occupe de leur accueil.", open: 'Voir la fiche', close: 'Continuer' },
  en: { title: 'New client!', titleMany: '{n} new clients!', body: 'They just signed. Aaron is taking care of onboarding.', bodyMany: 'They just signed. Aaron is taking care of onboarding.', open: 'Open the contact', close: 'Continue' },
  de: { title: 'Neuer Kunde!', titleMany: '{n} neue Kunden!', body: 'Gerade unterschrieben. Aaron kümmert sich um das Onboarding.', bodyMany: 'Gerade unterschrieben. Aaron kümmert sich um das Onboarding.', open: 'Kontakt öffnen', close: 'Weiter' },
  it: { title: 'Nuovo cliente!', titleMany: '{n} nuovi clienti!', body: "Ha appena firmato. Aaron si occupa dell'accoglienza.", bodyMany: "Hanno appena firmato. Aaron si occupa dell'accoglienza.", open: 'Apri la scheda', close: 'Continua' },
  es: { title: '¡Nuevo cliente!', titleMany: '¡{n} nuevos clientes!', body: 'Acaba de firmar. Aaron se encarga de su bienvenida.', bodyMany: 'Acaban de firmar. Aaron se encarga de su bienvenida.', open: 'Ver la ficha', close: 'Continuar' },
  pt: { title: 'Novo cliente!', titleMany: '{n} novos clientes!', body: 'Acabou de assinar. O Aaron trata do acolhimento.', bodyMany: 'Acabaram de assinar. O Aaron trata do acolhimento.', open: 'Ver a ficha', close: 'Continuar' },
  nl: { title: 'Nieuwe klant!', titleMany: '{n} nieuwe klanten!', body: 'Net getekend. Aaron regelt de onboarding.', bodyMany: 'Net getekend. Aaron regelt de onboarding.', open: 'Fiche openen', close: 'Doorgaan' },
};
const t = (key, locale) => (TEXT[locale] || TEXT.fr)[key.replace('win.', '')] || TEXT.fr[key.replace('win.', '')];

const EVENT = 'aaron:client-won';
const seenKey = (userId) => `aaron_last_win_celebrated:${userId}`;

export function celebrateWin(detail) {
  if (typeof window === 'undefined') return;
  try {
    if (detail?.userId) window.localStorage.setItem(seenKey(detail.userId), new Date().toISOString());
  } catch (err) {
    // Stockage indisponible : la fête a lieu quand même.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: detail || {} }));
}

export async function checkNewWins(userId) {
  if (typeof window === 'undefined' || !userId) return;
  let last = null;
  try {
    last = window.localStorage.getItem(seenKey(userId));
  } catch (err) {
    return; // sans mémoire, on ne peut pas savoir ce qui est « nouveau »
  }
  let clients = [];
  try {
    const res = await fetch(`/api/won-clients?user_id=${userId}`);
    if (!res.ok) return;
    const json = await res.json();
    clients = Array.isArray(json.wonClients) ? json.wonClients : [];
  } catch (err) {
    return;
  }
  const dated = clients
    .map((c) => ({ c, at: c.first_order_confirmed_at || c.won_at }))
    .filter((x) => x.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const newest = dated[0]?.at || new Date().toISOString();
  try {
    window.localStorage.setItem(seenKey(userId), newest);
  } catch (err) {
    return;
  }
  if (!last) return; // première visite sur cet appareil : on mémorise sans fêter
  const fresh = dated.filter((x) => x.at > last);
  if (fresh.length === 0) return;
  const top = fresh[0].c;
  window.dispatchEvent(new CustomEvent(EVENT, {
    detail: {
      userId,
      prospectId: top.id,
      name: top.full_name,
      company: top.prospect_companies?.name || null,
      count: fresh.length,
    },
  }));
}

const COLORS = ['#7c6ef5', '#4b39ef', '#3dd68c', '#f5a623', '#ef4459', '#ffffff'];

function runConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
  };
  resize();
  window.addEventListener('resize', resize);
  const W = () => canvas.width;
  const H = () => canvas.height;
  const pieces = Array.from({ length: 160 }, () => ({
    x: W() / 2 + (Math.random() - 0.5) * W() * 0.2,
    y: H() * 0.42,
    vx: (Math.random() - 0.5) * 22 * dpr,
    vy: (-Math.random() * 20 - 8) * dpr,
    w: (6 + Math.random() * 6) * dpr,
    h: (9 + Math.random() * 8) * dpr,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const start = performance.now();
  let raf = 0;
  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, W(), H());
    pieces.forEach((p) => {
      p.vy += 0.45 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 4200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
      ctx.restore();
    });
    if (elapsed < 4200) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W(), H());
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}

export default function WinCelebration() {
  const [win, setWin] = useState(null);
  const canvasRef = useRef(null);
  const closeRef = useRef(null);
  const [locale] = useLocale();

  useEffect(() => {
    const onWin = (e) => setWin(e.detail || {});
    window.addEventListener(EVENT, onWin);
    return () => window.removeEventListener(EVENT, onWin);
  }, []);

  useEffect(() => {
    if (!win) return undefined;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stop = () => {};
    if (!reduce && canvasRef.current) stop = runConfetti(canvasRef.current);
    try { if (navigator.vibrate) navigator.vibrate([30, 60, 30]); } catch (err) { /* sans vibreur */ }
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setWin(null); };
    window.addEventListener('keydown', onKey);
    return () => { stop(); window.removeEventListener('keydown', onKey); };
  }, [win]);

  if (!win) return null;

  const count = win.count || 1;
  const title = count > 1
    ? t('win.titleMany', locale).replace('{n}', count)
    : t('win.title', locale);
  const who = win.name
    ? (win.company ? `${win.name} · ${win.company}` : win.name)
    : null;
  const openHref = win.prospectId && win.userId
    ? `/app/prospects?user_id=${win.userId}&contact=${win.prospectId}`
    : null;

  return (
    <div className="win-overlay" role="dialog" aria-modal="true" aria-labelledby="win-title" onClick={() => setWin(null)}>
      <canvas ref={canvasRef} className="win-confetti" aria-hidden="true" />
      <div className="win-card" onClick={(e) => e.stopPropagation()}>
        <div className="win-ring" aria-hidden="true">
          <span className="win-ring-inner"><Ic name="trophy" size={44} strokeWidth={1.8} /></span>
        </div>
        <h2 id="win-title" className="win-title">{title}</h2>
        {who && <p className="win-who">{who}</p>}
        <p className="win-body">{count > 1 ? t('win.bodyMany', locale) : t('win.body', locale)}</p>
        <div className="win-actions">
          {openHref && (
            <a className="win-btn win-btn-primary" href={openHref}>{t('win.open', locale)}</a>
          )}
          <button ref={closeRef} type="button" className={`win-btn${openHref ? '' : ' win-btn-primary'}`} onClick={() => setWin(null)}>
            {t('win.close', locale)}
          </button>
        </div>
      </div>
    </div>
  );
}
