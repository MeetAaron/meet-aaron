// lib/devis-pdf.ts
// Génère un PDF simple pour un devis Aaron (lib/aaron-sales.ts -> generateDevis),
// nécessaire pour l'envoi en signature électronique via Youtrust (voir
// lib/youtrust.ts) — l'API Youtrust attend un vrai document PDF à faire
// signer, pas juste un texte. Même approche pdfkit que
// app/api/team/report/route.ts (pur JS, fonctionne sans souci en serverless
// Vercel, pas de dépendance lourde type headless Chrome).
//
// Volontairement sobre (pas de mise en page "template société" pour
// l'instant, voir companies.devis_template_storage_path prévu pour une
// future évolution) : objet, récapitulatif des postes avec prix, total, et
// un emplacement réservé pour la signature en bas de page.

import PDFDocument from 'pdfkit';
import { Devis } from './aaron-sales';

function pdfBufferFrom(build: (doc: any) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc: any = new (PDFDocument as any)({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

export async function buildDevisPdf(
  devis: Devis,
  params: { prospectName: string; prospectCompany: string | null; sellerCompanyName: string | null }
): Promise<Buffer> {
  return pdfBufferFrom((doc) => {
    doc.fontSize(18).fillColor('#131629').text(devis.objet || 'Devis');
    doc.fontSize(11).fillColor('#4b39ef').text(params.sellerCompanyName || 'Meet Aaron');
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#8b90a8')
      .text(
        `Destinataire : ${params.prospectName}${params.prospectCompany ? ` — ${params.prospectCompany}` : ''}    Date : ${new Date().toLocaleDateString('fr-FR')}`
      );
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#131629').text('Récapitulatif', { underline: true });
    doc.moveDown(0.5);

    const colX = [50, 260, 400, 460];
    doc.fontSize(9).fillColor('#4b39ef');
    doc.text('Poste', colX[0], doc.y, { continued: true, width: 200 });
    doc.text('Qté', colX[1], doc.y, { continued: true, width: 60 });
    doc.text('Prix unit.', colX[2], doc.y, { continued: true, width: 80 });
    doc.text('Total', colX[3], doc.y, { width: 85 });
    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#232744').stroke();
    doc.moveDown(0.3);

    doc.fontSize(9).fillColor('#131629');
    for (const line of devis.recapitulatif) {
      const y = doc.y;
      doc.text(line.poste, colX[0], y, { width: 200 });
      const afterLabelY = doc.y;
      doc.text(String(line.quantite), colX[1], y, { width: 60 });
      doc.text(line.prix_unitaire_eur != null ? `${line.prix_unitaire_eur.toFixed(2)} €` : '—', colX[2], y, { width: 80 });
      doc.text(line.total_ligne_eur != null ? `${line.total_ligne_eur.toFixed(2)} €` : '—', colX[3], y, { width: 85 });
      doc.y = Math.max(afterLabelY, doc.y);
      if (line.description) {
        doc.fontSize(8).fillColor('#8b90a8').text(line.description, colX[0], doc.y, { width: 460 });
        doc.fontSize(9).fillColor('#131629');
      }
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#232744').stroke();
    doc.moveDown(0.4);

    if (devis.total_eur != null) {
      doc
        .fontSize(11)
        .fillColor('#131629')
        .text(`Total${devis.a_des_postes_sans_prix ? ' (partiel — certains postes restent à chiffrer)' : ''} : ${devis.total_eur.toFixed(2)} €`, {
          align: 'right',
        });
    }

    doc.moveDown(3);
    doc.fontSize(9).fillColor('#8b90a8').text('Bon pour accord — signature :', 50, doc.y);
    doc.moveDown(3);
  });
}
