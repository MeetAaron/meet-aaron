// app/api/prospects/[id]/signature-request/route.ts
// POST -> envoie le devis déjà généré (prospects.devis_*) en signature
// électronique via Youtrust (docx "OPPORTUNITES A4" : "tu me mets en place
// yousign ? fais le merci" — Yousign a changé de nom pour Youtrust en 2026,
// voir lib/youtrust.ts). Construit un PDF du devis (lib/devis-pdf.ts),
// l'envoie à Youtrust qui gère l'envoi de l'email au prospect et
// l'interface de signature, puis stocke le lien de signature retourné dans
// prospects.signature_external_link — RÉUTILISE le même champ que le flux
// manuel existant ("coller un lien de signature généré ailleurs"), donc le
// reste de l'UI (app/app/sales/page.jsx) n'a besoin d'aucune adaptation
// pour l'affichage du lien lui-même.
//
// Le passage effectif à "signé" (is_won, deal_stage) se fait plus tard,
// quand Youtrust notifie la signature réelle via webhook — voir
// app/api/webhooks/youtrust/route.ts. Cette route-ci ne fait qu'ENVOYER la
// demande.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { createSignatureRequest } from '@/lib/youtrust';
import { buildDevisPdf } from '@/lib/devis-pdf';
import { DevisLineItem, summarizeDevisRecap } from '@/lib/aaron-sales';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, assigned_user_id, company_id, full_name, email, devis_subject, devis_body, devis_recap,
       signature_external_link, prospect_companies (name), users (locale)`
    )
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.devis_subject || !prospect.devis_recap) {
    return NextResponse.json({ error: "Aucun devis généré — génère d'abord le devis avant de l'envoyer en signature." }, { status: 400 });
  }

  if (prospect.signature_external_link) {
    return NextResponse.json({ error: 'Une demande de signature est déjà en cours pour ce prospect.' }, { status: 400 });
  }

  if (!prospect.email) {
    return NextResponse.json({ error: "Ce prospect n'a pas d'adresse email renseignée." }, { status: 400 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const recapitulatif = (prospect.devis_recap || []) as DevisLineItem[];
  const { total_eur, a_des_postes_sans_prix } = summarizeDevisRecap(recapitulatif);

  const pdfBuffer = await buildDevisPdf(
    { objet: prospect.devis_subject, corps_email: prospect.devis_body || '', recapitulatif, total_eur, a_des_postes_sans_prix },
    {
      prospectName: prospect.full_name,
      prospectCompany: (prospect as any).prospect_companies?.name || null,
      sellerCompanyName: company?.name || null,
    }
  );

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ') || firstName || prospect.email;

  let result;
  try {
    result = await createSignatureRequest({
      requestName: prospect.devis_subject.slice(0, 120),
      pdfBuffer,
      pdfFilename: `devis-${prospect.full_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`,
      signerFirstName: firstName || prospect.full_name,
      signerLastName: lastName,
      signerEmail: prospect.email,
      locale: (prospect as any).users?.locale,
    });
  } catch (err: any) {
    console.error(`Erreur envoi signature Youtrust pour prospect ${prospectId}:`, err.message);
    return NextResponse.json({ error: err.message || "Échec de l'envoi en signature électronique." }, { status: 502 });
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from('prospects')
    .update({
      signature_external_link: result.signatureLink,
      signature_requested_at: now,
      youtrust_signature_request_id: result.signatureRequestId,
      signature_status: 'en_attente',
    })
    .eq('id', prospectId);

  return NextResponse.json({ success: true, signature_link: result.signatureLink });
}
