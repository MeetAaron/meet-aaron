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

export function downloadVCard(p, labels) {
  const vcf = buildVCard(p, labels);
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(p.full_name || 'contact').replace(/[^\w\-]+/g, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
