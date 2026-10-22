'use client';

// components/HelpLayer.jsx
//
// Lot 3 de la refonte de l'onboarding (plaquette validée par Alex, 21-22/10) :
//   - un bouton « ? » présent sur toutes les pages de l'app (sauf le parcours
//     de première connexion et la visite elle-même) : revoir la visite
//     guidée, ou réafficher l'aide de la page en cours ;
//   - des bulles d'aide au PREMIER passage sur Prospects, Campagnes, Agenda et
//     Résultats : une phrase, un bouton « Compris », mémorisé par page EN BASE
//     (users.help_tips_seen, voir migration_aide_2026-10-22.sql) pour ne pas
//     les revoir sur un autre appareil ni après une déconnexion.
// La visite guidée ne se déclenche plus jamais toute seule : elle est ici.
//
// Monté une seule fois dans app/layout.jsx (comme WinCelebration) plutôt que
// dans chacune des 14 barres latérales : aucune page n'a été modifiée.

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/lib/i18n';
import { HelpCircle, X, Compass, Lightbulb } from 'lucide-react';

const TEXT = {
  fr: { help: 'Aide', tour: 'Revoir la visite guidée', pageTip: 'Aide de cette page', gotIt: 'Compris',
    prospects: 'Tous tes contacts sont ici, de la prise de contact au client. Clique sur un contact pour voir ce qu’Aaron sait de lui et ce qu’il prépare.',
    campaigns: 'Une campagne, c’est une zone et un type d’entreprise : Aaron trouve les prospects, écrit et relance. Tu peux en lancer une nouvelle à tout moment.',
    agenda: 'Les rendez-vous obtenus par Aaron arrivent ici. Ceux marqués « à valider » attendent ton accord avant d’être confirmés au prospect.',
    resultats: 'Ce que tes campagnes rapportent : contacts, réponses, rendez-vous, clients. Aaron t’envoie aussi ce résumé chaque soir.' },
  en: { help: 'Help', tour: 'Replay the guided tour', pageTip: 'Help for this page', gotIt: 'Got it',
    prospects: 'All your contacts live here, from first contact to client. Click a contact to see what Aaron knows and what he is preparing.',
    campaigns: 'A campaign is an area and a type of company: Aaron finds the prospects, writes and follows up. You can launch a new one any time.',
    agenda: 'Meetings booked by Aaron land here. Those marked “to approve” wait for your OK before being confirmed to the prospect.',
    resultats: 'What your campaigns bring in: contacts, replies, meetings, clients. Aaron also sends you this summary every evening.' },
  de: { help: 'Hilfe', tour: 'Rundgang erneut ansehen', pageTip: 'Hilfe zu dieser Seite', gotIt: 'Verstanden',
    prospects: 'Hier sind alle Ihre Kontakte, vom ersten Kontakt bis zum Kunden. Klicken Sie auf einen Kontakt, um zu sehen, was Aaron weiß und vorbereitet.',
    campaigns: 'Eine Kampagne ist ein Gebiet und eine Unternehmensart: Aaron findet die Interessenten, schreibt und fasst nach. Sie können jederzeit eine neue starten.',
    agenda: 'Von Aaron vereinbarte Termine landen hier. Termine „zur Freigabe“ warten auf Ihr OK, bevor sie dem Interessenten bestätigt werden.',
    resultats: 'Was Ihre Kampagnen bringen: Kontakte, Antworten, Termine, Kunden. Aaron schickt Ihnen diese Übersicht auch jeden Abend.' },
  it: { help: 'Aiuto', tour: 'Rivedi la visita guidata', pageTip: 'Aiuto per questa pagina', gotIt: 'Ho capito',
    prospects: 'Qui ci sono tutti i tuoi contatti, dal primo contatto al cliente. Clicca su un contatto per vedere cosa sa Aaron e cosa sta preparando.',
    campaigns: 'Una campagna è una zona e un tipo di azienda: Aaron trova i prospect, scrive e sollecita. Puoi avviarne una nuova quando vuoi.',
    agenda: 'Gli appuntamenti ottenuti da Aaron arrivano qui. Quelli «da approvare» aspettano il tuo ok prima di essere confermati al prospect.',
    resultats: 'Cosa portano le tue campagne: contatti, risposte, appuntamenti, clienti. Aaron ti invia anche questo riepilogo ogni sera.' },
  es: { help: 'Ayuda', tour: 'Volver a ver la visita guiada', pageTip: 'Ayuda de esta página', gotIt: 'Entendido',
    prospects: 'Aquí están todos tus contactos, del primer contacto al cliente. Haz clic en uno para ver lo que Aaron sabe y lo que prepara.',
    campaigns: 'Una campaña es una zona y un tipo de empresa: Aaron encuentra los prospectos, escribe y hace seguimiento. Puedes lanzar otra cuando quieras.',
    agenda: 'Las reuniones conseguidas por Aaron llegan aquí. Las marcadas «por validar» esperan tu visto bueno antes de confirmarse al prospecto.',
    resultats: 'Lo que aportan tus campañas: contactos, respuestas, reuniones, clientes. Aaron también te envía este resumen cada noche.' },
  pt: { help: 'Ajuda', tour: 'Rever a visita guiada', pageTip: 'Ajuda desta página', gotIt: 'Percebi',
    prospects: 'Todos os teus contactos estão aqui, do primeiro contacto ao cliente. Clica num contacto para ver o que o Aaron sabe e o que está a preparar.',
    campaigns: 'Uma campanha é uma zona e um tipo de empresa: o Aaron encontra os prospects, escreve e faz seguimento. Podes lançar uma nova quando quiseres.',
    agenda: 'As reuniões obtidas pelo Aaron chegam aqui. As marcadas «a validar» esperam o teu ok antes de serem confirmadas ao prospect.',
    resultats: 'O que as tuas campanhas trazem: contactos, respostas, reuniões, clientes. O Aaron também te envia este resumo todas as noites.' },
  nl: { help: 'Hulp', tour: 'Rondleiding opnieuw bekijken', pageTip: 'Hulp bij deze pagina', gotIt: 'Begrepen',
    prospects: 'Al je contacten staan hier, van eerste contact tot klant. Klik op een contact om te zien wat Aaron weet en voorbereidt.',
    campaigns: 'Een campagne is een gebied en een type bedrijf: Aaron vindt de prospects, schrijft en volgt op. Je kunt altijd een nieuwe starten.',
    agenda: 'Afspraken die Aaron regelt komen hier. Die met „goed te keuren” wachten op jouw akkoord voordat ze aan de prospect worden bevestigd.',
    resultats: 'Wat je campagnes opleveren: contacten, antwoorden, afspraken, klanten. Aaron stuurt je dit overzicht ook elke avond.' },
};
const tx = (key, locale) => (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key];

const TIP_PAGES = ['prospects', 'campaigns', 'agenda', 'resultats'];
// Le chat a sa barre de saisie en bas de l'écran : pas de bouton flottant
// par-dessus le bouton d'envoi.
const HIDDEN_ON = ['bienvenue', 'tour', 'chat'];

function pageSlug(pathname) {
  const m = (pathname || '').match(/^\/app\/([^/?#]+)/);
  return m ? m[1] : null;
}

export default function HelpLayer() {
  const pathname = usePathname();
  const [locale] = useLocale();
  const [seen, setSeen] = useState(null); // null = pas encore chargé
  const [menuOpen, setMenuOpen] = useState(false);
  const [forcedTip, setForcedTip] = useState(null);
  const ref = useRef(null);
  const slug = pageSlug(pathname);
  const inApp = !!slug && !HIDDEN_ON.includes(slug);

  useEffect(() => {
    if (!inApp || seen !== null) return;
    fetch('/api/help-tips')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setSeen(Array.isArray(b?.seen) ? b.seen : TIP_PAGES))
      .catch(() => setSeen(TIP_PAGES)); // en cas d'erreur, on ne harcèle personne
  }, [inApp, seen]);

  useEffect(() => {
    setMenuOpen(false);
    setForcedTip(null);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (!inApp) return null;

  const hasTip = TIP_PAGES.includes(slug);
  const showTip = hasTip && (forcedTip === slug || (seen !== null && !seen.includes(slug)));

  function dismiss() {
    setForcedTip(null);
    if (seen && !seen.includes(slug)) {
      setSeen([...seen, slug]);
      fetch('/api/help-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tip: slug }),
      }).catch(() => {});
    }
  }

  function userQuery() {
    if (typeof window === 'undefined') return '';
    const id = new URLSearchParams(window.location.search).get('user_id');
    return id ? `?user_id=${encodeURIComponent(id)}` : '';
  }

  return (
    <div className="help-layer" ref={ref}>
      {showTip && (
        <div className="help-tip" role="status">
          <span className="help-tip-ic" aria-hidden="true"><Lightbulb size={16} strokeWidth={2.1} /></span>
          <p>{tx(slug, locale)}</p>
          <button type="button" className="help-tip-ok" onClick={dismiss}>{tx('gotIt', locale)}</button>
        </div>
      )}
      {menuOpen && (
        <div className="help-menu" role="menu">
          <a role="menuitem" href={`/app/tour${userQuery()}`}><Compass size={15} aria-hidden="true" /> {tx('tour', locale)}</a>
          {hasTip && (
            <button type="button" role="menuitem" onClick={() => { setForcedTip(slug); setMenuOpen(false); }}>
              <Lightbulb size={15} aria-hidden="true" /> {tx('pageTip', locale)}
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="help-btn"
        aria-label={tx('help', locale)}
        title={tx('help', locale)}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? <X size={18} strokeWidth={2.2} aria-hidden="true" /> : <HelpCircle size={20} strokeWidth={2} aria-hidden="true" />}
      </button>

      <style jsx>{`
        .help-layer { position: fixed; right: 18px; bottom: 18px; z-index: 90; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; }
        .help-layer > * { pointer-events: auto; }
        .help-btn { width: 42px; height: 42px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); }
        .help-btn:hover { color: var(--text); border-color: var(--accent); }
        .help-menu { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.35rem; min-width: 230px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3); display: flex; flex-direction: column; }
        .help-menu a, .help-menu button { display: flex; align-items: center; gap: 0.55rem; padding: 0.6rem 0.7rem; border-radius: var(--radius-sm); color: var(--text); text-decoration: none; background: none; border: none; font-size: 0.86rem; cursor: pointer; text-align: left; }
        .help-menu a:hover, .help-menu button:hover { background: var(--bg); }
        .help-tip { max-width: 340px; background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius-md); padding: 0.8rem 0.9rem; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3); display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 0.6rem; }
        .help-tip-ic { color: var(--accent); margin-top: 2px; }
        .help-tip p { margin: 0; font-size: 0.86rem; line-height: 1.45; color: var(--text); }
        .help-tip-ok { grid-column: 2; justify-self: end; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sm); padding: 0.4rem 0.8rem; font-weight: 700; font-size: 0.8rem; cursor: pointer; margin-top: 0.3rem; }
        @media (max-width: 900px) {
          .help-layer { right: 12px; bottom: calc(74px + env(safe-area-inset-bottom, 0px)); }
          .help-btn { width: 38px; height: 38px; }
          .help-tip { max-width: calc(100vw - 24px); }
        }
        @media print { .help-layer { display: none; } }
      `}</style>
    </div>
  );
}
