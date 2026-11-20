// components/SocialCampaignPanel.jsx
//
// AARON SOCIAL — onglet « Réseaux sociaux » de la page Campagnes
// (20/11/2026). Visible sur aaron@meetaaron.app seulement
// (lib/social-access.js), comme toute la partie réseaux sociaux.
//
// Ce que l'écran fait aujourd'hui : préparer les 16 posts du mois (4 par
// semaine, 4 familles), les montrer semaine par semaine et réseau par réseau,
// et dire ce qu'il manque (photo, avis). Rien n'est publié : la publication
// viendra avec les liaisons Meta, TikTok et LinkedIn validées.
//
// La préparation lance les 4 familles en parallèle, une requête chacune
// (/api/social/campaigns/[id]/category) : chaque appel tient dans la limite
// de 60 secondes, et une famille qui échoue se relance seule.

'use client';

import { useEffect, useRef, useState } from 'react';

const CATEGORIES = ['realisation', 'avis', 'conseil', 'coulisses'];
const NETWORKS = ['instagram', 'facebook', 'linkedin', 'tiktok'];

const TEXT = {
  fr: {
    title: 'Tes 16 posts du mois', intro: '4 semaines, 4 posts par semaine, sur chaque réseau.', prepare: 'Préparer mes 16 posts', preparing: 'Aaron prépare tes posts…', progress: '{n} familles sur 4', resumePrep: 'Continuer la préparation', redo: 'Tout refaire', redoConfirm: 'Refaire les 16 posts ? Les posts actuels seront remplacés.', ready: '{n} posts prêts sur {t}', week: 'Semaine {n}', preview: 'Aperçu : rien n’est publié pour l’instant.', error: 'La préparation n’a pas abouti. Réessaie.', migration: 'Mise à jour en attente : réessaie dans quelques minutes.', budget: 'Plafond d’utilisation atteint pour aujourd’hui.',
    cat: { realisation: 'Réalisation', avis: 'Client satisfait', conseil: 'Conseil de pro', coulisses: 'Offre ou coulisses' },
    state: { pret: 'Prêt', photo: 'Photo à fournir', avis: 'Avis à fournir' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrousel de 5 pages', facebook: 'Photo et texte', linkedin: 'Document de 5 pages', tiktok: 'Vidéo de 15 secondes, avec tes photos' },
    slide: 'Page', scene: 'Scène', caption: 'Légende', missing: 'À fournir',
  },
  en: {
    title: 'Your 16 posts this month', intro: '4 weeks, 4 posts a week, on every network.', prepare: 'Prepare my 16 posts', preparing: 'Aaron is preparing your posts…', progress: '{n} of 4 families', resumePrep: 'Continue preparing', redo: 'Start again', redoConfirm: 'Redo all 16 posts? The current posts will be replaced.', ready: '{n} of {t} posts ready', week: 'Week {n}', preview: 'Preview: nothing is published yet.', error: 'Preparation did not finish. Try again.', migration: 'Update pending: try again in a few minutes.', budget: 'Usage limit reached for today.',
    cat: { realisation: 'Our work', avis: 'Happy client', conseil: 'Pro tip', coulisses: 'Offer or behind the scenes' },
    state: { pret: 'Ready', photo: 'Photo needed', avis: 'Review needed' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: '5-page carousel', facebook: 'Photo and text', linkedin: '5-page document', tiktok: '15-second video, with your photos' },
    slide: 'Page', scene: 'Scene', caption: 'Caption', missing: 'Needed',
  },
  de: {
    title: 'Deine 16 Posts des Monats', intro: '4 Wochen, 4 Posts pro Woche, in jedem Netzwerk.', prepare: 'Meine 16 Posts vorbereiten', preparing: 'Aaron bereitet deine Posts vor…', progress: '{n} von 4 Themen', resumePrep: 'Vorbereitung fortsetzen', redo: 'Neu beginnen', redoConfirm: 'Alle 16 Posts neu erstellen? Die aktuellen Posts werden ersetzt.', ready: '{n} von {t} Posts bereit', week: 'Woche {n}', preview: 'Vorschau: Noch wird nichts veröffentlicht.', error: 'Die Vorbereitung wurde nicht abgeschlossen. Bitte erneut versuchen.', migration: 'Aktualisierung ausstehend: in ein paar Minuten erneut versuchen.', budget: 'Tageslimit erreicht.',
    cat: { realisation: 'Projekt', avis: 'Zufriedener Kunde', conseil: 'Profi-Tipp', coulisses: 'Angebot oder Einblick' },
    state: { pret: 'Bereit', photo: 'Foto fehlt', avis: 'Bewertung fehlt' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Karussell mit 5 Seiten', facebook: 'Foto und Text', linkedin: 'Dokument mit 5 Seiten', tiktok: '15-Sekunden-Video mit deinen Fotos' },
    slide: 'Seite', scene: 'Szene', caption: 'Beschreibung', missing: 'Fehlt',
  },
  it: {
    title: 'I tuoi 16 post del mese', intro: '4 settimane, 4 post a settimana, su ogni social.', prepare: 'Prepara i miei 16 post', preparing: 'Aaron sta preparando i tuoi post…', progress: '{n} famiglie su 4', resumePrep: 'Continua la preparazione', redo: 'Ricomincia', redoConfirm: 'Rifare tutti i 16 post? I post attuali saranno sostituiti.', ready: '{n} post pronti su {t}', week: 'Settimana {n}', preview: 'Anteprima: per ora non viene pubblicato nulla.', error: 'La preparazione non è andata a buon fine. Riprova.', migration: 'Aggiornamento in corso: riprova tra qualche minuto.', budget: 'Limite di utilizzo raggiunto per oggi.',
    cat: { realisation: 'Realizzazione', avis: 'Cliente soddisfatto', conseil: 'Consiglio da esperto', coulisses: 'Offerta o dietro le quinte' },
    state: { pret: 'Pronto', photo: 'Foto da fornire', avis: 'Recensione da fornire' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carosello di 5 pagine', facebook: 'Foto e testo', linkedin: 'Documento di 5 pagine', tiktok: 'Video di 15 secondi con le tue foto' },
    slide: 'Pagina', scene: 'Scena', caption: 'Didascalia', missing: 'Da fornire',
  },
  es: {
    title: 'Tus 16 publicaciones del mes', intro: '4 semanas, 4 publicaciones por semana, en cada red.', prepare: 'Preparar mis 16 publicaciones', preparing: 'Aaron está preparando tus publicaciones…', progress: '{n} familias de 4', resumePrep: 'Continuar la preparación', redo: 'Empezar de nuevo', redoConfirm: '¿Rehacer las 16 publicaciones? Las actuales se sustituirán.', ready: '{n} de {t} publicaciones listas', week: 'Semana {n}', preview: 'Vista previa: de momento no se publica nada.', error: 'La preparación no ha terminado. Inténtalo de nuevo.', migration: 'Actualización pendiente: inténtalo en unos minutos.', budget: 'Límite de uso alcanzado por hoy.',
    cat: { realisation: 'Trabajo realizado', avis: 'Cliente satisfecho', conseil: 'Consejo profesional', coulisses: 'Oferta o entre bastidores' },
    state: { pret: 'Lista', photo: 'Falta una foto', avis: 'Falta una reseña' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrusel de 5 páginas', facebook: 'Foto y texto', linkedin: 'Documento de 5 páginas', tiktok: 'Vídeo de 15 segundos con tus fotos' },
    slide: 'Página', scene: 'Escena', caption: 'Texto', missing: 'Falta',
  },
  pt: {
    title: 'As tuas 16 publicações do mês', intro: '4 semanas, 4 publicações por semana, em cada rede.', prepare: 'Preparar as minhas 16 publicações', preparing: 'O Aaron está a preparar as tuas publicações…', progress: '{n} famílias de 4', resumePrep: 'Continuar a preparação', redo: 'Recomeçar', redoConfirm: 'Refazer as 16 publicações? As atuais serão substituídas.', ready: '{n} de {t} publicações prontas', week: 'Semana {n}', preview: 'Pré-visualização: por agora nada é publicado.', error: 'A preparação não terminou. Tenta de novo.', migration: 'Atualização pendente: tenta de novo daqui a uns minutos.', budget: 'Limite de utilização atingido por hoje.',
    cat: { realisation: 'Trabalho feito', avis: 'Cliente satisfeito', conseil: 'Dica profissional', coulisses: 'Oferta ou bastidores' },
    state: { pret: 'Pronta', photo: 'Falta uma foto', avis: 'Falta uma avaliação' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrossel de 5 páginas', facebook: 'Foto e texto', linkedin: 'Documento de 5 páginas', tiktok: 'Vídeo de 15 segundos com as tuas fotos' },
    slide: 'Página', scene: 'Cena', caption: 'Legenda', missing: 'Falta',
  },
  nl: {
    title: 'Je 16 posts van de maand', intro: '4 weken, 4 posts per week, op elk netwerk.', prepare: 'Mijn 16 posts voorbereiden', preparing: 'Aaron bereidt je posts voor…', progress: '{n} van 4 soorten', resumePrep: 'Voorbereiding hervatten', redo: 'Opnieuw beginnen', redoConfirm: 'Alle 16 posts opnieuw maken? De huidige posts worden vervangen.', ready: '{n} van {t} posts klaar', week: 'Week {n}', preview: 'Voorbeeld: er wordt nog niets gepubliceerd.', error: 'De voorbereiding is niet afgerond. Probeer het opnieuw.', migration: 'Update bezig: probeer het over een paar minuten opnieuw.', budget: 'Gebruikslimiet voor vandaag bereikt.',
    cat: { realisation: 'Project', avis: 'Tevreden klant', conseil: 'Tip van de vakman', coulisses: 'Aanbod of achter de schermen' },
    state: { pret: 'Klaar', photo: 'Foto nodig', avis: 'Review nodig' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrousel van 5 pagina’s', facebook: 'Foto en tekst', linkedin: 'Document van 5 pagina’s', tiktok: 'Video van 15 seconden met je foto’s' },
    slide: 'Pagina', scene: 'Scène', caption: 'Bijschrift', missing: 'Nodig',
  },
};
const tx = (locale) => TEXT[locale] || TEXT.fr;

function postState(post) {
  if (post.material_needed === 'photo') return 'photo';
  if (post.material_needed === 'avis') return 'avis';
  return 'pret';
}

function NetworkContent({ post, network, text }) {
  const c = post.content || {};
  if (network === 'instagram' || network === 'linkedin') {
    const block = c[network] || {};
    return (
      <div className="sp-net">
        <ol className="sp-slides">
          {(block.slides || []).map((s, i) => (
            <li key={i}><span className="sp-slide-n">{text.slide} {i + 1}</span>{s}</li>
          ))}
        </ol>
        <p className="sp-body">{network === 'instagram' ? block.caption : block.text}</p>
      </div>
    );
  }
  if (network === 'tiktok') {
    const block = c.tiktok || {};
    return (
      <div className="sp-net">
        <ol className="sp-slides">
          {(block.scenes || []).map((s, i) => (
            <li key={i}><span className="sp-slide-n">{text.scene} {i + 1}</span>{s}</li>
          ))}
        </ol>
        <p className="sp-body">{block.caption}</p>
      </div>
    );
  }
  return (
    <div className="sp-net">
      <p className="sp-body">{c.facebook?.text}</p>
    </div>
  );
}

export default function SocialCampaignPanel({ locale = 'fr' }) {
  const text = tx(locale);
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState(null);
  const [posts, setPosts] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [network, setNetwork] = useState('instagram');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function load() {
    try {
      const res = await fetch('/api/social/campaigns');
      const data = res.ok ? await res.json() : null;
      if (!alive.current) return null;
      if (data?.migration_missing) setError(text.migration);
      setCampaign(data?.campaign || null);
      setPosts(Array.isArray(data?.posts) ? data.posts : []);
      setLoading(false);
      return data;
    } catch {
      if (alive.current) setLoading(false);
      return null;
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runFamilies(campaignId, families) {
    setRunning(true);
    setError(null);
    const outcomes = await Promise.all(
      families.map(async (category) => {
        try {
          const res = await fetch(`/api/social/campaigns/${campaignId}/category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category }),
          });
          const ok = res.ok;
          await load();
          return ok ? 'ok' : res.status === 429 ? 'budget' : 'fail';
        } catch {
          return 'fail';
        }
      })
    );
    if (!alive.current) return;
    setRunning(false);
    if (outcomes.includes('budget')) setError(text.budget);
    else if (outcomes.includes('fail')) setError(text.error);
  }

  async function start() {
    setError(null);
    const res = await fetch('/api/social/campaigns', { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.campaign_id) {
      setError(res.status === 409 ? text.migration : text.error);
      return;
    }
    const fresh = await load();
    const done = new Set((fresh?.posts || []).map((p) => p.category));
    await runFamilies(data.campaign_id, CATEGORIES.filter((c) => !done.has(c)));
  }

  function redo() {
    if (!window.confirm(text.redoConfirm)) return;
    setCampaign(null);
    setPosts([]);
    start();
  }

  const doneFamilies = new Set(posts.map((p) => p.category));
  const missingFamilies = CATEGORIES.filter((c) => !doneFamilies.has(c));
  const readyCount = posts.filter((p) => postState(p) === 'pret').length;
  const preparing = running || (campaign && campaign.status === 'preparation' && missingFamilies.length > 0);

  if (loading) return <p className="sp-muted">…</p>;

  return (
    <section className="sp">
      <div className="sp-head">
        <div>
          <h2 className="sp-title">{text.title}</h2>
          <p className="sp-muted">{text.intro}</p>
        </div>
        {campaign && !running && posts.length > 0 && (
          <button type="button" className="sp-ghost" onClick={redo}>{text.redo}</button>
        )}
      </div>

      {error && <p className="sp-error">{error}</p>}

      {!campaign && (
        <button type="button" className="sp-primary" onClick={start} disabled={running}>{text.prepare}</button>
      )}

      {campaign && preparing && (
        <div className="sp-progress">
          <p>{running ? text.preparing : null} {text.progress.replace('{n}', String(doneFamilies.size))}</p>
          <div className="sp-bar"><span style={{ width: `${(doneFamilies.size / 4) * 100}%` }} /></div>
          {!running && missingFamilies.length > 0 && (
            <button type="button" className="sp-primary" onClick={() => runFamilies(campaign.id, missingFamilies)}>{text.resumePrep}</button>
          )}
        </div>
      )}

      {posts.length > 0 && (
        <>
          <p className="sp-ready">{text.ready.replace('{n}', String(readyCount)).replace('{t}', String(posts.length))}</p>
          <p className="sp-muted">{text.preview}</p>
          {[1, 2, 3, 4].map((week) => {
            const weekPosts = posts.filter((p) => p.week === week).sort((a, b) => a.slot - b.slot);
            if (weekPosts.length === 0) return null;
            return (
              <div className="sp-week" key={week}>
                <h3 className="sp-week-title">{text.week.replace('{n}', String(week))}</h3>
                {weekPosts.map((post) => {
                  const state = postState(post);
                  const open = openId === post.id;
                  return (
                    <div className={`sp-post${open ? ' open' : ''}`} key={post.id}>
                      <button type="button" className="sp-post-head" aria-expanded={open} onClick={() => setOpenId(open ? null : post.id)}>
                        <span className="sp-post-cat">{text.cat[post.category] || post.category}</span>
                        <span className="sp-post-subject">{post.subject}</span>
                        <span className={`sp-state st-${state}`}>{text.state[state]}</span>
                      </button>
                      {open && (
                        <div className="sp-post-body">
                          {post.material_hint && (
                            <p className="sp-missing"><strong>{text.missing} :</strong> {post.material_hint}</p>
                          )}
                          <div className="sp-tabs" role="tablist">
                            {NETWORKS.map((n) => (
                              <button key={n} type="button" role="tab" aria-selected={network === n} className={`sp-tab${network === n ? ' on' : ''}`} onClick={() => setNetwork(n)}>
                                {text.net[n]}
                              </button>
                            ))}
                          </div>
                          <p className="sp-form">{text.form[network]}</p>
                          <NetworkContent post={post} network={network} text={text} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      <style jsx>{`
        .sp { display: grid; gap: 0.9rem; max-width: 760px; }
        .sp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; }
        .sp-title { margin: 0 0 0.2rem; font-size: 1.12rem; }
        .sp-muted { margin: 0; color: var(--muted); font-size: 0.86rem; }
        .sp-error { margin: 0; color: var(--state-bad-text, #d03c3c); font-size: 0.86rem; }
        .sp-ready { margin: 0; font-weight: 600; color: var(--state-good-text, #1f9d55); }
        .sp-primary { justify-self: start; min-height: 44px; padding: 0 1.1rem; border: 0; border-radius: var(--radius-md, 12px); background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
        .sp-primary:disabled { opacity: 0.6; cursor: default; }
        .sp-ghost { flex: none; min-height: 40px; padding: 0 0.9rem; border: 1px solid var(--border); border-radius: var(--radius-md, 12px); background: transparent; color: var(--muted); font: inherit; font-size: 0.86rem; cursor: pointer; }
        .sp-progress { display: grid; gap: 0.6rem; padding: 0.9rem; border-radius: var(--radius-md, 12px); border: 1px solid var(--border); }
        .sp-progress p { margin: 0; font-size: 0.9rem; }
        .sp-bar { height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; }
        .sp-bar span { display: block; height: 100%; background: var(--accent); transition: width 0.4s ease; }
        .sp-week { display: grid; gap: 0.5rem; }
        .sp-week-title { margin: 0.4rem 0 0; font-size: 0.9rem; color: var(--muted); font-weight: 600; }
        .sp-post { border: 1px solid var(--border); border-radius: var(--radius-md, 12px); background: var(--bg-elevated, transparent); overflow: hidden; }
        .sp-post.open { border-color: var(--accent); }
        .sp-post-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; width: 100%; min-height: 52px; padding: 0.6rem 0.8rem; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
        .sp-post-cat { font-size: 0.74rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
        .sp-post-subject { font-size: 0.9rem; font-weight: 600; overflow-wrap: anywhere; }
        .sp-state { font-size: 0.74rem; font-weight: 600; padding: 0.15rem 0.55rem; border-radius: 999px; white-space: nowrap; border: 1px solid currentColor; }
        .st-pret { color: var(--state-good-text, #1f9d55); }
        .st-photo, .st-avis { color: var(--state-warn-text, #b7791f); }
        .sp-post-body { display: grid; gap: 0.6rem; padding: 0 0.8rem 0.9rem; }
        .sp-missing { margin: 0; font-size: 0.84rem; color: var(--state-warn-text, #b7791f); }
        .sp-tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .sp-tab { min-height: 36px; padding: 0 0.75rem; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--muted); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
        .sp-tab.on { border-color: var(--accent); color: var(--text); background: rgba(124, 110, 245, 0.12); }
        .sp-form { margin: 0; font-size: 0.78rem; color: var(--muted); }
        .sp-net { display: grid; gap: 0.6rem; }
        .sp-slides { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; }
        .sp-slides li { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: 0.5rem; font-size: 0.88rem; }
        .sp-slide-n { color: var(--muted); font-size: 0.76rem; padding-top: 0.1rem; }
        .sp-body { margin: 0; font-size: 0.88rem; white-space: pre-wrap; }
      `}</style>
    </section>
  );
}
