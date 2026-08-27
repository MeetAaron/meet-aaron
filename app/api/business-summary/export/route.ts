// app/api/business-summary/export/route.ts
// GET -> télécharge le "Profil de l'entreprise" en Word (.rtf) ou PDF
// (demande Alex, 27/08/2026 : "à tout moment l'utilisateur doit pouvoir
// télécharger soit en word soit en pdf"). Voir lib/rtf-document.ts et
// lib/business-profile-pdf.ts pour la génération elle-même.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { buildBusinessProfileRtf } from '@/lib/rtf-document';
import { buildBusinessProfilePdf } from '@/lib/business-profile-pdf';

function sanitizeForFilename(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents (marques diacritiques combinantes après NFD)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'entreprise';
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const format = request.nextUrl.searchParams.get('format'); // 'word' | 'pdf'

  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  if (format !== 'word' && format !== 'pdf') {
    return NextResponse.json({ error: "format invalide (attendu 'word' ou 'pdf')" }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary, siret, legal_address, legal_form')
    .eq('id', user.company_id)
    .single();

  if (!company) {
    return NextResponse.json({ error: 'Société introuvable' }, { status: 404 });
  }

  const legalLines: string[] = [];
  if (company.legal_form) legalLines.push(company.legal_form);
  if (company.legal_address) legalLines.push(company.legal_address);
  if (company.siret) legalLines.push(`SIRET : ${company.siret}`);

  const now = new Date();
  const generatedAtLabel = `Document généré automatiquement par Meet Aaron le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR')}`;

  const docData = {
    companyName: company.name || 'Profil de l’entreprise',
    legalLines,
    bodyText: company.business_summary || '',
    generatedAtLabel,
  };

  const baseFilename = `profil-entreprise-${sanitizeForFilename(company.name || 'meet-aaron')}-${now.toISOString().slice(0, 10)}`;

  if (format === 'word') {
    const rtf = buildBusinessProfileRtf(docData);
    return new NextResponse(rtf, {
      status: 200,
      headers: {
        // .rtf : format texte ouvert nativement par Word/LibreOffice/Google
        // Docs sans avertissement, sans dépendance npm à installer côté
        // serveur (voir lib/rtf-document.ts pour le pourquoi).
        'Content-Type': 'application/rtf; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseFilename}.rtf"`,
      },
    });
  }

  const pdfBuffer = await buildBusinessProfilePdf(docData);
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${baseFilename}.pdf"`,
    },
  });
}
