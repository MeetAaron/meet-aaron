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
//     serveur en `text/vcard` (app/api/prospects/[id]/vcard). Safari iOS
//     reconnaît le type et affiche « Créer un nouveau contact » ; Android
//     télécharge puis propose Contacts. C'est le seul parcours qui aboutit
//     dans le carnet d'adresses sur les deux systèmes.
//   Sur ordinateur, on garde le téléchargement local (v1) : aucun serveur à
//   solliciter pour un fichier qu'on sait construire ici.
//
// `getToken` : fonction asynchrone renvoyant le jeton de session (une
// navigation n'a pas d'en-tête Authorization, la route lit `?token=`).
export async function downloadVCard(p, labels, { getToken } = {}) {
  const vcf = buildVCard(p, labels);
  const filename = `${(p.full_name || 'contact').replace(/[^\w\-]+/g, '_')}.vcf`;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isPhone = /iPhone|iPad|iPod|Android/i.test(ua);

  if (isPhone && p.id && typeof getToken === 'function') {
    try {
      const token = await getToken();
      if (token) {
        const params = new URLSearchParams({ token });
        if (labels?.personalityLabel) params.set('personality', labels.personalityLabel);
        if (labels?.notesLabel) params.set('notes', labels.notesLabel);
        if (labels?.adviceLabel) params.set('advice', labels.adviceLabel);
        // window.open et non location.href : dans l'app installée (PWA), une
        // navigation remplacerait l'app entière par la fiche vCard.
        const win = window.open(`/api/prospects/${p.id}/vcard?${params.toString()}`, '_blank', 'noopener');
        if (win || isPhone) return true;
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
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
