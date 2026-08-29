// lib/business-profile-pdf.ts
// Génère le PDF du "Profil de l'entreprise" (demande Alex, 27/08/2026 :
// export téléchargeable "à tout moment", en plus du Word — voir
// lib/rtf-document.ts). Même moteur pdfkit que lib/invoice-pdf.ts,
// lib/devis-pdf.ts et app/api/team/report/route.ts (pur JS, fonctionne sans
// souci en serverless Vercel, déjà une dépendance du projet).

import PDFDocument from 'pdfkit';
import { classifyBusinessProfileParagraph, splitBusinessProfileParagraphs } from './business-profile-format';
import type { CompanyKeyStats } from './company-stats';

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
  // Statistiques réelles calculées à l'export (lib/company-stats.ts) — null
  // quand la société n'a encore aucune activité enregistrée (voir
  // hasAnyData) : la section est alors omise entièrement du document.
  stats?: CompanyKeyStats | null;
}

// Palette identique à lib/invoice-pdf.ts / lib/rtf-document.ts, pour rester
// cohérent entre les deux formats d'export.
const COLOR_TEXT = '#131629';
const COLOR_ACCENT = '#4b39ef';
const COLOR_MUTED = '#8b90a8';

// Section "Statistiques clés" (demande Alex, 29/08/2026, "génération de
// graphiques dans le document") — seule partie chiffrée du profil, calculée
// en direct (lib/company-stats.ts), jamais générée par le modèle. Le
// graphique en barres n'existe que dans l'export PDF : pdfkit dessine des
// vecteurs nativement, alors que l'export Word (lib/rtf-document.ts) reste
// en RTF texte pur (voir le commentaire d'en-tête de ce fichier) — l'export
// Word reçoit les mêmes chiffres sous forme de liste, sans le graphique.
function drawStatsSection(doc: any, stats: CompanyKeyStats) {
  // Garde-fou pagination : les primitives de dessin utilisées ci-dessous
  // (rect/moveTo/lineTo) ne déclenchent pas le saut de page automatique de
  // pdfkit comme le fait .text() en flux normal — on force une nouvelle page
  // si la place restante est trop juste pour accueillir titre + résumé
  // chiffré + graphique (jusqu'à 5 barres).
  const estimatedHeight = 90 + stats.pipelineParEtape.length * 20;
  if (doc.y + estimatedHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }

  doc.moveDown(0.6);
  doc.fontSize(15).fillColor(COLOR_ACCENT).font('Helvetica-Bold').text('Statistiques clés', { align: 'left' });
  const lineY = doc.y + 2;
  doc.moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.width - doc.page.margins.right, lineY)
    .strokeColor(COLOR_ACCENT)
    .lineWidth(0.75)
    .stroke();
  doc.font('Helvetica');
  doc.moveDown(0.6);

  const statLine = [
    `${stats.prospectsDemarches} prospect${stats.prospectsDemarches > 1 ? 's' : ''} démarché${stats.prospectsDemarches > 1 ? 's' : ''}`,
    `${stats.clientsConvertis} client${stats.clientsConvertis > 1 ? 's' : ''} converti${stats.clientsConvertis > 1 ? 's' : ''}`,
    `${stats.tauxConversionRdv}% de taux de conversion en RDV`,
    stats.campagnesMenees > 0
      ? `${stats.campagnesMenees} campagne${stats.campagnesMenees > 1 ? 's' : ''} de prospection menée${stats.campagnesMenees > 1 ? 's' : ''}`
      : null,
  ]
    .filter(Boolean)
    .join('   •   ');
  doc.fontSize(11).fillColor(COLOR_TEXT).text(statLine, { align: 'left' });
  doc.moveDown(1);

  if (stats.pipelineParEtape.length > 0) {
    doc.fontSize(10).fillColor(COLOR_MUTED).text('Répartition du pipeline commercial', { align: 'left' });
    doc.moveDown(0.4);

    const maxCount = Math.max(...stats.pipelineParEtape.map((s) => s.count));
    const labelWidth = 100;
    const countColumnWidth = 30;
    const chartLeft = doc.page.margins.left + labelWidth + 10;
    const chartWidth = doc.page.width - doc.page.margins.right - chartLeft - countColumnWidth - 8;
    const barHeight = 12;
    const rowHeight = 20;

    for (const stage of stats.pipelineParEtape) {
      const rowY = doc.y;
      doc
        .fontSize(9)
        .fillColor(COLOR_TEXT)
        .text(stage.label, doc.page.margins.left, rowY + 2, { width: labelWidth, align: 'left', lineBreak: false });
      const barW = maxCount > 0 ? Math.max(4, (stage.count / maxCount) * chartWidth) : 4;
      doc.rect(chartLeft, rowY, barW, barHeight).fill(COLOR_ACCENT);
      doc
        .fontSize(9)
        .fillColor(COLOR_TEXT)
        .text(String(stage.count), chartLeft + chartWidth + 8, rowY + 2, { width: countColumnWidth, align: 'left', lineBreak: false });
      doc.y = rowY + rowHeight;
    }
    doc.moveDown(0.5);
  }
}

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

    if (data.stats) {
      drawStatsSection(doc, data.stats);
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor(COLOR_MUTED).text(data.generatedAtLabel, { align: 'center' });
  });
}
