'use client';

// components/SignatureEditor.jsx
//
// SIGNATURE DES EMAILS — nouvel écran (18/11/2026).
//
// Retours d'Alex et de Pierre : « la signature ne marche pas, ça saute, ça
// bugue » et « l'interface est très moche ». L'ancien écran demandait de
// remplir huit onglets (Par défaut + 7 langues) pour le texte, puis encore
// huit pour l'image et huit pour le bandeau. Personne ne le faisait, et
// l'onglet affiché ne disait pas clairement ce qui partait vraiment.
//
// Désormais :
//   - UNE signature, écrite dans la langue du commercial ;
//   - Aaron la traduit automatiquement dans les six autres langues
//     (lib/signature-locale.ts) et choisit à l'envoi celle du message
//     (langue du corps de l'email, sinon campagne / pays du prospect) ;
//   - les numéros, adresses, liens et noms ne sont jamais modifiés (une
//     traduction qui y touche est rejetée) ;
//   - chaque traduction reste visible et corrigeable, mais repliée ;
//   - un aperçu montre exactement le bas de l'email.
// Les images par langue restent possibles, rangées dans un volet facultatif.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

const TEXT = {
  fr: {
    label: 'Ta signature',
    placeholder: 'Marie Dupont\nResponsable commerciale — Société\n06 12 34 56 78 · www.societe.fr',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Signature enregistrée',
    detect: 'Récupérer depuis mon dernier email',
    detecting: 'Recherche…',
    detectHint: 'Gmail uniquement. Relis-la avant d’enregistrer.',
    autoTitle: 'Traduite automatiquement',
    autoOn: 'Aaron envoie ta signature dans la langue de chaque email, selon le message et la campagne. Noms, numéros, adresses et liens ne sont jamais modifiés.',
    autoOff: 'Ta signature part telle quelle dans tous les emails, quelle que soit leur langue.',
    show: 'Voir les traductions',
    hide: 'Masquer les traductions',
    writtenIn: 'Écrite en {lang}',
    pending: 'Traduction en cours…',
    pendingSave: 'Enregistre ta signature pour la traduire.',
    edited: 'Corrigée à la main',
    edit: 'Corriger',
    reset: 'Revenir à la traduction',
    cancel: 'Annuler',
    keep: 'Garder cette version',
    preview: 'Aperçu en bas de tes emails',
    previewBody: 'Bonjour Julie,\n\nMerci pour votre retour, je vous envoie les éléments demandés.',
    previewEmpty: 'Écris ta signature pour voir l’aperçu.',
    imageTitle: 'Image sous la signature',
    imageHint: 'Logo ou carte de visite. PNG, JPEG, GIF ou WEBP, 2 Mo maximum.',
    bannerTitle: 'Bandeau',
    bannerHint: 'Bannière affichée tout en bas, sous la signature.',
    imagesRule: 'Tes images partent dès que le prospect t’a répondu. Le premier email part sans image : il arrive mieux.',
    add: 'Ajouter une image',
    replace: 'Remplacer',
    remove: 'Retirer',
    uploading: 'Envoi…',
    perLang: 'Une image différente selon la langue',
    perLangHint: 'Facultatif. Une langue sans image utilise l’image ci-dessus.',
    unsaved: 'Modifications non enregistrées',
    error: 'Une erreur est survenue. Réessaie.',
  },
  en: {
    label: 'Your signature',
    placeholder: 'Mary Smith\nSales Manager — Company\n+44 20 1234 5678 · www.company.com',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Signature saved',
    detect: 'Pull from my last sent email',
    detecting: 'Searching…',
    detectHint: 'Gmail only. Check it before saving.',
    autoTitle: 'Translated automatically',
    autoOn: 'Aaron sends your signature in the language of each email, based on the message and the campaign. Names, numbers, addresses and links are never changed.',
    autoOff: 'Your signature is sent as is in every email, whatever its language.',
    show: 'Show translations',
    hide: 'Hide translations',
    writtenIn: 'Written in {lang}',
    pending: 'Translating…',
    pendingSave: 'Save your signature to translate it.',
    edited: 'Edited by hand',
    edit: 'Edit',
    reset: 'Back to translation',
    cancel: 'Cancel',
    keep: 'Keep this version',
    preview: 'Preview at the bottom of your emails',
    previewBody: 'Hi Julie,\n\nThanks for getting back to me, here is what you asked for.',
    previewEmpty: 'Write your signature to see the preview.',
    imageTitle: 'Image under the signature',
    imageHint: 'Logo or business card. PNG, JPEG, GIF or WEBP, 2 MB max.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner shown at the very bottom, under the signature.',
    imagesRule: 'Your images are sent once the prospect has replied. The first email goes without images: it lands better.',
    add: 'Add an image',
    replace: 'Replace',
    remove: 'Remove',
    uploading: 'Uploading…',
    perLang: 'A different image per language',
    perLangHint: 'Optional. A language without an image uses the one above.',
    unsaved: 'Unsaved changes',
    error: 'Something went wrong. Please try again.',
  },
  de: {
    label: 'Deine Signatur',
    placeholder: 'Maria Müller\nVertriebsleiterin — Firma\n+49 30 1234567 · www.firma.de',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    saved: 'Signatur gespeichert',
    detect: 'Aus meiner letzten gesendeten E-Mail übernehmen',
    detecting: 'Suche…',
    detectHint: 'Nur Gmail. Vor dem Speichern prüfen.',
    autoTitle: 'Automatisch übersetzt',
    autoOn: 'Aaron sendet deine Signatur in der Sprache jeder E-Mail, je nach Nachricht und Kampagne. Namen, Nummern, Adressen und Links werden nie verändert.',
    autoOff: 'Deine Signatur wird in jeder E-Mail unverändert gesendet, egal in welcher Sprache.',
    show: 'Übersetzungen anzeigen',
    hide: 'Übersetzungen ausblenden',
    writtenIn: 'Geschrieben auf {lang}',
    pending: 'Wird übersetzt…',
    pendingSave: 'Speichere deine Signatur, um sie zu übersetzen.',
    edited: 'Von Hand korrigiert',
    edit: 'Korrigieren',
    reset: 'Zurück zur Übersetzung',
    cancel: 'Abbrechen',
    keep: 'Diese Version behalten',
    preview: 'Vorschau am Ende deiner E-Mails',
    previewBody: 'Hallo Julia,\n\ndanke für Ihre Rückmeldung, anbei die gewünschten Unterlagen.',
    previewEmpty: 'Schreibe deine Signatur, um die Vorschau zu sehen.',
    imageTitle: 'Bild unter der Signatur',
    imageHint: 'Logo oder Visitenkarte. PNG, JPEG, GIF oder WEBP, max. 2 MB.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner ganz unten, unter der Signatur.',
    imagesRule: 'Deine Bilder werden gesendet, sobald der Interessent geantwortet hat. Die erste E-Mail geht ohne Bild raus: Sie kommt besser an.',
    add: 'Bild hinzufügen',
    replace: 'Ersetzen',
    remove: 'Entfernen',
    uploading: 'Wird hochgeladen…',
    perLang: 'Ein anderes Bild je Sprache',
    perLangHint: 'Optional. Eine Sprache ohne Bild verwendet das Bild oben.',
    unsaved: 'Nicht gespeicherte Änderungen',
    error: 'Ein Fehler ist aufgetreten. Bitte erneut versuchen.',
  },
  it: {
    label: 'La tua firma',
    placeholder: 'Maria Rossi\nResponsabile vendite — Azienda\n+39 02 1234 5678 · www.azienda.it',
    save: 'Salva',
    saving: 'Salvataggio…',
    saved: 'Firma salvata',
    detect: 'Recupera dalla mia ultima email inviata',
    detecting: 'Ricerca…',
    detectHint: 'Solo Gmail. Rileggila prima di salvare.',
    autoTitle: 'Tradotta automaticamente',
    autoOn: 'Aaron invia la tua firma nella lingua di ogni email, in base al messaggio e alla campagna. Nomi, numeri, indirizzi e link non vengono mai modificati.',
    autoOff: 'La tua firma parte così com’è in tutte le email, qualunque sia la lingua.',
    show: 'Mostra le traduzioni',
    hide: 'Nascondi le traduzioni',
    writtenIn: 'Scritta in {lang}',
    pending: 'Traduzione in corso…',
    pendingSave: 'Salva la tua firma per tradurla.',
    edited: 'Corretta a mano',
    edit: 'Correggi',
    reset: 'Torna alla traduzione',
    cancel: 'Annulla',
    keep: 'Tieni questa versione',
    preview: 'Anteprima in fondo alle tue email',
    previewBody: 'Buongiorno Giulia,\n\ngrazie per la risposta, le invio quanto richiesto.',
    previewEmpty: 'Scrivi la tua firma per vedere l’anteprima.',
    imageTitle: 'Immagine sotto la firma',
    imageHint: 'Logo o biglietto da visita. PNG, JPEG, GIF o WEBP, max 2 MB.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner in fondo, sotto la firma.',
    imagesRule: 'Le tue immagini partono appena il potenziale cliente ha risposto. La prima email parte senza immagini: arriva meglio.',
    add: 'Aggiungi un’immagine',
    replace: 'Sostituisci',
    remove: 'Rimuovi',
    uploading: 'Caricamento…',
    perLang: 'Un’immagine diversa per lingua',
    perLangHint: 'Facoltativo. Una lingua senza immagine usa quella sopra.',
    unsaved: 'Modifiche non salvate',
    error: 'Si è verificato un errore. Riprova.',
  },
  es: {
    label: 'Tu firma',
    placeholder: 'María García\nDirectora comercial — Empresa\n+34 912 345 678 · www.empresa.es',
    save: 'Guardar',
    saving: 'Guardando…',
    saved: 'Firma guardada',
    detect: 'Recuperar de mi último correo enviado',
    detecting: 'Buscando…',
    detectHint: 'Solo Gmail. Revísala antes de guardar.',
    autoTitle: 'Traducida automáticamente',
    autoOn: 'Aaron envía tu firma en el idioma de cada correo, según el mensaje y la campaña. Nombres, números, direcciones y enlaces nunca se modifican.',
    autoOff: 'Tu firma se envía tal cual en todos los correos, sea cual sea su idioma.',
    show: 'Ver las traducciones',
    hide: 'Ocultar las traducciones',
    writtenIn: 'Escrita en {lang}',
    pending: 'Traduciendo…',
    pendingSave: 'Guarda tu firma para traducirla.',
    edited: 'Corregida a mano',
    edit: 'Corregir',
    reset: 'Volver a la traducción',
    cancel: 'Cancelar',
    keep: 'Conservar esta versión',
    preview: 'Vista previa al final de tus correos',
    previewBody: 'Hola Julia,\n\ngracias por tu respuesta, te envío lo que me pediste.',
    previewEmpty: 'Escribe tu firma para ver la vista previa.',
    imageTitle: 'Imagen bajo la firma',
    imageHint: 'Logo o tarjeta de visita. PNG, JPEG, GIF o WEBP, 2 MB máximo.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner al final, bajo la firma.',
    imagesRule: 'Tus imágenes se envían en cuanto el cliente potencial ha respondido. El primer email sale sin imágenes: llega mejor.',
    add: 'Añadir una imagen',
    replace: 'Reemplazar',
    remove: 'Quitar',
    uploading: 'Subiendo…',
    perLang: 'Una imagen distinta según el idioma',
    perLangHint: 'Opcional. Un idioma sin imagen usa la de arriba.',
    unsaved: 'Cambios sin guardar',
    error: 'Se ha producido un error. Inténtalo de nuevo.',
  },
  pt: {
    label: 'A sua assinatura',
    placeholder: 'Maria Silva\nDiretora comercial — Empresa\n+351 21 123 4567 · www.empresa.pt',
    save: 'Guardar',
    saving: 'A guardar…',
    saved: 'Assinatura guardada',
    detect: 'Recuperar do meu último email enviado',
    detecting: 'A procurar…',
    detectHint: 'Apenas Gmail. Reveja antes de guardar.',
    autoTitle: 'Traduzida automaticamente',
    autoOn: 'O Aaron envia a sua assinatura no idioma de cada email, consoante a mensagem e a campanha. Nomes, números, moradas e links nunca são alterados.',
    autoOff: 'A sua assinatura é enviada tal como está em todos os emails, seja qual for o idioma.',
    show: 'Ver as traduções',
    hide: 'Ocultar as traduções',
    writtenIn: 'Escrita em {lang}',
    pending: 'A traduzir…',
    pendingSave: 'Guarde a sua assinatura para a traduzir.',
    edited: 'Corrigida à mão',
    edit: 'Corrigir',
    reset: 'Voltar à tradução',
    cancel: 'Cancelar',
    keep: 'Manter esta versão',
    preview: 'Pré-visualização no fim dos seus emails',
    previewBody: 'Olá Júlia,\n\nobrigado pela resposta, envio-lhe o que pediu.',
    previewEmpty: 'Escreva a sua assinatura para ver a pré-visualização.',
    imageTitle: 'Imagem sob a assinatura',
    imageHint: 'Logótipo ou cartão de visita. PNG, JPEG, GIF ou WEBP, 2 MB no máximo.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner no fim, sob a assinatura.',
    imagesRule: 'As tuas imagens seguem assim que o potencial cliente responde. O primeiro email segue sem imagens: chega melhor.',
    add: 'Adicionar uma imagem',
    replace: 'Substituir',
    remove: 'Remover',
    uploading: 'A enviar…',
    perLang: 'Uma imagem diferente por idioma',
    perLangHint: 'Opcional. Um idioma sem imagem usa a de cima.',
    unsaved: 'Alterações por guardar',
    error: 'Ocorreu um erro. Tente novamente.',
  },
  nl: {
    label: 'Je handtekening',
    placeholder: 'Marie de Vries\nSales manager — Bedrijf\n+31 20 123 4567 · www.bedrijf.nl',
    save: 'Opslaan',
    saving: 'Opslaan…',
    saved: 'Handtekening opgeslagen',
    detect: 'Ophalen uit mijn laatst verzonden e-mail',
    detecting: 'Zoeken…',
    detectHint: 'Alleen Gmail. Controleer hem voor het opslaan.',
    autoTitle: 'Automatisch vertaald',
    autoOn: 'Aaron verstuurt je handtekening in de taal van elke e-mail, op basis van het bericht en de campagne. Namen, nummers, adressen en links worden nooit gewijzigd.',
    autoOff: 'Je handtekening wordt in elke e-mail ongewijzigd verstuurd, in welke taal ook.',
    show: 'Vertalingen tonen',
    hide: 'Vertalingen verbergen',
    writtenIn: 'Geschreven in het {lang}',
    pending: 'Wordt vertaald…',
    pendingSave: 'Sla je handtekening op om hem te vertalen.',
    edited: 'Met de hand aangepast',
    edit: 'Aanpassen',
    reset: 'Terug naar de vertaling',
    cancel: 'Annuleren',
    keep: 'Deze versie houden',
    preview: 'Voorbeeld onderaan je e-mails',
    previewBody: 'Hallo Julia,\n\nbedankt voor je reactie, hierbij wat je vroeg.',
    previewEmpty: 'Schrijf je handtekening om het voorbeeld te zien.',
    imageTitle: 'Afbeelding onder de handtekening',
    imageHint: 'Logo of visitekaartje. PNG, JPEG, GIF of WEBP, max. 2 MB.',
    bannerTitle: 'Banner',
    bannerHint: 'Banner helemaal onderaan, onder de handtekening.',
    imagesRule: 'Je afbeeldingen gaan mee zodra de prospect heeft geantwoord. De eerste e-mail gaat zonder afbeelding: die komt beter aan.',
    add: 'Afbeelding toevoegen',
    replace: 'Vervangen',
    remove: 'Verwijderen',
    uploading: 'Uploaden…',
    perLang: 'Een andere afbeelding per taal',
    perLangHint: 'Optioneel. Een taal zonder afbeelding gebruikt de afbeelding hierboven.',
    unsaved: 'Niet-opgeslagen wijzigingen',
    error: 'Er ging iets mis. Probeer het opnieuw.',
  },
};

function tx(locale, key) {
  return (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key] || key;
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

// Ligne vide au début / à la fin et espaces de fin de ligne : ce que le
// serveur retire aussi (tidySignature), pour comparer sans faux « non
// enregistré ».
function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function AutoTextarea({ value, onChange, placeholder, minRows = 4, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="sig-textarea"
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck
      autoFocus={autoFocus}
    />
  );
}

// Une image (signature ou bandeau) : vignette + Remplacer / Retirer, ou une
// zone « Ajouter une image ». Le fichier part dès qu'il est choisi : plus de
// double étape « choisir » puis « téléverser ».
function ImageSlot({ locale, url, busy, onPick, onRemove, wide }) {
  const inputRef = useRef(null);
  return (
    <div className={`img-slot${url ? ' has-img' : ''}${wide ? ' is-wide' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
      {url ? (
        <>
          <img src={url} alt="" />
          <div className="img-actions">
            <button type="button" className="sig-link" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? tx(locale, 'uploading') : tx(locale, 'replace')}
            </button>
            <button type="button" className="sig-link is-danger" onClick={onRemove} disabled={busy}>
              {tx(locale, 'remove')}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="img-add" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Ic name="upload" size={15} />
          {busy ? tx(locale, 'uploading') : tx(locale, 'add')}
        </button>
      )}
      <style jsx>{`
        .img-slot {
          display: flex;
          align-items: center;
          gap: 0.9rem;
          flex-wrap: wrap;
        }
        .img-slot img {
          max-width: 200px;
          max-height: 72px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: #fff;
          object-fit: contain;
        }
        .img-slot.is-wide img {
          max-width: min(100%, 320px);
        }
        .img-actions {
          display: flex;
          gap: 0.9rem;
        }
        .img-add {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 0.95rem;
          border: 1px dashed var(--border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--muted);
          font: inherit;
          font-size: 0.85rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .img-add:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--text);
        }
      `}</style>
    </div>
  );
}

export default function SignatureEditor({ locale, userId, initial, onChange }) {
  const [saved, setSaved] = useState(() => tidy(initial?.signature || ''));
  const [draft, setDraft] = useState(() => initial?.signature || '');
  const [auto, setAuto] = useState(initial?.signature_auto !== false);
  const [from, setFrom] = useState(initial?.signature_from || null);
  const [versions, setVersions] = useState(initial?.signature_versions || {});
  const [showVersions, setShowVersions] = useState(false);
  const [editing, setEditing] = useState(null); // { locale, text }
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);

  const [imageUrl, setImageUrl] = useState(initial?.signature_image_url || null);
  const [imageByLocale, setImageByLocale] = useState(initial?.signature_image_by_locale || {});
  const [bannerUrl, setBannerUrl] = useState(initial?.banner_image_url || null);
  const [bannerByLocale, setBannerByLocale] = useState(initial?.banner_by_locale || {});
  const [busyImage, setBusyImage] = useState(null); // 'signature:' | 'banner:fr' …
  const [showPerLang, setShowPerLang] = useState(
    () => Object.keys(initial?.signature_image_by_locale || {}).length > 0 || Object.keys(initial?.banner_by_locale || {}).length > 0
  );
  const [perLangTab, setPerLangTab] = useState(LOCALES.find((l) => l !== (initial?.signature_from || locale)) || 'en');

  const flashTimer = useRef(null);
  const pollTimer = useRef(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  const dirty = tidy(draft) !== saved;
  const otherLocales = useMemo(() => LOCALES.filter((l) => l !== from), [from]);
  const pendingCount = otherLocales.filter((l) => versions[l]?.pending).length;

  useEffect(() => {
    onChange?.({ hasSignature: !!saved, auto });
  }, [saved, auto]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyResponse(body) {
    if (!body) return;
    if (typeof body.signature_auto === 'boolean') setAuto(body.signature_auto);
    if ('signature_from' in body) setFrom(body.signature_from || null);
    if (body.signature_versions) setVersions(body.signature_versions);
    const stillPending = body.signature_auto !== false && body.signature_versions
      && Object.values(body.signature_versions).some((v) => v && v.pending);
    if (stillPending && body.signature) schedulePoll();
  }

  // La traduction a pu dépasser le délai de l'enregistrement : on relit une
  // ou deux fois pour afficher les versions dès qu'elles sont prêtes.
  function schedulePoll(attempt = 0) {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (attempt > 3) return;
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signature?user_id=${userId}`);
        const body = await res.json();
        if (body.signature_versions) setVersions(body.signature_versions);
        if ('signature_from' in body) setFrom(body.signature_from || null);
        if (Object.values(body.signature_versions || {}).some((v) => v && v.pending)) schedulePoll(attempt + 1);
      } catch {}
    }, 5000 + attempt * 4000);
  }

  async function patch(payload) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/signature', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, signature: tidy(draft), ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || tx(locale, 'error'));
      setSaved(tidy(body.signature || draft));
      setDraft((d) => tidy(d));
      applyResponse(body);
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2500);
      return true;
    } catch (err) {
      setError(err.message || tx(locale, 'error'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch('/api/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.signature) setDraft(body.signature);
      else setHint(body.error || tx(locale, 'error'));
    } catch {
      setHint(tx(locale, 'error'));
    } finally {
      setDetecting(false);
    }
  }

  async function uploadImage(kind, file, lang) {
    const key = `${kind}:${lang || ''}`;
    setBusyImage(key);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('user_id', userId);
      if (kind === 'banner') form.append('kind', 'banner');
      if (lang) form.append('locale', lang);
      const res = await fetch('/api/signature/image', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || tx(locale, 'error'));
      if (kind === 'banner') {
        if (lang) setBannerByLocale((p) => ({ ...p, [lang]: body.url }));
        else setBannerUrl(body.url);
      } else if (lang) setImageByLocale((p) => ({ ...p, [lang]: body.url }));
      else setImageUrl(body.url);
    } catch (err) {
      setError(err.message || tx(locale, 'error'));
    } finally {
      setBusyImage(null);
    }
  }

  async function removeImage(kind, lang) {
    const key = `${kind}:${lang || ''}`;
    setBusyImage(key);
    setError(null);
    try {
      const qs = `user_id=${userId}${kind === 'banner' ? '&kind=banner' : ''}${lang ? `&locale=${lang}` : ''}`;
      const res = await fetch(`/api/signature/image?${qs}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || tx(locale, 'error'));
      }
      const drop = (p) => {
        const n = { ...p };
        delete n[lang];
        return n;
      };
      if (kind === 'banner') {
        if (lang) setBannerByLocale(drop);
        else setBannerUrl(null);
      } else if (lang) setImageByLocale(drop);
      else setImageUrl(null);
    } catch (err) {
      setError(err.message || tx(locale, 'error'));
    } finally {
      setBusyImage(null);
    }
  }

  const previewSignature = tidy(draft);
  const fromLabel = from ? LOCALE_LABELS[from] : null;

  return (
    <div className="sig">
      <div className="sig-label">{tx(locale, 'label')}</div>
      <AutoTextarea value={draft} onChange={setDraft} placeholder={tx(locale, 'placeholder')} minRows={4} />

      <div className="sig-bar">
        <button type="button" className="sig-link" onClick={handleDetect} disabled={detecting}>
          <Ic name="mail" size={14} /> {detecting ? tx(locale, 'detecting') : tx(locale, 'detect')}
        </button>
        <div className="sig-bar-right">
          {savedFlash && !dirty ? (
            <span className="sig-ok"><Ic name="check" size={14} strokeWidth={2.6} /> {tx(locale, 'saved')}</span>
          ) : dirty ? (
            <span className="sig-dirty">{tx(locale, 'unsaved')}</span>
          ) : null}
          <button type="button" className="sig-primary" onClick={() => patch({ auto_translate: auto })} disabled={saving || !dirty}>
            {saving ? tx(locale, 'saving') : tx(locale, 'save')}
          </button>
        </div>
      </div>
      {hint && <p className="sig-hint">{hint} <span className="sig-muted">{tx(locale, 'detectHint')}</span></p>}
      {error && <p className="sig-error">{error}</p>}

      {/* Traduction automatique */}
      <div className={`sig-auto${auto ? ' is-on' : ''}`}>
        <span className="sig-auto-icon"><Ic name="globe" size={18} /></span>
        <div className="sig-auto-text">
          <div className="sig-auto-title">
            {tx(locale, 'autoTitle')}
            {auto && fromLabel ? <span className="sig-chip">{tx(locale, 'writtenIn').replace('{lang}', fromLabel)}</span> : null}
          </div>
          <p>{auto ? tx(locale, 'autoOn') : tx(locale, 'autoOff')}</p>
          {auto && saved ? (
            <div className="sig-auto-actions">
              <button type="button" className="sig-link" onClick={() => setShowVersions((v) => !v)}>
                <Ic name={showVersions ? 'chevronUp' : 'chevronDown'} size={14} />
                {showVersions ? tx(locale, 'hide') : tx(locale, 'show')}
              </button>
              {pendingCount > 0 ? <span className="sig-muted">{tx(locale, 'pending')}</span> : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={auto ? 'true' : 'false'}
          aria-label={tx(locale, 'autoTitle')}
          className={`sig-switch${auto ? ' is-on' : ''}`}
          disabled={saving}
          onClick={() => {
            const next = !auto;
            setAuto(next);
            if (!next) setShowVersions(false);
            patch({ auto_translate: next });
          }}
        >
          <span />
        </button>
      </div>

      {auto && saved && showVersions ? (
        <ul className="sig-versions">
          {otherLocales.map((loc) => {
            const v = versions[loc] || {};
            const isEditing = editing?.locale === loc;
            return (
              <li key={loc} className="sig-version">
                <div className="sig-version-head">
                  <span className="sig-version-lang">{LOCALE_LABELS[loc]}</span>
                  {v.manual ? <span className="sig-chip is-soft">{tx(locale, 'edited')}</span> : null}
                  <span className="sig-version-actions">
                    {!isEditing && !v.pending ? (
                      <button type="button" className="sig-link" onClick={() => setEditing({ locale: loc, text: v.text || saved })}>
                        <Ic name="pencil" size={13} /> {tx(locale, 'edit')}
                      </button>
                    ) : null}
                    {!isEditing && v.manual ? (
                      <button type="button" className="sig-link" onClick={() => patch({ overrides: { [loc]: null } })} disabled={saving}>
                        <Ic name="undo" size={13} /> {tx(locale, 'reset')}
                      </button>
                    ) : null}
                  </span>
                </div>
                {isEditing ? (
                  <div className="sig-version-edit">
                    <AutoTextarea value={editing.text} onChange={(text) => setEditing({ locale: loc, text })} minRows={3} autoFocus />
                    <div className="sig-version-edit-actions">
                      <button type="button" className="sig-link" onClick={() => setEditing(null)}>{tx(locale, 'cancel')}</button>
                      <button
                        type="button"
                        className="sig-primary is-small"
                        disabled={saving || !tidy(editing.text)}
                        onClick={async () => {
                          const ok = await patch({ overrides: { [loc]: editing.text } });
                          if (ok) setEditing(null);
                        }}
                      >
                        {tx(locale, 'keep')}
                      </button>
                    </div>
                  </div>
                ) : v.pending ? (
                  <p className="sig-muted">{tx(locale, dirty ? 'pendingSave' : 'pending')}</p>
                ) : (
                  <pre className="sig-version-text">{v.text}</pre>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Aperçu : le bas d'un email tel que le destinataire le verra */}
      <div className="sig-section-title">{tx(locale, 'preview')}</div>
      <div className="sig-paper">
        {/* Le corps de l'email est figuré par des traits gris, pas par un
            vrai texte (20/11/2026, remarque d'Alex) : avec « Bonjour Julie,
            merci pour votre retour… », le commercial croyait que cette phrase
            partirait dans ses emails. */}
        <div className="sig-paper-lines" aria-hidden="true"><span /><span /><span /></div>
        {previewSignature ? (
          <div className="sig-paper-sign">{previewSignature}</div>
        ) : (
          <div className="sig-paper-empty">{tx(locale, 'previewEmpty')}</div>
        )}
        {imageUrl ? <img className="sig-paper-img" src={imageUrl} alt="" /> : null}
        {bannerUrl ? <img className="sig-paper-banner" src={bannerUrl} alt="" /> : null}
      </div>

      {/* Images. La règle d'envoi est dite AVANT le dépôt (19/11/2026) :
          en prospection, image et bannière ne partent qu'après la première
          réponse du prospect (lib/messaging.ts). Sans cette ligne, le
          commercial déposerait son logo et croirait à une panne en ne le
          voyant pas sur son premier email. */}
      <div className="sig-images">
        <p className="sig-muted sig-images-rule">{tx(locale, 'imagesRule')}</p>
        <div className="sig-image-row">
          <div className="sig-image-text">
            <div className="sig-image-title">{tx(locale, 'imageTitle')}</div>
            <p className="sig-muted">{tx(locale, 'imageHint')}</p>
          </div>
          <ImageSlot
            locale={locale}
            url={imageUrl}
            busy={busyImage === 'signature:'}
            onPick={(f) => uploadImage('signature', f, null)}
            onRemove={() => removeImage('signature', null)}
          />
        </div>
        <div className="sig-image-row">
          <div className="sig-image-text">
            <div className="sig-image-title">{tx(locale, 'bannerTitle')}</div>
            <p className="sig-muted">{tx(locale, 'bannerHint')}</p>
          </div>
          <ImageSlot
            locale={locale}
            url={bannerUrl}
            wide
            busy={busyImage === 'banner:'}
            onPick={(f) => uploadImage('banner', f, null)}
            onRemove={() => removeImage('banner', null)}
          />
        </div>

        <button type="button" className="sig-link" onClick={() => setShowPerLang((v) => !v)}>
          <Ic name={showPerLang ? 'chevronUp' : 'chevronDown'} size={14} /> {tx(locale, 'perLang')}
        </button>
        {showPerLang ? (
          <div className="sig-perlang">
            <p className="sig-muted">{tx(locale, 'perLangHint')}</p>
            <div className="sig-tabs" role="tablist">
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  role="tab"
                  aria-selected={perLangTab === loc ? 'true' : 'false'}
                  className={`sig-tab${perLangTab === loc ? ' is-active' : ''}${imageByLocale[loc] || bannerByLocale[loc] ? ' is-filled' : ''}`}
                  onClick={() => setPerLangTab(loc)}
                >
                  {LOCALE_LABELS[loc]}
                </button>
              ))}
            </div>
            <div className="sig-image-row">
              <div className="sig-image-text"><div className="sig-image-title">{tx(locale, 'imageTitle')}</div></div>
              <ImageSlot
                locale={locale}
                url={imageByLocale[perLangTab] || null}
                busy={busyImage === `signature:${perLangTab}`}
                onPick={(f) => uploadImage('signature', f, perLangTab)}
                onRemove={() => removeImage('signature', perLangTab)}
              />
            </div>
            <div className="sig-image-row">
              <div className="sig-image-text"><div className="sig-image-title">{tx(locale, 'bannerTitle')}</div></div>
              <ImageSlot
                locale={locale}
                url={bannerByLocale[perLangTab] || null}
                wide
                busy={busyImage === `banner:${perLangTab}`}
                onPick={(f) => uploadImage('banner', f, perLangTab)}
                onRemove={() => removeImage('banner', perLangTab)}
              />
            </div>
          </div>
        ) : null}
      </div>

      <style jsx>{`
        .sig {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-top: 0.8rem;
        }
        .sig-label,
        .sig-section-title {
          font-size: 0.78rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--muted);
        }
        .sig-section-title {
          margin-top: 0.6rem;
        }
        .sig :global(.sig-textarea) {
          width: 100%;
          box-sizing: border-box;
          min-height: 110px;
          resize: none;
          overflow: hidden;
          padding: 0.85rem 0.95rem;
          background: var(--bg);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font: inherit;
          font-size: 0.92rem;
          line-height: 1.55;
          transition: border-color var(--fast), box-shadow var(--fast);
        }
        .sig :global(.sig-textarea:focus) {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .sig :global(.sig-textarea::placeholder) {
          color: var(--muted-soft, var(--muted));
        }
        .sig-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .sig-bar-right {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-left: auto;
        }
        .sig :global(.sig-link) {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.2rem 0;
          background: none;
          border: 0;
          color: var(--accent-light);
          font: inherit;
          font-size: 0.84rem;
          font-weight: 500;
          cursor: pointer;
        }
        .sig :global(.sig-link:hover:not(:disabled)) {
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .sig :global(.sig-link:disabled) {
          opacity: 0.55;
          cursor: default;
        }
        .sig :global(.sig-link.is-danger) {
          color: var(--state-bad-text);
        }
        .sig-primary {
          padding: 0.6rem 1.15rem;
          border: 0;
          border-radius: var(--radius-sm);
          background: var(--accent);
          color: #fff;
          font: inherit;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
          transition: background var(--fast), opacity var(--fast);
        }
        .sig-primary:hover:not(:disabled) {
          background: var(--accent-dark);
        }
        .sig-primary:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .sig-primary.is-small {
          padding: 0.45rem 0.85rem;
          font-size: 0.82rem;
        }
        .sig-ok {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          color: var(--state-good-text);
          font-size: 0.82rem;
        }
        .sig-dirty {
          color: var(--state-warn-text);
          font-size: 0.82rem;
        }
        .sig-hint,
        .sig-error {
          margin: 0;
          font-size: 0.84rem;
        }
        .sig-error {
          color: var(--state-bad-text);
        }
        .sig-muted {
          margin: 0;
          color: var(--muted);
          font-size: 0.82rem;
          line-height: 1.45;
        }
        .sig-auto {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 0.8rem;
          align-items: start;
          padding: 0.9rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--bg);
        }
        .sig-auto.is-on {
          border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
          background: color-mix(in srgb, var(--accent) 7%, var(--bg));
        }
        .sig-auto-icon {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--accent) 16%, transparent);
          color: var(--accent-light);
        }
        .sig-auto-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text);
        }
        .sig-auto-text p {
          margin: 0.25rem 0 0.35rem;
          color: var(--muted);
          font-size: 0.83rem;
          line-height: 1.5;
        }
        .sig-auto-actions {
          display: flex;
          align-items: center;
          gap: 0.4rem 0.8rem;
          flex-wrap: wrap;
        }
        .sig-chip {
          padding: 0.12rem 0.5rem;
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent) 18%, transparent);
          color: var(--accent-light);
          font-size: 0.72rem;
          font-weight: 600;
        }
        .sig-chip.is-soft {
          background: var(--state-warn-bg);
          color: var(--state-warn-text);
        }
        .sig-switch {
          position: relative;
          width: 44px;
          height: 26px;
          margin-top: 0.15rem;
          border: 0;
          border-radius: 999px;
          background: var(--border);
          cursor: pointer;
          transition: background var(--fast);
          flex-shrink: 0;
        }
        .sig-switch span {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          transition: transform var(--fast);
        }
        .sig-switch.is-on {
          background: var(--accent);
        }
        .sig-switch.is-on span {
          transform: translateX(18px);
        }
        .sig-switch:disabled {
          opacity: 0.6;
        }
        .sig-versions {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.5rem;
        }
        .sig-version {
          padding: 0.7rem 0.85rem;
          border: 1px solid var(--border-soft, var(--border));
          border-radius: var(--radius-sm);
          background: var(--bg);
        }
        .sig-version-head {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.35rem;
        }
        .sig-version-lang {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text);
        }
        .sig-version-actions {
          display: flex;
          gap: 0.8rem;
          margin-left: auto;
        }
        .sig-version-text {
          margin: 0;
          white-space: pre-wrap;
          font: inherit;
          font-size: 0.84rem;
          line-height: 1.5;
          color: var(--muted);
          overflow-wrap: anywhere;
        }
        .sig-version-edit {
          display: grid;
          gap: 0.5rem;
        }
        .sig-version-edit-actions {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 0.9rem;
        }
        /* L'aperçu reste clair dans les deux thèmes : c'est ainsi que la
           grande majorité des destinataires lisent leurs emails. */
        .sig-paper {
          padding: 1rem 1.1rem 1.1rem;
          border-radius: var(--radius-md);
          background: #ffffff;
          color: #202124;
          border: 1px solid var(--border);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 0.86rem;
          line-height: 1.5;
          overflow: hidden;
        }
        .sig-paper-lines {
          display: grid;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .sig-paper-lines span {
          display: block;
          height: 0.55rem;
          border-radius: 999px;
          background: #e3e5e8;
        }
        .sig-paper-lines span:nth-child(1) { width: 28%; }
        .sig-paper-lines span:nth-child(2) { width: 86%; }
        .sig-paper-lines span:nth-child(3) { width: 62%; }
        .sig-paper-body {
          white-space: pre-wrap;
          color: #3c4043;
        }
        .sig-paper-sign {
          margin-top: 0.9rem;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .sig-paper-empty {
          margin-top: 0.9rem;
          color: #9aa0a6;
          font-style: italic;
        }
        .sig-paper-img {
          display: block;
          max-width: 280px;
          max-height: 140px;
          margin-top: 8px;
        }
        .sig-paper-banner {
          display: block;
          width: 100%;
          max-width: 480px;
          margin-top: 12px;
        }
        .sig-images {
          display: grid;
          gap: 0.9rem;
          margin-top: 0.4rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border-soft, var(--border));
        }
        .sig-image-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.8rem;
          align-items: center;
        }
        .sig-image-title {
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--text);
        }
        .sig-image-text .sig-muted {
          margin-top: 0.15rem;
        }
        .sig-perlang {
          display: grid;
          gap: 0.8rem;
          padding: 0.85rem 0.9rem;
          border-radius: var(--radius-sm);
          background: var(--bg);
          border: 1px solid var(--border-soft, var(--border));
        }
        .sig-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .sig-tab {
          padding: 0.28rem 0.65rem;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--muted);
          font: inherit;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .sig-tab.is-active {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .sig-tab.is-filled:not(.is-active) {
          color: var(--text);
          border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
        }
        @media (max-width: 560px) {
          .sig-image-row {
            grid-template-columns: 1fr;
          }
          .sig-bar-right {
            width: 100%;
            justify-content: flex-end;
          }
          .sig-auto {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .sig-auto-icon {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
