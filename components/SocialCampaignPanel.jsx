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
    todo: 'À fournir', todoLeft: 'Encore {n} à fournir : une photo ou un avis par carte.', allDone: 'Tout est fourni. Tes 16 posts sont prêts.', addPhoto: 'Ajouter une photo', addAnother: 'Ajouter une photo', photos: 'Photos', reviewLabel: 'Avis du client', reviewPh: 'Colle ici l’avis, tel que le client l’a écrit.', save: 'Enregistrer', saved: 'Enregistré', edit: 'Modifier le texte', cancel: 'Annuler', remove: 'Retirer', onePerLine: 'Une page par ligne', oneScenePerLine: 'Une scène par ligne', uploading: 'Envoi…', uploadError: 'La photo n’a pas pu être envoyée. Réessaie.', saveError: 'L’enregistrement n’a pas abouti. Réessaie.', mediaMigration: 'Photos et avis : mise à jour en attente.',
    title: 'Tes 16 posts du mois', intro: '4 semaines, 4 posts par semaine, sur chaque réseau.', prepare: 'Préparer mes 16 posts', preparing: 'Aaron prépare tes posts…', progress: '{n} familles sur 4', resumePrep: 'Continuer la préparation', redo: 'Tout refaire', redoConfirm: 'Refaire les 16 posts ? Les posts actuels seront remplacés.', ready: '{n} posts prêts sur {t}', week: 'Semaine {n}', preview: 'Aperçu : rien n’est publié pour l’instant.', error: 'La préparation n’a pas abouti. Réessaie.', migration: 'Mise à jour en attente : réessaie dans quelques minutes.', budget: 'Plafond d’utilisation atteint pour aujourd’hui.',
    cat: { realisation: 'Réalisation', avis: 'Client satisfait', conseil: 'Conseil de pro', coulisses: 'Offre ou coulisses' },
    state: { pret: 'Prêt', photo: 'Photo à fournir', avis: 'Avis à fournir' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrousel de 5 pages', facebook: 'Photo et texte', linkedin: 'Document de 5 pages', tiktok: 'Vidéo de 15 secondes, avec tes photos' },
    slide: 'Page', scene: 'Scène', caption: 'Légende', missing: 'À fournir',
  },
  en: {
    todo: 'To provide', todoLeft: '{n} left to provide: one photo or review per card.', allDone: 'Everything is in. Your 16 posts are ready.', addPhoto: 'Add a photo', addAnother: 'Add a photo', photos: 'Photos', reviewLabel: 'Client review', reviewPh: 'Paste the review here, exactly as the client wrote it.', save: 'Save', saved: 'Saved', edit: 'Edit text', cancel: 'Cancel', remove: 'Remove', onePerLine: 'One page per line', oneScenePerLine: 'One scene per line', uploading: 'Uploading…', uploadError: 'The photo could not be uploaded. Try again.', saveError: 'Saving failed. Try again.', mediaMigration: 'Photos and reviews: update pending.',
    title: 'Your 16 posts this month', intro: '4 weeks, 4 posts a week, on every network.', prepare: 'Prepare my 16 posts', preparing: 'Aaron is preparing your posts…', progress: '{n} of 4 families', resumePrep: 'Continue preparing', redo: 'Start again', redoConfirm: 'Redo all 16 posts? The current posts will be replaced.', ready: '{n} of {t} posts ready', week: 'Week {n}', preview: 'Preview: nothing is published yet.', error: 'Preparation did not finish. Try again.', migration: 'Update pending: try again in a few minutes.', budget: 'Usage limit reached for today.',
    cat: { realisation: 'Our work', avis: 'Happy client', conseil: 'Pro tip', coulisses: 'Offer or behind the scenes' },
    state: { pret: 'Ready', photo: 'Photo needed', avis: 'Review needed' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: '5-page carousel', facebook: 'Photo and text', linkedin: '5-page document', tiktok: '15-second video, with your photos' },
    slide: 'Page', scene: 'Scene', caption: 'Caption', missing: 'Needed',
  },
  de: {
    todo: 'Noch zu liefern', todoLeft: 'Noch {n} zu liefern: ein Foto oder eine Bewertung pro Karte.', allDone: 'Alles geliefert. Deine 16 Posts sind bereit.', addPhoto: 'Foto hinzufügen', addAnother: 'Foto hinzufügen', photos: 'Fotos', reviewLabel: 'Kundenbewertung', reviewPh: 'Füge die Bewertung hier ein, so wie der Kunde sie geschrieben hat.', save: 'Speichern', saved: 'Gespeichert', edit: 'Text bearbeiten', cancel: 'Abbrechen', remove: 'Entfernen', onePerLine: 'Eine Seite pro Zeile', oneScenePerLine: 'Eine Szene pro Zeile', uploading: 'Wird hochgeladen…', uploadError: 'Das Foto konnte nicht hochgeladen werden. Bitte erneut versuchen.', saveError: 'Speichern fehlgeschlagen. Bitte erneut versuchen.', mediaMigration: 'Fotos und Bewertungen: Aktualisierung ausstehend.',
    title: 'Deine 16 Posts des Monats', intro: '4 Wochen, 4 Posts pro Woche, in jedem Netzwerk.', prepare: 'Meine 16 Posts vorbereiten', preparing: 'Aaron bereitet deine Posts vor…', progress: '{n} von 4 Themen', resumePrep: 'Vorbereitung fortsetzen', redo: 'Neu beginnen', redoConfirm: 'Alle 16 Posts neu erstellen? Die aktuellen Posts werden ersetzt.', ready: '{n} von {t} Posts bereit', week: 'Woche {n}', preview: 'Vorschau: Noch wird nichts veröffentlicht.', error: 'Die Vorbereitung wurde nicht abgeschlossen. Bitte erneut versuchen.', migration: 'Aktualisierung ausstehend: in ein paar Minuten erneut versuchen.', budget: 'Tageslimit erreicht.',
    cat: { realisation: 'Projekt', avis: 'Zufriedener Kunde', conseil: 'Profi-Tipp', coulisses: 'Angebot oder Einblick' },
    state: { pret: 'Bereit', photo: 'Foto fehlt', avis: 'Bewertung fehlt' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Karussell mit 5 Seiten', facebook: 'Foto und Text', linkedin: 'Dokument mit 5 Seiten', tiktok: '15-Sekunden-Video mit deinen Fotos' },
    slide: 'Seite', scene: 'Szene', caption: 'Beschreibung', missing: 'Fehlt',
  },
  it: {
    todo: 'Da fornire', todoLeft: 'Ancora {n} da fornire: una foto o una recensione per scheda.', allDone: 'Tutto fornito. I tuoi 16 post sono pronti.', addPhoto: 'Aggiungi una foto', addAnother: 'Aggiungi una foto', photos: 'Foto', reviewLabel: 'Recensione del cliente', reviewPh: 'Incolla qui la recensione, così come l’ha scritta il cliente.', save: 'Salva', saved: 'Salvato', edit: 'Modifica il testo', cancel: 'Annulla', remove: 'Rimuovi', onePerLine: 'Una pagina per riga', oneScenePerLine: 'Una scena per riga', uploading: 'Invio…', uploadError: 'Impossibile inviare la foto. Riprova.', saveError: 'Salvataggio non riuscito. Riprova.', mediaMigration: 'Foto e recensioni: aggiornamento in corso.',
    title: 'I tuoi 16 post del mese', intro: '4 settimane, 4 post a settimana, su ogni social.', prepare: 'Prepara i miei 16 post', preparing: 'Aaron sta preparando i tuoi post…', progress: '{n} famiglie su 4', resumePrep: 'Continua la preparazione', redo: 'Ricomincia', redoConfirm: 'Rifare tutti i 16 post? I post attuali saranno sostituiti.', ready: '{n} post pronti su {t}', week: 'Settimana {n}', preview: 'Anteprima: per ora non viene pubblicato nulla.', error: 'La preparazione non è andata a buon fine. Riprova.', migration: 'Aggiornamento in corso: riprova tra qualche minuto.', budget: 'Limite di utilizzo raggiunto per oggi.',
    cat: { realisation: 'Realizzazione', avis: 'Cliente soddisfatto', conseil: 'Consiglio da esperto', coulisses: 'Offerta o dietro le quinte' },
    state: { pret: 'Pronto', photo: 'Foto da fornire', avis: 'Recensione da fornire' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carosello di 5 pagine', facebook: 'Foto e testo', linkedin: 'Documento di 5 pagine', tiktok: 'Video di 15 secondi con le tue foto' },
    slide: 'Pagina', scene: 'Scena', caption: 'Didascalia', missing: 'Da fornire',
  },
  es: {
    todo: 'Por aportar', todoLeft: 'Faltan {n}: una foto o una reseña por tarjeta.', allDone: 'Todo listo. Tus 16 publicaciones están preparadas.', addPhoto: 'Añadir una foto', addAnother: 'Añadir una foto', photos: 'Fotos', reviewLabel: 'Reseña del cliente', reviewPh: 'Pega aquí la reseña, tal como la escribió el cliente.', save: 'Guardar', saved: 'Guardado', edit: 'Editar el texto', cancel: 'Cancelar', remove: 'Quitar', onePerLine: 'Una página por línea', oneScenePerLine: 'Una escena por línea', uploading: 'Enviando…', uploadError: 'No se pudo enviar la foto. Inténtalo de nuevo.', saveError: 'No se pudo guardar. Inténtalo de nuevo.', mediaMigration: 'Fotos y reseñas: actualización pendiente.',
    title: 'Tus 16 publicaciones del mes', intro: '4 semanas, 4 publicaciones por semana, en cada red.', prepare: 'Preparar mis 16 publicaciones', preparing: 'Aaron está preparando tus publicaciones…', progress: '{n} familias de 4', resumePrep: 'Continuar la preparación', redo: 'Empezar de nuevo', redoConfirm: '¿Rehacer las 16 publicaciones? Las actuales se sustituirán.', ready: '{n} de {t} publicaciones listas', week: 'Semana {n}', preview: 'Vista previa: de momento no se publica nada.', error: 'La preparación no ha terminado. Inténtalo de nuevo.', migration: 'Actualización pendiente: inténtalo en unos minutos.', budget: 'Límite de uso alcanzado por hoy.',
    cat: { realisation: 'Trabajo realizado', avis: 'Cliente satisfecho', conseil: 'Consejo profesional', coulisses: 'Oferta o entre bastidores' },
    state: { pret: 'Lista', photo: 'Falta una foto', avis: 'Falta una reseña' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrusel de 5 páginas', facebook: 'Foto y texto', linkedin: 'Documento de 5 páginas', tiktok: 'Vídeo de 15 segundos con tus fotos' },
    slide: 'Página', scene: 'Escena', caption: 'Texto', missing: 'Falta',
  },
  pt: {
    todo: 'Por fornecer', todoLeft: 'Faltam {n}: uma foto ou uma avaliação por cartão.', allDone: 'Está tudo. As tuas 16 publicações estão prontas.', addPhoto: 'Adicionar uma foto', addAnother: 'Adicionar uma foto', photos: 'Fotos', reviewLabel: 'Avaliação do cliente', reviewPh: 'Cola aqui a avaliação, tal como o cliente a escreveu.', save: 'Guardar', saved: 'Guardado', edit: 'Editar o texto', cancel: 'Cancelar', remove: 'Retirar', onePerLine: 'Uma página por linha', oneScenePerLine: 'Uma cena por linha', uploading: 'A enviar…', uploadError: 'Não foi possível enviar a foto. Tenta de novo.', saveError: 'Não foi possível guardar. Tenta de novo.', mediaMigration: 'Fotos e avaliações: atualização pendente.',
    title: 'As tuas 16 publicações do mês', intro: '4 semanas, 4 publicações por semana, em cada rede.', prepare: 'Preparar as minhas 16 publicações', preparing: 'O Aaron está a preparar as tuas publicações…', progress: '{n} famílias de 4', resumePrep: 'Continuar a preparação', redo: 'Recomeçar', redoConfirm: 'Refazer as 16 publicações? As atuais serão substituídas.', ready: '{n} de {t} publicações prontas', week: 'Semana {n}', preview: 'Pré-visualização: por agora nada é publicado.', error: 'A preparação não terminou. Tenta de novo.', migration: 'Atualização pendente: tenta de novo daqui a uns minutos.', budget: 'Limite de utilização atingido por hoje.',
    cat: { realisation: 'Trabalho feito', avis: 'Cliente satisfeito', conseil: 'Dica profissional', coulisses: 'Oferta ou bastidores' },
    state: { pret: 'Pronta', photo: 'Falta uma foto', avis: 'Falta uma avaliação' },
    net: { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' },
    form: { instagram: 'Carrossel de 5 páginas', facebook: 'Foto e texto', linkedin: 'Documento de 5 páginas', tiktok: 'Vídeo de 15 segundos com as tuas fotos' },
    slide: 'Página', scene: 'Cena', caption: 'Legenda', missing: 'Falta',
  },
  nl: {
    todo: 'Nog aan te leveren', todoLeft: 'Nog {n} aan te leveren: een foto of review per kaart.', allDone: 'Alles is binnen. Je 16 posts zijn klaar.', addPhoto: 'Foto toevoegen', addAnother: 'Foto toevoegen', photos: 'Foto’s', reviewLabel: 'Review van de klant', reviewPh: 'Plak hier de review, precies zoals de klant hem schreef.', save: 'Opslaan', saved: 'Opgeslagen', edit: 'Tekst bewerken', cancel: 'Annuleren', remove: 'Verwijderen', onePerLine: 'Eén pagina per regel', oneScenePerLine: 'Eén scène per regel', uploading: 'Uploaden…', uploadError: 'De foto kon niet worden geüpload. Probeer het opnieuw.', saveError: 'Opslaan is mislukt. Probeer het opnieuw.', mediaMigration: 'Foto’s en reviews: update bezig.',
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
  if (post.material_needed === 'photo' && !(Array.isArray(post.media) && post.media.length)) return 'photo';
  if (post.material_needed === 'avis' && !(post.review_text && post.review_text.trim())) return 'avis';
  return 'pret';
}

const mediaSrc = (path) => `/api/social/media/${path}`;

// Photo de téléphone réduite avant l'envoi (21/11/2026) : 6 Mo à l'origine,
// la limite des fonctions est de 4,5 Mo. 2048 px de côté suffisent pour
// tous les réseaux ; JPEG qualité 0,86.
async function shrinkImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

// Bouton photo : sur téléphone, propose l'appareil photo ou la galerie.
function PhotoButton({ label, busyLabel, busy, onFile, big }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className={big ? 'sp-photo-btn big' : 'sp-photo-btn'} disabled={busy} onClick={() => ref.current?.click()}>
        <span aria-hidden="true" className="sp-plus">+</span> {busy ? busyLabel : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

// Texte d'un réseau en mode modification : pages ou scènes une par ligne,
// puis légende ou texte.
function editableOf(post, network) {
  const c = post.content || {};
  if (network === 'instagram') return { lines: (c.instagram?.slides || []).join('\n'), body: c.instagram?.caption || '' };
  if (network === 'linkedin') return { lines: (c.linkedin?.slides || []).join('\n'), body: c.linkedin?.text || '' };
  if (network === 'tiktok') return { lines: (c.tiktok?.scenes || []).join('\n'), body: c.tiktok?.caption || '' };
  return { lines: null, body: c.facebook?.text || '' };
}

function contentFrom(network, draft) {
  const lines = (draft.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (network === 'instagram') return { instagram: { slides: lines, caption: draft.body } };
  if (network === 'linkedin') return { linkedin: { slides: lines, text: draft.body } };
  if (network === 'tiktok') return { tiktok: { scenes: lines, caption: draft.body } };
  return { facebook: { text: draft.body } };
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
  const [mediaReady, setMediaReady] = useState(true);
  const [busyId, setBusyId] = useState(null); // post en cours d'envoi de photo ou d'enregistrement
  const [reviews, setReviews] = useState({}); // brouillons d'avis par post
  const [editing, setEditing] = useState(null); // { postId, network, lines, body }
  const [savedId, setSavedId] = useState(null);
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
      setMediaReady(data?.media_ready !== false);
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

  function replacePost(updated) {
    if (!updated?.id) return;
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  function flashSaved(id) {
    setSavedId(id);
    setTimeout(() => { if (alive.current) setSavedId((cur) => (cur === id ? null : cur)); }, 2000);
  }

  async function addPhoto(post, file) {
    setBusyId(post.id);
    setError(null);
    try {
      const small = await shrinkImage(file);
      const form = new FormData();
      form.append('file', small);
      const res = await fetch(`/api/social/posts/${post.id}/media`, { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(res.status === 409 ? text.mediaMigration : text.uploadError);
      else replacePost(data?.post);
    } catch {
      setError(text.uploadError);
    }
    if (alive.current) setBusyId(null);
  }

  async function removePhoto(post, path) {
    setBusyId(post.id);
    try {
      const res = await fetch(`/api/social/posts/${post.id}/media?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (res.ok) replacePost(data?.post);
      else setError(text.saveError);
    } catch {
      setError(text.saveError);
    }
    if (alive.current) setBusyId(null);
  }

  async function patchPost(post, payload) {
    setBusyId(post.id);
    setError(null);
    try {
      const res = await fetch(`/api/social/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(res.status === 409 ? text.mediaMigration : text.saveError);
        return false;
      }
      replacePost(data?.post);
      flashSaved(post.id);
      return true;
    } catch {
      setError(text.saveError);
      return false;
    } finally {
      if (alive.current) setBusyId(null);
    }
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

      {posts.length > 0 && mediaReady && (() => {
        // À FOURNIR (21/11/2026, Alex : « simple et ludique ») : une carte
        // par élément manquant, avec son bouton, dans l'ordre des semaines.
        const todo = posts
          .filter((p) => postState(p) !== 'pret')
          .sort((a, b) => a.week - b.week || a.slot - b.slot);
        if (todo.length === 0) return <p className="sp-done">{text.allDone}</p>;
        return (
          <div className="sp-todo">
            <h3 className="sp-todo-title">{text.todo}</h3>
            <p className="sp-muted">{text.todoLeft.replace('{n}', String(todo.length))}</p>
            <div className="sp-todo-cards">
              {todo.map((p) => {
                const st = postState(p);
                return (
                  <div className="sp-card" key={p.id}>
                    <span className="sp-card-meta">{text.week.replace('{n}', String(p.week))} · {text.cat[p.category] || p.category}</span>
                    <p className="sp-card-hint">{p.material_hint || p.subject}</p>
                    {st === 'photo' ? (
                      <PhotoButton big label={text.addPhoto} busyLabel={text.uploading} busy={busyId === p.id} onFile={(f) => addPhoto(p, f)} />
                    ) : (
                      <div className="sp-review">
                        <textarea rows={3} placeholder={text.reviewPh} value={reviews[p.id] ?? ''} onChange={(e) => setReviews({ ...reviews, [p.id]: e.target.value })} />
                        <button type="button" className="sp-primary" disabled={busyId === p.id || !(reviews[p.id] || '').trim()} onClick={() => patchPost(p, { review_text: reviews[p.id] })}>{text.save}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
                          {post.material_hint && state !== 'pret' && (
                            <p className="sp-missing"><strong>{text.missing} :</strong> {post.material_hint}</p>
                          )}
                          {mediaReady && (
                            <div className="sp-photos">
                              {(post.media || []).map((m) => (
                                <div className="sp-thumb" key={m.path}>
                                  <img src={mediaSrc(m.path)} alt="" loading="lazy" />
                                  <button type="button" className="sp-thumb-x" aria-label={text.remove} title={text.remove} disabled={busyId === post.id} onClick={() => removePhoto(post, m.path)}>×</button>
                                </div>
                              ))}
                              <PhotoButton label={text.addAnother} busyLabel={text.uploading} busy={busyId === post.id} onFile={(f) => addPhoto(post, f)} />
                            </div>
                          )}
                          {mediaReady && post.material_needed === 'avis' && (
                            <div className="sp-review">
                              <label className="sp-form">{text.reviewLabel}</label>
                              <textarea rows={3} placeholder={text.reviewPh} value={reviews[post.id] ?? post.review_text ?? ''} onChange={(e) => setReviews({ ...reviews, [post.id]: e.target.value })} />
                              <button type="button" className="sp-ghost" disabled={busyId === post.id} onClick={() => patchPost(post, { review_text: reviews[post.id] ?? post.review_text ?? '' })}>
                                {savedId === post.id ? text.saved : text.save}
                              </button>
                            </div>
                          )}
                          <div className="sp-tabs" role="tablist">
                            {NETWORKS.map((n) => (
                              <button key={n} type="button" role="tab" aria-selected={network === n} className={`sp-tab${network === n ? ' on' : ''}`} onClick={() => setNetwork(n)}>
                                {text.net[n]}
                              </button>
                            ))}
                          </div>
                          <p className="sp-form">{text.form[network]}</p>
                          {editing && editing.postId === post.id && editing.network === network ? (
                            <div className="sp-edit">
                              {editing.lines !== null && (
                                <>
                                  <label className="sp-form">{network === 'tiktok' ? text.oneScenePerLine : text.onePerLine}</label>
                                  <textarea rows={6} value={editing.lines} onChange={(e) => setEditing({ ...editing, lines: e.target.value })} />
                                </>
                              )}
                              <textarea rows={5} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                              <div className="sp-edit-row">
                                <button type="button" className="sp-primary" disabled={busyId === post.id} onClick={async () => { if (await patchPost(post, { content: contentFrom(network, editing) })) setEditing(null); }}>{text.save}</button>
                                <button type="button" className="sp-ghost" onClick={() => setEditing(null)}>{text.cancel}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <NetworkContent post={post} network={network} text={text} />
                              <button type="button" className="sp-link" onClick={() => setEditing({ postId: post.id, network, ...editableOf(post, network) })}>
                                {savedId === post.id ? text.saved : text.edit}
                              </button>
                            </>
                          )}
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
        .sp-done { margin: 0; font-weight: 600; color: var(--state-good-text, #1f9d55); }
        .sp-todo { display: grid; gap: 0.5rem; padding: 0.9rem; border-radius: var(--radius-md, 12px); border: 1px dashed var(--accent); }
        .sp-todo-title { margin: 0; font-size: 0.95rem; }
        .sp-todo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 0.6rem; }
        .sp-card { display: grid; gap: 0.45rem; align-content: start; padding: 0.75rem; border-radius: var(--radius-md, 12px); border: 1px solid var(--border); background: var(--bg-elevated, transparent); }
        .sp-card-meta { font-size: 0.74rem; font-weight: 600; color: var(--muted); }
        .sp-card-hint { margin: 0; font-size: 0.86rem; }
        .sp-photo-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; min-height: 44px; padding: 0 0.9rem; border-radius: var(--radius-md, 12px); border: 1px dashed var(--accent); background: transparent; color: var(--text); font: inherit; font-size: 0.86rem; font-weight: 600; cursor: pointer; }
        .sp-photo-btn.big { min-height: 72px; width: 100%; background: rgba(124, 110, 245, 0.08); }
        .sp-photo-btn:disabled { opacity: 0.6; cursor: default; }
        .sp-plus { font-size: 1.2rem; line-height: 1; color: var(--accent); }
        .sp-photos { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
        .sp-thumb { position: relative; width: 84px; height: 84px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
        .sp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .sp-thumb-x { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
        .sp-review, .sp-edit { display: grid; gap: 0.45rem; }
        .sp-review textarea, .sp-edit textarea { width: 100%; box-sizing: border-box; padding: 0.6rem 0.7rem; border-radius: 10px; border: 1px solid var(--border); background: var(--surface, transparent); color: var(--text); font: inherit; font-size: 0.88rem; line-height: 1.45; resize: vertical; }
        .sp-edit-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .sp-link { justify-self: start; background: none; border: 0; padding: 0.2rem 0; font: inherit; font-size: 0.82rem; color: var(--accent-light, var(--accent)); cursor: pointer; }
      `}</style>
    </section>
  );
}
