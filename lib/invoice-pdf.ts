// lib/invoice-pdf.ts
// Génère le PDF d'une facture client (tâche #141 sous-item 2). Même moteur
// pdfkit que lib/devis-pdf.ts et app/api/team/report/route.ts (pur JS, sans
// dépendance lourde type headless Chrome, fonctionne en serverless Vercel).
//
// Mentions incluses (usage France, voir lib/client-invoices.ts pour le
// détail des limites) : numéro de facture, dates d'émission/échéance,
// identité vendeur (nom, SIRET, adresse, forme juridique, TVA ou mention
// d'exonération), identité acheteur, détail des lignes, totaux HT/TVA/TTC,
// conditions de paiement + mention légale pénalités de retard.

import PDFDocument from 'pdfkit';
import { InvoiceLineItem } from './client-invoices';

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

export interface InvoicePdfSeller {
  name: string;
  siret: string | null;
  legalAddress: string | null;
  legalForm: string | null;
  vatNumber: string | null;
  vatExemptMention: string | null;
}

export interface InvoicePdfBuyer {
  name: string;
  company: string | null;
  address: string | null;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: string; // ISO
  dueDate: string | null; // ISO
  lineItems: InvoiceLineItem[];
  totalHtEur: number;
  vatRate: number | null;
  totalTtcEur: number;
  paymentTerms: string;
  seller: InvoicePdfSeller;
  buyer: InvoicePdfBuyer;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR');
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return pdfBufferFrom((doc) => {
    doc.fontSize(18).fillColor('#131629').text(`Facture ${data.invoiceNumber}`);
    doc.fontSize(9).fillColor('#8b90a8').text(`Date d'émission : ${fmtDate(data.issueDate)}    Échéance : ${fmtDate(data.dueDate)}`);
    doc.moveDown(1);

    // Bloc vendeur / acheteur côte à côte
    const blockY = doc.y;
    doc.fontSize(10).fillColor('#4b39ef').text('Émetteur', 50, blockY);
    doc.fontSize(9).fillColor('#131629');
    doc.text(data.seller.name || 'Entreprise non renseignée', 50, doc.y);
    if (data.seller.legalForm) doc.fontSize(8).fillColor('#8b90a8').text(data.seller.legalForm, 50, doc.y);
    if (data.seller.legalAddress) doc.fontSize(8).fillColor('#8b90a8').text(data.seller.legalAddress, 50, doc.y, { width: 240 });
    if (data.seller.siret) doc.fontSize(8).fillColor('#8b90a8').text(`SIRET : ${data.seller.siret}`, 50, doc.y);
    if (data.seller.vatNumber) {
      doc.fontSize(8).fillColor('#8b90a8').text(`N° TVA intracommunautaire : ${data.seller.vatNumber}`, 50, doc.y);
    } else if (data.seller.vatExemptMention) {
      doc.fontSize(8).fillColor('#8b90a8').text(data.seller.vatExemptMention, 50, doc.y, { width: 240 });
    }

    const sellerBlockEndY = doc.y;

    doc.fontSize(10).fillColor('#4b39ef').text('Destinataire', 320, blockY);
    doc.fontSize(9).fillColor('#131629');
    doc.text(data.buyer.company || data.buyer.name, 320, blockY + 15, { width: 225 });
    if (data.buyer.company && data.buyer.name) {
      doc.fontSize(8).fillColor('#8b90a8').text(data.buyer.name, 320, doc.y, { width: 225 });
    }
    if (data.buyer.address) doc.fontSize(8).fillColor('#8b90a8').text(data.buyer.address, 320, doc.y, { width: 225 });

    doc.y = Math.max(sellerBlockEndY, doc.y) + 20;

    doc.fontSize(11).fillColor('#131629').text('Détail', 50, doc.y, { underline: true });
    doc.moveDown(0.5);

    const colX = [50, 260, 350, 440];
    doc.fontSize(9).fillColor('#4b39ef');
    doc.text('Désignation', colX[0], doc.y, { continued: true, width: 200 });
    doc.text('Qté', colX[1], doc.y, { continued: true, width: 80 });
    doc.text('Prix unit. HT', colX[2], doc.y, { continued: true, width: 80 });
    doc.text('Total HT', colX[3], doc.y, { width: 95 });
    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#232744').stroke();
    doc.moveDown(0.3);

    doc.fontSize(9).fillColor('#131629');
    for (const line of data.lineItems) {
      const y = doc.y;
      doc.text(line.designation, colX[0], y, { width: 200 });
      const afterLabelY = doc.y;
      doc.text(String(line.quantite), colX[1], y, { width: 80 });
      doc.text(`${line.prix_unitaire_ht_eur.toFixed(2)} €`, colX[2], y, { width: 80 });
      doc.text(`${line.total_ligne_ht_eur.toFixed(2)} €`, colX[3], y, { width: 95 });
      doc.y = Math.max(afterLabelY, doc.y);
      if (line.description) {
        doc.fontSize(8).fillColor('#8b90a8').text(line.description, colX[0], doc.y, { width: 460 });
        doc.fontSize(9).fillColor('#131629');
      }
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#232744').stroke();
    doc.moveDown(0.4);

    doc.fontSize(10).fillColor('#131629').text(`Total HT : ${data.totalHtEur.toFixed(2)} €`, { align: 'right' });
    if (data.vatRate) {
      doc.fontSize(10).fillColor('#131629').text(`TVA (${(data.vatRate * 100).toFixed(1)} %) : ${(data.totalTtcEur - data.totalHtEur).toFixed(2)} €`, { align: 'right' });
    } else if (data.seller.vatExemptMention) {
      doc.fontSize(9).fillColor('#8b90a8').text(data.seller.vatExemptMention, { align: 'right' });
    }
    doc.fontSize(12).fillColor('#131629').text(`Total TTC : ${data.totalTtcEur.toFixed(2)} €`, { align: 'right' });

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#8b90a8').text(data.paymentTerms, 50, doc.y, { width: 495 });
  });
}
