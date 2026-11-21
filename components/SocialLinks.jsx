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
  fr: { noPage: 'Aucune page Facebook trouvée sur ce compte. Crée la page Meet Aaron, relie-lui ton Instagram professionnel, puis réessaie.', title: 'Réseaux sociaux', intro: 'Aaron publie tes posts et répond aux commentaires depuis ces comptes.', link: 'Lier', linked: 'Lié', unlink: 'Délier', ok: '{name} est lié.', refus: 'Liaison refusée sur {name}.', erreur: "La liaison n'a pas abouti. Réessaie.", soon: 'Bientôt', d_instagram: 'Carrousels, commentaires et messages', d_facebook: 'Posts de ta page, commentaires et messages', d_tiktok: 'Photos en vidéo, avec une musique proposée', d_linkedin: 'Posts et documents, au nom de ton profil' },
  en: { noPage: 'No Facebook Page found on this account. Create your business Page, link your Instagram professional account to it, then try again.', title: 'Social networks', intro: 'Aaron publishes your posts and replies to comments from these accounts.', link: 'Link', linked: 'Linked', unlink: 'Unlink', ok: '{name} is linked.', refus: 'Linking was declined on {name}.', erreur: 'Linking failed. Try again.', soon: 'Soon', d_instagram: 'Carousels, comments and messages', d_facebook: 'Page posts, comments and messages', d_tiktok: 'Photo posts, with a suggested track', d_linkedin: 'Posts and documents, from your profile' },
  de: { noPage: 'Keine Facebook-Seite in diesem Konto gefunden. Erstelle deine Unternehmensseite, verknüpfe dein Instagram-Profikonto damit und versuche es erneut.', title: 'Soziale Netzwerke', intro: 'Aaron veröffentlicht deine Posts und beantwortet Kommentare über diese Konten.', link: 'Verknüpfen', linked: 'Verknüpft', unlink: 'Trennen', ok: '{name} ist verknüpft.', refus: 'Verknüpfung auf {name} abgelehnt.', erreur: 'Verknüpfung fehlgeschlagen. Bitte erneut versuchen.', soon: 'Bald', d_instagram: 'Karussells, Kommentare und Nachrichten', d_facebook: 'Seitenposts, Kommentare und Nachrichten', d_tiktok: 'Fotobeiträge mit vorgeschlagener Musik', d_linkedin: 'Posts und Dokumente über dein Profil' },
  it: { noPage: 'Nessuna pagina Facebook trovata su questo account. Crea la pagina aziendale, collegale il tuo account Instagram professionale e riprova.', title: 'Social network', intro: 'Aaron pubblica i tuoi post e risponde ai commenti da questi account.', link: 'Collega', linked: 'Collegato', unlink: 'Scollega', ok: '{name} è collegato.', refus: 'Collegamento rifiutato su {name}.', erreur: 'Collegamento non riuscito. Riprova.', soon: 'Presto', d_instagram: 'Caroselli, commenti e messaggi', d_facebook: 'Post della pagina, commenti e messaggi', d_tiktok: 'Post di foto, con una musica suggerita', d_linkedin: 'Post e documenti, dal tuo profilo' },
  es: { noPage: 'No se encontró ninguna página de Facebook en esta cuenta. Crea la página de tu empresa, vincula tu cuenta profesional de Instagram y vuelve a intentarlo.', title: 'Redes sociales', intro: 'Aaron publica tus publicaciones y responde a los comentarios desde estas cuentas.', link: 'Vincular', linked: 'Vinculado', unlink: 'Desvincular', ok: '{name} está vinculado.', refus: 'Vinculación rechazada en {name}.', erreur: 'La vinculación ha fallado. Inténtalo de nuevo.', soon: 'Pronto', d_instagram: 'Carruseles, comentarios y mensajes', d_facebook: 'Publicaciones de tu página, comentarios y mensajes', d_tiktok: 'Publicaciones de fotos, con una música sugerida', d_linkedin: 'Publicaciones y documentos, desde tu perfil' },
  pt: { noPage: 'Nenhuma página do Facebook encontrada nesta conta. Cria a página da tua empresa, liga-lhe a tua conta profissional do Instagram e tenta de novo.', title: 'Redes sociais', intro: 'O Aaron publica as tuas publicações e responde aos comentários a partir destas contas.', link: 'Ligar', linked: 'Ligado', unlink: 'Desligar', ok: 'O {name} está ligado.', refus: 'Ligação recusada no {name}.', erreur: 'A ligação falhou. Tenta de novo.', soon: 'Em breve', d_instagram: 'Carrosséis, comentários e mensagens', d_facebook: 'Publicações da página, comentários e mensagens', d_tiktok: 'Publicações de fotos, com uma música sugerida', d_linkedin: 'Publicações e documentos, a partir do teu perfil' },
  nl: { noPage: 'Geen Facebookpagina gevonden in dit account. Maak je bedrijfspagina aan, koppel je zakelijke Instagram-account eraan en probeer het opnieuw.', title: 'Sociale netwerken', intro: 'Aaron publiceert je posts en beantwoordt reacties vanaf deze accounts.', link: 'Koppelen', linked: 'Gekoppeld', unlink: 'Ontkoppelen', ok: '{name} is gekoppeld.', refus: 'Koppeling geweigerd op {name}.', erreur: 'Koppelen is mislukt. Probeer het opnieuw.', soon: 'Binnenkort', d_instagram: "Carrousels, reacties en berichten", d_facebook: "Paginaposts, reacties en berichten", d_tiktok: "Fotoposts, met voorgestelde muziek", d_linkedin: "Posts en documenten, vanaf je profiel" },
};
const tx = (locale, key) => (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key];

// Réseaux reliables, dans l'ordre d'affichage (LinkedIn ajouté le 20/11).
// Ordre demandé par Alex (21/11/2026). Instagram et Facebook passent par la
// même liaison Meta (une page Facebook et son compte Instagram professionnel).
const NETWORKS = [
  { key: 'instagram', name: 'Instagram', start: 'meta' },
  { key: 'facebook', name: 'Facebook', start: 'meta' },
  { key: 'tiktok', name: 'TikTok' },
  { key: 'linkedin', name: 'LinkedIn' },
];

// Icônes en traits, neutres (pas de logos de marque), même famille que la
// liste de Mon compte : appareil photo, page, note de musique, mallette.
const NET_ICONS = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  facebook: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M8 13h5M8 16h8" />
    </>
  ),
  tiktok: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
};

export default function SocialLinks({ locale = 'fr', standalone = false, onChange }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'bad', key }

  async function load() {
    try {
      const res = await fetch('/api/social/connections');
      const data = res.ok ? await res.json() : null;
      const list = Array.isArray(data?.connections) ? data.connections : [];
      setConnections(list);
      if (onChange) onChange(list.length);
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
        else if (etat === 'sans_page') setNotice({ tone: 'bad', key: 'noPage', name: net.name });
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
      const res = await fetch(`/api/social/${net.start || net.key}/start`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      setNotice({ tone: 'bad', key: 'erreur', name: net.name });
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
    <div className={standalone ? 'social standalone' : 'social'}>
      <strong className="social-title">{tx(locale, 'title')}</strong>
      <p className="social-intro">{tx(locale, 'intro')}</p>
      <div className="social-list">
        {NETWORKS.map((net) => {
          const conn = connections.find((c) => c.provider === net.key) || null;
          return (
            <div className={`social-row${net.soon ? ' soon' : ''}`} key={net.key}>
              <span className="social-ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{NET_ICONS[net.key]}</svg>
              </span>
              <span className="social-text">
                <span className="social-name">{net.name}</span>
                <span className="social-desc">{conn?.account_name || tx(locale, `d_${net.key}`)}</span>
              </span>
              <span className="social-end">
                {net.soon ? (
                  <span className="social-pill">{tx(locale, 'soon')}</span>
                ) : loading ? (
                  <span className="social-pill">…</span>
                ) : conn ? (
                  <>
                    <span className="social-pill on">{tx(locale, 'linked')}</span>
                    <button type="button" className="social-ghost" onClick={() => unlink(net)} disabled={busy}>{tx(locale, 'unlink')}</button>
                  </>
                ) : (
                  <button type="button" className="social-link" onClick={() => link(net)} disabled={busy}>{tx(locale, 'link')}</button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {notice && <p className={`social-notice ${notice.tone}`}>{tx(locale, notice.key).replace('{name}', notice.name || '')}</p>}
      <style jsx>{`
        .social { margin-top: 1.4rem; padding-top: 1.1rem; border-top: 1px solid var(--border); }
        .social.standalone { margin-top: 0; padding-top: 0; border-top: 0; }
        .social-title { display: block; font-size: 1rem; font-weight: 600; }
        .social-intro { margin: 0.3rem 0 0.9rem; font-size: 0.84rem; color: var(--muted); line-height: 1.45; }
        .social-list { display: grid; gap: 0.5rem; }
        .social-row { display: flex; align-items: center; gap: 0.8rem; padding: 0.7rem 0.8rem; border-radius: var(--radius-md, 12px); border: 1px solid var(--border); background: var(--bg, transparent); transition: border-color 0.15s ease; }
        .social-row:hover { border-color: rgba(124, 110, 245, 0.45); }
        .social-row.soon { opacity: 0.7; }
        .social-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 10px; color: var(--accent-light, var(--accent)); background: rgba(124, 110, 245, 0.12); border: 1px solid rgba(124, 110, 245, 0.28); }
        .social-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
        .social-name { font-size: 0.92rem; font-weight: 600; }
        .social-desc { font-size: 0.78rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .social-end { flex: none; display: inline-flex; align-items: center; gap: 0.5rem; }
        .social-pill { font-size: 0.74rem; font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 999px; color: var(--muted); border: 1px solid var(--border); white-space: nowrap; }
        .social-pill.on { color: var(--state-good-text, #1f9d55); border-color: rgba(31, 157, 85, 0.45); background: rgba(31, 157, 85, 0.1); }
        .social-link { min-height: 36px; padding: 0 0.95rem; border-radius: 999px; border: 1px solid var(--accent); background: rgba(124, 110, 245, 0.12); color: var(--text); font: inherit; font-size: 0.84rem; font-weight: 600; cursor: pointer; }
        .social-link:hover { background: var(--accent); color: #fff; }
        .social-ghost { min-height: 36px; padding: 0 0.8rem; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--muted); font: inherit; font-size: 0.8rem; cursor: pointer; }
        .social-link:disabled, .social-ghost:disabled { opacity: 0.5; cursor: default; }
        .social-notice { font-size: 0.82rem; margin: 0.7rem 0 0; }
        .social-notice.ok { color: var(--state-good-text, #1f9d55); }
        .social-notice.bad { color: var(--state-bad-text, #d03c3c); }
      `}</style>
    </div>
  );
}
