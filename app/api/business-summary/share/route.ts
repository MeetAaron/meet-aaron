// app/api/business-summary/share/route.ts
// POST { user_id, email } -> envoie le "Profil de l'entreprise" en PDF à
// l'adresse indiquée, depuis la boîte email du commercial connecté (docx
// Modifs Aaron 30/08/2026, item 6 : "possibilité de partager par email avec
// un bouton — le fondateur entre simplement l'adresse email et Aaron enverra
// un email du genre : voici le profil de l'entreprise, en document PDF").
//
// Même document que l'export PDF (app/api/business-summary/export/route.ts),
// même envoi que tous les emails d'Aaron (lib/messaging.ts, boîte Gmail/
// Outlook connectée, signature du commercial) — donc rien de nouveau à
// configurer côté serveur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { buildBusinessProfilePdf } from '@/lib/business-profile-pdf';
import { sendEmailForUser } from '@/lib/messaging';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeForFilename(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'entreprise';
}

export async function POST(request: NextRequest) {
  const { user_id, email } = await request.json();
  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const to = typeof email === 'string' ? email.trim() : '';
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('company_id, full_name, first_name')
    .eq('id', user_id)
    .single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary, siret, legal_address, legal_form')
    .eq('id', user.company_id)
    .single();
  if (!company?.business_summary) {
    return NextResponse.json({ error: "Le profil de l'entreprise n'est pas encore rédigé" }, { status: 400 });
  }

  const legalLines: string[] = [];
  if (company.legal_form) legalLines.push(company.legal_form);
  if (company.legal_address) legalLines.push(company.legal_address);
  if (company.siret) legalLines.push(`SIRET : ${company.siret}`);

  const now = new Date();
  const pdf = await buildBusinessProfilePdf({
    companyName: company.name || 'Profil de l’entreprise',
    legalLines,
    bodyText: company.business_summary,
    generatedAtLabel: `Document généré automatiquement par Meet Aaron le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR')}`,
  });

  const companyName = company.name || 'notre entreprise';
  const senderName = user.first_name || user.full_name || '';
  const subject = `Profil de l'entreprise ${companyName}`;
  const body =
    `Bonjour,\n\n` +
    `Voici le profil de l'entreprise ${companyName}, en pièce jointe (PDF) : qui nous sommes, ce que nous proposons, à qui, et comment nous travaillons.\n\n` +
    `N'hésitez pas à me faire signe pour toute question.\n\n` +
    (senderName ? `${senderName}\n` : '');

  try {
    await sendEmailForUser(user_id, to, subject, body, {
      emailType: 'transactional',
      attachment: {
        filename: `profil-entreprise-${sanitizeForFilename(company.name || 'meet-aaron')}-${now.toISOString().slice(0, 10)}.pdf`,
        contentBase64: pdf.toString('base64'),
        mimeType: 'application/pdf',
      },
    });
  } catch (err: any) {
    console.error('Erreur partage profil entreprise:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Impossible d'envoyer l'email — vérifie que ta boîte email est bien connectée" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
