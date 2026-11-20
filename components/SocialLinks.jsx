// components/SocialLinks.jsx
//
// MON COMPTE > RÉSEAUX SOCIAUX (19/11/2026).
//
// Le bloc où l'on lie ses réseaux, placé sous l'adresse email (décision
// d'Alex du 18/11). TikTok et LinkedIn ; Instagram et Facebook
// s'ajouteront ici à mesure que leur liaison sera codée.
//
// Visible uniquement sur le compte aaron@meetaaron.app tant qu'Aaron Social
// n'est pas ouvert aux clients (lib/social-access.js) : le parent ne monte ce
// composant que pour ce compte, et les routes /api/social/* refusent tous les
// autres.
//
// Le retour de TikTok arrive sur cette page avec ?social=tiktok&etat=ok,
// refus ou erreur : on affiche une ligne, puis on nettoie l'adresse.

'use client';

import { useEffect, useState } from 'react';

const TEXT = {
  fr: { title: 'Réseaux sociaux', link: 'Lier', linked: 'Lié', unlink: 'Délier', ok: '{name} est lié.', refus: 'Liaison refusée sur {name}.', erreur: "La liaison n'a pas abouti. Réessaie.", soon: 'Pas encore disponible.' },
  en: { title: 'Social networks', link: 'Link', linked: 'Linked', unlink: 'Unlink', ok: '{name} is linked.', refus: 'Linking was declined on {name}.', erreur: 'Linking failed. Try again.', soon: 'Not available yet.' },
  de: { title: 'Soziale Netzwerke', link: 'Verknüpfen', linked: 'Verknüpft', unlink: 'Trennen', ok: '{name} ist verknüpft.', refus: 'Verknüpfung auf {name} abgelehnt.', erreur: 'Verknüpfung fehlgeschlagen. Bitte erneut versuchen.', soon: 'Noch nicht verfügbar.' },
  it: { title: 'Social network', link: 'Collega', linked: 'Collegato', unlink: 'Scollega', ok: '{name} è collegato.', refus: 'Collegamento rifiutato su {name}.', erreur: 'Collegamento non riuscito. Riprova.', soon: 'Non ancora disponibile.' },
  es: { title: 'Redes sociales', link: 'Vincular', linked: 'Vinculado', unlink: 'Desvincular', ok: '{name} está vinculado.', refus: 'Vinculación rechazada en {name}.', erreur: 'La vinculación ha fallado. Inténtalo de nuevo.', soon: 'Aún no disponible.' },
  pt: { title: 'Redes sociais', link: 'Ligar', linked: 'Ligado', unlink: 'Desligar', ok: 'O {name} está ligado.', refus: 'Ligação recusada no {name}.', erreur: 'A ligação falhou. Tenta de novo.', soon: 'Ainda não disponível.' },
  nl: { title: 'Sociale netwerken', link: 'Koppelen', linked: 'Gekoppeld', unlink: 'Ontkoppelen', ok: '{name} is gekoppeld.', refus: 'Koppeling geweigerd op {name}.', erreur: 'Koppelen is mislukt. Probeer het opnieuw.', soon: 'Nog niet beschikbaar.' },
};
const tx = (locale, key) => (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key];

// Réseaux reliables, dans l'ordre d'affichage (LinkedIn ajouté le 20/11).
const NETWORKS = [
  { key: 'tiktok', name: 'TikTok' },
  { key: 'linkedin', name: 'LinkedIn' },
];

export default function SocialLinks({ locale = 'fr' }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'bad', key }

  async function load() {
    try {
      const res = await fetch('/api/social/connections');
      const data = res.ok ? await res.json() : null;
      setConnections(Array.isArray(data?.connections) ? data.connections : []);
    } catch (err) {
      setConnections([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    try {
      const params = new URLSearchParams(window.location.search);
      const net = NETWORKS.find((n) => n.key === params.get('social'));
      if (net) {
        const etat = params.get('etat');
        if (etat === 'ok') setNotice({ tone: 'ok', key: 'ok', name: net.name });
        else if (etat === 'refus') setNotice({ tone: 'bad', key: 'refus', name: net.name });
        else setNotice({ tone: 'bad', key: 'erreur', name: net.name });
        params.delete('social');
        params.delete('etat');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      }
    } catch (err) {}
  }, []);

  async function link(net) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/social/${net.key}/start`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      setNotice({ tone: 'bad', key: res.status === 503 ? 'soon' : 'erreur', name: net.name });
    } catch (err) {
      setNotice({ tone: 'bad', key: 'erreur', name: net.name });
    }
    setBusy(false);
  }

  async function unlink(net) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/social/connections?provider=${net.key}`, { method: 'DELETE' });
      if (!res.ok) setNotice({ tone: 'bad', key: 'erreur', name: net.name });
    } catch (err) {
      setNotice({ tone: 'bad', key: 'erreur', name: net.name });
    }
    await load();
    setBusy(false);
  }

  return (
    <div className="social">
      <strong className="social-title">{tx(locale, 'title')}</strong>
      {NETWORKS.map((net) => {
        const conn = connections.find((c) => c.provider === net.key) || null;
        return (
          <div className="social-row" key={net.key}>
            <span className="social-name">{net.name}</span>
            {loading ? (
              <span className="social-state">…</span>
            ) : conn ? (
              <>
                <span className="social-state on">{tx(locale, 'linked')}{conn.account_name ? ` · ${conn.account_name}` : ''}</span>
                <button type="button" className="social-ghost" onClick={() => unlink(net)} disabled={busy}>{tx(locale, 'unlink')}</button>
              </>
            ) : (
              <button type="button" className="social-primary" onClick={() => link(net)} disabled={busy}>{tx(locale, 'link')}</button>
            )}
          </div>
        );
      })}
      {notice && <p className={`social-notice ${notice.tone}`}>{tx(locale, notice.key).replace('{name}', notice.name || '')}</p>}
      <style jsx>{`
        .social { margin-top: 1.4rem; padding-top: 1.1rem; border-top: 1px solid var(--border); }
        .social-title { display: block; font-size: 0.92rem; margin-bottom: 0.6rem; }
        .social-row { display: flex; align-items: center; gap: 0.7rem; min-height: 44px; flex-wrap: wrap; }
        .social-name { font-size: 0.92rem; font-weight: 600; margin-right: auto; }
        .social-state { font-size: 0.84rem; color: var(--muted); }
        .social-state.on { color: var(--state-good-text, #1f9d55); }
        .social-primary { background: var(--accent); color: #fff; border: 0; border-radius: var(--radius-sm, 8px); padding: 0.55rem 1rem; min-height: 44px; font-size: 0.86rem; cursor: pointer; }
        .social-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); padding: 0.55rem 1rem; min-height: 44px; font-size: 0.86rem; cursor: pointer; }
        .social-primary:disabled, .social-ghost:disabled { opacity: 0.5; cursor: default; }
        .social-notice { font-size: 0.82rem; margin: 0.6rem 0 0; }
        .social-notice.ok { color: var(--state-good-text, #1f9d55); }
        .social-notice.bad { color: var(--state-bad-text, #d03c3c); }
      `}</style>
    </div>
  );
}
