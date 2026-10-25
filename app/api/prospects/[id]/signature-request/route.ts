// app/api/prospects/[id]/signature-request/route.ts
// 25/10/2026 : le document signé est désormais LE DEVIS DÉPOSÉ PAR LE
// COMMERCIAL (PDF), plus un PDF fabriqué à partir du chiffrage d'Aaron —
// Aaron ne rédige pas de devis.
//
// POST -> envoie le devis (prospects.devis_*) en signature
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

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, assigned_user_id, company_id, full_name, email, devis_subject, devis_file_path, devis_file_name, devis_file_type,
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

  const p: any = prospect;
  if (!p.devis_file_path) {
    return NextResponse.json({ error: "Dépose d'abord ton devis sur la fiche du contact." }, { status: 400 });
  }
  const isPdf = String(p.devis_file_type || '').toLowerCase().includes('pdf') || /\.pdf$/i.test(String(p.devis_file_name || ''));
  if (!isPdf) {
    return NextResponse.json({ error: 'Pour la signature électronique, dépose ton devis au format PDF.' }, { status: 400 });
  }

  if (prospect.signature_external_link) {
    return NextResponse.json({ error: 'Une demande de signature est déjà en cours pour ce prospect.' }, { status: 400 });
  }

  if (!prospect.email) {
    return NextResponse.json({ error: "Ce prospect n'a pas d'adresse email renseignée." }, { status: 400 });
  }

  const { data: blob, error: dlError } = await supabaseAdmin.storage.from('documents').download(p.devis_file_path);
  if (dlError || !blob) {
    return NextResponse.json({ error: 'Impossible de récupérer le fichier du devis — redépose-le.' }, { status: 500 });
  }
  const pdfBuffer = Buffer.from(await blob.arrayBuffer());

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ') || firstName || prospect.email;

  let result;
  try {
    result = await createSignatureRequest({
      requestName: String(prospect.devis_subject || p.devis_file_name || 'Devis').slice(0, 120),
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
