// app/api/prospects/[id]/devis/route.ts
// GET  -> renvoie le devis déjà généré (mis en cache sur prospects.devis_*),
//         ou le génère à la volée. ?regenerate=1 force une nouvelle
//         génération. [id] = id du PROSPECT.
// POST -> envoie l'email d'accompagnement du devis au prospect, au nom du
//         commercial, et fait avancer l'étape du pipeline à "devis_envoye"
//         si l'affaire n'est pas déjà plus avancée (signé/perdu/négociation).
// Voir lib/aaron-sales.ts (generateDevis) et app/app/sales/page.jsx.
//
// Le récapitulatif (devis_recap) est chiffré poste par poste UNIQUEMENT
// quand une correspondance fiable a été trouvée dans le catalogue produits
// de la société (table `products`) — sinon le prix reste à null, à
// compléter par le commercial avant l'envoi (voir la note affichée côté UI).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateDevis, summarizeDevisRecap, DevisLineItem } from '@/lib/aaron-sales';
import { sendEmailForUser } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

const STAGES_AT_LEAST_DEVIS = ['devis_envoye', 'en_negociation', 'signe', 'perdu'];

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const forceRegenerate = request.nextUrl.searchParams.get('regenerate') === '1';

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id, devis_subject, devis_body, devis_recap, devis_generated_at')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  if (!forceRegenerate && prospect.devis_subject) {
    const recapitulatif = (prospect.devis_recap || []) as DevisLineItem[];
    const { total_eur, a_des_postes_sans_prix } = summarizeDevisRecap(recapitulatif);
    return NextResponse.json({
      objet: prospect.devis_subject,
      corps_email: prospect.devis_body,
      recapitulatif,
      total_eur,
      a_des_postes_sans_prix,
      generated_at: prospect.devis_generated_at,
      cached: true,
    });
  }

  try {
    const devis = await generateDevis(prospectId);
    return NextResponse.json({ ...devis, generated_at: new Date().toISOString(), cached: false });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error('Erreur génération devis:', err.message);
    return NextResponse.json({ error: 'Impossible de générer le devis pour le moment.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  // Lot 3 « Devis » : objet/corps modifiés par le commercial avant envoi
  // (optionnels) — sinon la version préparée par Aaron.
  let override: { subject?: string; body?: string } = {};
  try {
    const raw = await request.text();
    if (raw) override = JSON.parse(raw);
  } catch {}

  // devis_file_* : devis déposé par le commercial (migration_devis_upload_
  // 2026-09-01.sql), envoyé en pièce jointe. Colonnes optionnelles tant que
  // la migration n'est pas passée → deuxième lecture sans elles sur 42703.
  let res: any = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, full_name, email, deal_stage, devis_subject, devis_body, devis_recap, devis_sent_at, devis_file_path, devis_file_name, devis_file_type')
    .eq('id', prospectId)
    .single();
  if (res.error && res.error.code === '42703') {
    res = await supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, full_name, email, deal_stage, devis_subject, devis_body, devis_recap, devis_sent_at')
      .eq('id', prospectId)
      .single();
  }
  const prospect: any = res.data;
  const error = res.error;

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.devis_subject || !prospect.devis_body) {
    return NextResponse.json({ error: "Aucun devis généré — génère d'abord le devis." }, { status: 400 });
  }

  if (prospect.devis_sent_at) {
    return NextResponse.json({ error: 'Ce devis a déjà été envoyé.' }, { status: 400 });
  }

  const recap = (prospect.devis_recap || []) as DevisLineItem[];
  const formatRecapLine = (r: DevisLineItem) => {
    const quantitySuffix = r.quantite && r.quantite !== 1 ? ` × ${r.quantite}` : '';
    const priceSuffix = r.total_ligne_eur != null ? ` — ${r.total_ligne_eur.toFixed(2)} €` : '';
    return `- ${r.poste}${quantitySuffix} : ${r.description}${priceSuffix}`;
  };
  const { total_eur: recapTotalEur } = summarizeDevisRecap(recap);
  const totalLine = recapTotalEur != null ? `\nTotal : ${recapTotalEur.toFixed(2)} €` : '';
  const recapText = recap.length
    ? '\n\n---\nRécapitulatif :\n' + recap.map(formatRecapLine).join('\n') + totalLine
    : '';

  const finalSubject = (typeof override.subject === 'string' && override.subject.trim()) || prospect.devis_subject;
  const finalBody = (typeof override.body === 'string' && override.body.trim()) || prospect.devis_body;

  // Pièce jointe : le devis déposé par le commercial, lu depuis le Storage.
  let attachment: { filename: string; contentBase64: string; mimeType: string } | undefined;
  const filePath = (prospect as any).devis_file_path as string | undefined;
  if (filePath) {
    const { data: blob, error: dlError } = await supabaseAdmin.storage.from('documents').download(filePath);
    if (dlError || !blob) {
      return NextResponse.json({ error: 'Impossible de récupérer le fichier du devis — redépose-le.' }, { status: 500 });
    }
    attachment = {
      filename: (prospect as any).devis_file_name || 'devis.pdf',
      contentBase64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
      mimeType: (prospect as any).devis_file_type || 'application/pdf',
    };
  }

  try {
    await sendEmailForUser(prospect.assigned_user_id, prospect.email, finalSubject, `${finalBody}${recapText}`, attachment ? { attachment } : undefined);
  } catch (err: any) {
    console.error("Erreur envoi devis:", err.message);
    const message = err.message?.includes('Aucune boîte mail connectée')
      ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
      : "Erreur lors de l'envoi de l'email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const sentAt = new Date().toISOString();
  const update: Record<string, any> = { devis_sent_at: sentAt, devis_subject: finalSubject, devis_body: finalBody };

  // Ne fait avancer le pipeline que si l'affaire n'est pas déjà à une étape
  // au moins aussi avancée (évite de reculer une affaire déjà en négociation
  // ou signée si le commercial renvoie un devis après coup).
  if (!prospect.deal_stage || !STAGES_AT_LEAST_DEVIS.includes(prospect.deal_stage)) {
    update.deal_stage = 'devis_envoye';
    update.deal_stage_updated_at = sentAt;
  }

  await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospectId)
    .eq('channel', 'email')
    .maybeSingle();

  if (conversation) {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      sender_email: '',
      recipient_email: prospect.email,
      body: `${finalBody}${recapText}`,
    });
  }

  return NextResponse.json({ success: true, sent_at: sentAt, deal_stage: update.deal_stage || prospect.deal_stage });
}
