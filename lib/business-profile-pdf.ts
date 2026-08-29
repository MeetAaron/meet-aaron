// lib/business-profile-pdf.ts
// Génère le PDF du "Profil de l'entreprise" (demande Alex, 27/08/2026 :
// export téléchargeable "à tout moment", en plus du Word — voir
// lib/rtf-document.ts). Même moteur pdfkit que lib/invoice-pdf.ts,
// lib/devis-pdf.ts et app/api/team/report/route.ts (pur JS, fonctionne sans
// souci en serverless Vercel, déjà une dépendance du projet).

import PDFDocument from 'pdfkit';
import { classifyBusinessProfileParagraph, splitBusinessProfileParagraphs } from './business-profile-format';

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
      const classified = classifyBusinessProfileParagraph(para);
      if (classified.type === 'heading') {
        // Titre de section (profil enrichi, 29/08/2026) : plus grand, gras,
        // couleur accent, avec un filet horizontal dessous pour bien séparer
        // les sections visuellement — cohérent avec le rendu Word.
        doc.moveDown(0.6);
        doc.fontSize(15).fillColor(COLOR_ACCENT).font('Helvetica-Bold').text(classified.text, { align: 'left' });
        const lineY = doc.y + 2;
        doc.moveTo(doc.page.margins.left, lineY)
          .lineTo(doc.page.width - doc.page.margins.right, lineY)
          .strokeColor(COLOR_ACCENT)
          .lineWidth(0.75)
          .stroke();
        doc.font('Helvetica');
        doc.moveDown(0.6);
      } else if (classified.type === 'marker') {
        doc.fontSize(11).fillColor(COLOR_ACCENT).text(classified.label, { continued: true, align: 'left' });
        doc.fontSize(11).fillColor(COLOR_TEXT).text(' ' + classified.rest, { align: 'left' });
        doc.moveDown(0.8);
      } else {
        doc.fontSize(11).fillColor(COLOR_TEXT).text(classified.text, { align: 'left' });
        doc.moveDown(0.8);
      }
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor(COLOR_MUTED).text(data.generatedAtLabel, { align: 'center' });
  });
}
