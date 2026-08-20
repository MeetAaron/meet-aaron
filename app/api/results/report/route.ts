// app/api/results/report/route.ts
// POST -> génère et télécharge un rapport (jour/semaine/mois/personnalisé)
// pour la page Résultats du commercial connecté (CHANGEMENTS A FAIRE #137,
// item A1 : "Il doit y avoir possibilité de télécharger le rapport (en pdf
// et xls ou ppt ?)"). Choix PDF + CSV (ouvrable directement dans Excel) :
// même raisonnement que app/api/team/report/route.ts — pas de dépendance
// lourde (type exceljs/pptxgenjs) non testable dans cet environnement pour
// une build Vercel serverless, alors que pdfkit (déjà en place) et un CSV
// texte brut ne demandent aucune nouvelle dépendance. CSV déjà le choix
// retenu ailleurs dans l'app pour "export XLS" (voir Prospects, Mon équipe,
// Mes documents).

import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { computePeriodSummary } from '@/lib/results-report';

const TYPE_LABELS: Record<string, string> = {
  day: 'Jour',
  week: 'Semaine',
  month: 'Mois',
  custom: 'Période personnalisée',
};

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

function csvEscape(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function POST(request: NextRequest) {
  const { user_id, type, period_start, period_end, format, title } = await request.json();

  if (!user_id || !period_start) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('full_name, company_id').eq('id', user_id).single();
  const { data: company } = user?.company_id
    ? await supabaseAdmin.from('companies').select('name').eq('id', user.company_id).single()
    : { data: null };

  const start = period_start ? new Date(period_start) : null;
  const end = period_end ? new Date(period_end) : null;
  const summary = await computePeriodSummary(user_id, start, end);

  const reportType = TYPE_LABELS[type] ? type : 'custom';
  const reportTitle: string =
    title || `${TYPE_LABELS[reportType]} — ${start ? start.toLocaleDateString('fr-FR') : ''}`;
  const generatedAt = new Date();

  if (format === 'csv') {
    const rows = [
      ['Rapport', reportTitle],
      ['Commercial', user?.full_name || ''],
      ['Société', company?.name || ''],
      ['Généré le', generatedAt.toLocaleString('fr-FR')],
      [],
      ['Indicateur', 'Valeur'],
      ['Prospects contactés', String(summary.prospectsContactes)],
      ['RDV obtenus', String(summary.rdvObtenus)],
      ['RDV en attente', String(summary.rdvEnAttente)],
      ['Taux de conversion RDV', `${summary.tauxConversion}%`],
      ['Opportunités gagnées', String(summary.opportunitesGagnees)],
      ['Opportunités perdues', String(summary.opportunitesPerdues)],
      ['Clients gagnés', String(summary.clientsGagnes)],
    ];
    const csv = rows.map((r) => r.map((cell) => csvEscape(String(cell))).join(';')).join('\n');
    // BOM UTF-8 pour qu'Excel affiche correctement les accents.
    const csvWithBom = '﻿' + csv;
    return new NextResponse(csvWithBom, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rapport-${reportType}-${(period_start || '').slice(0, 10)}.csv"`,
      },
    });
  }

  const pdfBuffer = await pdfBufferFrom((doc) => {
    doc.fontSize(20).fillColor('#131629').text(reportTitle, { align: 'left' });
    doc.fontSize(12).fillColor('#4b39ef').text(company?.name || 'Meet Aaron', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#8b90a8')
      .text(
        `Commercial : ${user?.full_name || ''} — généré le ${generatedAt.toLocaleDateString('fr-FR')} à ${generatedAt.toLocaleTimeString('fr-FR')}`
      );
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#131629').text('Résumé de la période', { underline: true });
    doc.moveDown(0.5);

    const metrics: [string, string | number][] = [
      ['Prospects contactés', summary.prospectsContactes],
      ['RDV obtenus', summary.rdvObtenus],
      ['RDV en attente', summary.rdvEnAttente],
      ['Taux de conversion RDV', `${summary.tauxConversion}%`],
      ['Opportunités gagnées', summary.opportunitesGagnees],
      ['Opportunités perdues', summary.opportunitesPerdues],
      ['Clients gagnés', summary.clientsGagnes],
    ];
    doc.fontSize(10).fillColor('#232744');
    metrics.forEach(([label, value]) => {
      doc.text(`${label} : ${value}`, { continued: false });
      doc.moveDown(0.4);
    });
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport-${reportType}-${(period_start || '').slice(0, 10)}.pdf"`,
    },
  });
}
