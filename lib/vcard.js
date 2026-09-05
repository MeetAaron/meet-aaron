// lib/vcard.js
// « Enregistrer sur le téléphone » (docx « mon avis » d'Alex, 31/08/2026) :
// génère une carte de visite vCard 3.0 à partir d'une fiche contact, avec
// les infos importantes dans les notes (profil DISC ressenti, notes de
// personnalité, avis d'Aaron). Sur iPhone/Android, ouvrir un .vcf propose
// directement d'ajouter le contact au carnet d'adresses.

function esc(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildVCard(p, { personalityLabel, notesLabel, adviceLabel } = {}) {
  const fullName = (p.full_name || '').trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const company = p.prospect_companies || {};
  const notes = [];
  if (personalityLabel) notes.push(personalityLabel);
  if (p.personality_notes) notes.push(`${notesLabel ? `${notesLabel} : ` : ''}${p.personality_notes}`);
  if (p.aaron_advice) notes.push(`${adviceLabel ? `${adviceLabel} : ` : ''}${p.aaron_advice}`);

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(lastName)};${esc(firstName)};;;`,
    `FN:${esc(fullName)}`,
  ];
  if (company.name) lines.push(`ORG:${esc(company.name)}`);
  if (p.job_title) lines.push(`TITLE:${esc(p.job_title)}`);
  if (p.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(p.email)}`);
  if (p.phone) lines.push(`TEL;TYPE=CELL,VOICE:${esc(p.phone)}`);
  if (company.address) lines.push(`ADR;TYPE=WORK:;;${esc(company.address)};;;;`);
  if (company.website) lines.push(`URL:${esc(company.website)}`);
  if (p.linkedin_url) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${esc(p.linkedin_url)}`);
  if (notes.length > 0) lines.push(`NOTE:${esc(notes.join('\n'))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

// Historique :
//   - v1 : <a download> sur une URL blob. Marche sur Android et ordinateur ;
//     ignoré par Safari iOS.
//   - v2 (04/09/2026 matin) : Web Share API avec fichier. Sur iPhone, iOS
//     l'a traité comme un FICHIER générique — « ça me sort la fiche comme un
//     fichier à enregistrer dans mes fichiers » (Alex). L'app Contacts
//     n'apparaissait pas dans la feuille de partage.
//   - v3 (04/09/2026 soir) : sur téléphone, on OUVRE une URL servie par le
//     serveur en `text/vcard` (app/api/prospects/[id]/vcard) dans un nouvel
//     onglet (window.open). Retour Alex (05/09) : « ça me fait charger une
//     page pendant 1 heure sans rien ». Un onglet ouvert par script part de
//     about:blank ; quand la réponse est un fichier (ou une fiche contact),
//     c'est le système qui la prend en charge et l'onglet, lui, reste vide
//     et « en chargement » — et dans l'app installée, window.open ouvre un
//     navigateur intégré qui n'affiche pas la fiche.
//   - v4 (05/09/2026) : sur téléphone, la même URL serveur est chargée dans
//     une IFRAME invisible. Safari iOS reconnaît le `text/vcard` et présente
//     la fiche « Créer un nouveau contact » PAR-DESSUS l'app, qui reste
//     intacte ; Android télécharge le .vcf en arrière-plan et propose
//     Contacts. Aucun onglet, aucune page blanche. On rend en plus l'URL de
//     la fiche pour que l'écran puisse proposer un lien de secours (« Si la
//     fiche ne s'est pas ouverte… »), utilisable d'un simple appui.
//   Sur ordinateur, on garde le téléchargement local (v1) : aucun serveur à
//   solliciter pour un fichier qu'on sait construire ici.
//
// `getToken` : fonction asynchrone renvoyant le jeton de session (une
// navigation n'a pas d'en-tête Authorization, la route lit `?token=`).
// Renvoie { ok, phone, url } — `url` n'est renseignée que sur téléphone.
export async function downloadVCard(p, labels, { getToken } = {}) {
  const vcf = buildVCard(p, labels);
  const filename = `${(p.full_name || 'contact').replace(/[^\w\-]+/g, '_')}.vcf`;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  // iPadOS se présente comme un Mac : on regarde aussi le tactile.
  const isPhone = /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

  if (isPhone && p.id && typeof getToken === 'function') {
    try {
      const token = await getToken();
      if (token) {
        const params = new URLSearchParams({ token });
        if (labels?.personalityLabel) params.set('personality', labels.personalityLabel);
        if (labels?.notesLabel) params.set('notes', labels.notesLabel);
        if (labels?.adviceLabel) params.set('advice', labels.adviceLabel);
        const url = `/api/prospects/${p.id}/vcard?${params.toString()}`;

        // Iframe invisible (et non window.open — voir l'historique ci-dessus).
        // On la garde une minute : sur iOS la fiche s'affiche tant que la
        // ressource est chargée, sur Android le téléchargement démarre en
        // arrière-plan, puis on nettoie.
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('title', filename);
        frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
        frame.src = url;
        document.body.appendChild(frame);
        setTimeout(() => {
          if (frame.parentNode) frame.parentNode.removeChild(frame);
        }, 60000);
        return { ok: true, phone: true, url };
      }
    } catch {
      // Repli local ci-dessous.
    }
  }

  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, phone: false, url: null };
}
