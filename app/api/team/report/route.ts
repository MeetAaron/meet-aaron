// app/api/team/report/route.ts
// POST -> pour un fondateur/patron, génère un rapport de performances PDF
// téléchargeable pour une période donnée (3ᵉ onglet "Mon équipe", item 3 du
// docx : "genre un document téléchargeable en powerpoint ou pdf... il faut
// vraiment que ça ait une utilité"). Choix PDF plutôt que PowerPoint : pas
// de dépendance lourde compatible Vercel serverless pour générer un vrai
// .pptx, alors que pdfkit est pur JS et fonctionne sans souci en serverless.
//
// Contenu pensé pour être vraiment utile à un commercial/fondateur (pas un
// simple export de chiffres) : totaux société, répartition par commercial
// (mêmes 6 stats que le 1er onglet), et un court résumé généré par Aaron
// qui pointe ce qui se dégage de la période plutôt que de laisser Alex
// interpréter seul un tableau de nombres.

import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude } from '@/lib/anthropic-client';
import { computeStatsForMembers, periodRangeFor, MemberStats } from '@/lib/team-stats';
import { localeInstruction } from '@/lib/locale-instruction';

const PERIOD_LABELS: Record<string, string> = {
  all: "Depuis l'ouverture du compte",
  month: 'Depuis le début du mois',
  custom: 'Période personnalisée',
};

function emptyStats(): MemberStats {
  return { prospects_actifs: 0, rdv_gagnes: 0, opportunites_actives: 0, clients_gagnes: 0, clients_actifs: 0, clients_perdus: 0 };
}

function sumStats(all: MemberStats[]): MemberStats {
  const total = emptyStats();
  for (const s of all) {
    total.prospects_actifs += s.prospects_actifs;
    total.rdv_gagnes += s.rdv_gagnes;
    total.opportunites_actives += s.opportunites_actives;
    total.clients_gagnes += s.clients_gagnes;
    total.clients_actifs += s.clients_actifs;
    total.clients_perdus += s.clients_perdus;
  }
  return total;
}

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

export async function POST(request: NextRequest) {
  const { user_id, period, since: customSince, until: customUntil } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: requester } = await supabaseAdmin
    .from('users')
    .select('company_id, role')
    .eq('id', user_id)
    .single();

  if (!requester) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }
  if (requester.role !== 'patron') {
    return NextResponse.json({ error: "Réservé au fondateur/patron de l'entreprise" }, { status: 403 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', requester.company_id)
    .single();

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, full_name, role')
    .eq('company_id', requester.company_id)
    .order('created_at', { ascending: true });

  const memberIds = (members || []).map((m: any) => m.id);
  const periodMode = period === 'month' || period === 'custom' ? period : 'all';
  const range = periodRangeFor(periodMode, customSince, customUntil);
  const statsByMember = await computeStatsForMembers(memberIds, range);

  const rows = (members || []).map((m: any) => ({
    name: m.full_name,
    role: m.role,
    stats: statsByMember[m.id] || emptyStats(),
  }));
  const totals = sumStats(rows.map((r: any) => r.stats));

  // Résumé Aaron : best-effort, jamais bloquant — un rapport sans résumé
  // (juste les chiffres) reste largement utilisable si Claude échoue ou si
  // le plafond de dépense API est atteint.
  let summary: string | null = null;
  try {
    const lines = rows.map(
      (r: any) =>
        `- ${r.name} : ${r.stats.prospects_actifs} prospects actifs, ${r.stats.rdv_gagnes} RDV gagnés, ${r.stats.opportunites_actives} opportunités actives, ${r.stats.clients_gagnes} clients gagnés (${r.stats.clients_actifs} actifs / ${r.stats.clients_perdus} perdus).`
    );
    const prompt = `Tu es Aaron, copilote commercial IA. Voici les performances de l'équipe commerciale de "${company?.name || 'la société'}" sur la période "${PERIOD_LABELS[periodMode]}" :\n\nTotaux société : ${totals.prospects_actifs} prospects actifs, ${totals.rdv_gagnes} RDV gagnés, ${totals.opportunites_actives} opportunités actives, ${totals.clients_gagnes} clients gagnés (${totals.clients_actifs} actifs / ${totals.clients_perdus} perdus).\n\nPar commercial :\n${lines.join('\n')}\n\nRédige un résumé exécutif en 4-6 phrases maximum, pour le fondateur de l'entreprise : ce qui se dégage de ces chiffres (points forts, signaux d'alerte comme un taux de clients perdus élevé ou un commercial en difficulté), et 1-2 recommandations concrètes. Sois direct et actionnable, sans jargon. Réponds uniquement avec ce texte, ${localeInstruction(authedUser.locale)}, sans préambule ni titre.`;

    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] },
      requester.company_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    summary = textBlock?.text?.trim() || null;
  } catch (err) {
    // Silencieux — le rapport se génère quand même sans résumé (voir plus haut).
    summary = null;
  }

  const generatedAt = new Date();
  const periodLabel = PERIOD_LABELS[periodMode];

  const pdfBuffer = await pdfBufferFrom((doc) => {
    doc.fontSize(20).fillColor('#131629').text('Rapport de performances', { align: 'left' });
    doc.fontSize(12).fillColor('#4b39ef').text(company?.name || 'Meet Aaron', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#8b90a8')
      .text(`Période : ${periodLabel} — généré le ${generatedAt.toLocaleDateString('fr-FR')} à ${generatedAt.toLocaleTimeString('fr-FR')}`);
    doc.moveDown(1);

    if (summary) {
      doc.fontSize(11).fillColor('#131629').text("Résumé d'Aaron", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#232744').text(summary, { align: 'left' });
      doc.moveDown(1);
    }

    doc.fontSize(11).fillColor('#131629').text("Totaux de l'équipe", { underline: true });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor('#232744')
      .text(
        `Prospects actifs : ${totals.prospects_actifs}    RDV gagnés : ${totals.rdv_gagnes}    Opportunités actives : ${totals.opportunites_actives}\n` +
          `Clients gagnés : ${totals.clients_gagnes}  (dont actifs : ${totals.clients_actifs}, perdus : ${totals.clients_perdus})`
      );
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#131629').text('Détail par commercial', { underline: true });
    doc.moveDown(0.5);

    const colX = [50, 190, 265, 335, 415, 470, 525];
    const headers = ['Commercial', 'Prospects', 'RDV', 'Opport.', 'Clients', 'Actifs', 'Perdus'];
    doc.fontSize(9).fillColor('#4b39ef');
    headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < headers.length - 1, width: 80 }));
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#232744').stroke();
    doc.moveDown(0.3);

    doc.fontSize(9).fillColor('#131629');
    rows.forEach((r: any) => {
      const y = doc.y;
      doc.text(r.name, colX[0], y, { width: 130 });
      doc.text(String(r.stats.prospects_actifs), colX[1], y, { width: 65 });
      doc.text(String(r.stats.rdv_gagnes), colX[2], y, { width: 65 });
      doc.text(String(r.stats.opportunites_actives), colX[3], y, { width: 65 });
      doc.text(String(r.stats.clients_gagnes), colX[4], y, { width: 50 });
      doc.text(String(r.stats.clients_actifs), colX[5], y, { width: 50 });
      doc.text(String(r.stats.clients_perdus), colX[6], y, { width: 50 });
      doc.moveDown(0.6);
    });
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport-performances-${generatedAt.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
