// lib/business-profile-pdf.ts
// Génère le PDF du "Profil de l'entreprise" (demande Alex, 27/08/2026 :
// export téléchargeable "à tout moment", en plus du Word — voir
// lib/rtf-document.ts). Même moteur pdfkit que lib/invoice-pdf.ts,
// lib/devis-pdf.ts et app/api/team/report/route.ts (pur JS, fonctionne sans
// souci en serverless Vercel, déjà une dépendance du projet).

import PDFDocument from 'pdfkit';
import { BUSINESS_PROFILE_MARKER_RE, splitBusinessProfileParagraphs } from './business-profile-format';

function pdfBufferFrom(build: (doc: any) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc: any = new (PDFDocument as any)({ margin: 50, size: 'A4', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

export interface BusinessProfileDocData {
  companyName: string;
  legalLines: string[];
  bodyText: string;
  generatedAtLabel: string;
}

// Palette identique à lib/invoice-pdf.ts / lib/rtf-document.ts, pour rester
// cohérent entre les deux formats d'export.
const COLOR_TEXT = '#131629';
const COLOR_ACCENT = '#4b39ef';
const COLOR_MUTED = '#8b90a8';

export async function buildBusinessProfilePdf(data: BusinessProfileDocData): Promise<Buffer> {
  return pdfBufferFrom((doc) => {
    doc.fontSize(22).fillColor(COLOR_TEXT).text(data.companyName || 'Profil de l’entreprise', { align: 'center' });
    doc.fontSize(11).fillColor(COLOR_ACCENT).text('Profil de l’entreprise — généré par Meet Aaron', { align: 'center' });
    if (data.legalLines.length) {
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor(COLOR_MUTED).text(data.legalLines.join('   •   '), { align: 'center' });
    }
    doc.moveDown(1.5);

    const paragraphs = splitBusinessProfileParagraphs(data.bodyText);
    if (paragraphs.length === 0) {
      doc.fontSize(11).fillColor(COLOR_MUTED).text('Aucun profil renseigné pour le moment.', { align: 'left' });
    }
    for (const para of paragraphs) {
      const m = para.match(BUSINESS_PROFILE_MARKER_RE);
      if (m) {
        const label = para.slice(0, m[0].length);
        const rest = para.slice(m[0].length).trim();
        doc.fontSize(11).fillColor(COLOR_ACCENT).text(label, { continued: true, align: 'left' });
        doc.fontSize(11).fillColor(COLOR_TEXT).text(' ' + rest, { align: 'left' });
      } else {
        doc.fontSize(11).fillColor(COLOR_TEXT).text(para, { align: 'left' });
      }
      doc.moveDown(0.8);
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor(COLOR_MUTED).text(data.generatedAtLabel, { align: 'center' });
  });
}
