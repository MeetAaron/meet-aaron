// app/api/prospects/[id]/devis/upload/route.ts
// POST (multipart : file, user_id) -> Lot 3 « Devis » (docx « mon avis »
// d'Alex, 31/08/2026) : le commercial dépose SON devis (PDF/Word) sur la
// fiche contact. Aaron lit le document, vérifie que c'est bien adressé à ce
// client (nom / société), relève le montant, et rédige l'email
// d'accompagnement — que le commercial pourra relire/modifier puis envoyer
// (POST ../devis, avec le fichier en pièce jointe).
//
// Le fichier est stocké dans le bucket Storage « documents » (même bucket que
// Mes documents), sous <company_id>/devis/. Les colonnes devis_file_* et
// devis_check viennent de migration_devis_upload_2026-09-01.sql.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { extractDocumentText } from '@/lib/document-extraction';
import { sanitizeFilenameForStorageKey } from '@/lib/storage-key';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const BUCKET = 'documents';
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Fichier trop lourd (15 Mo max)' }, { status: 400 });
  }

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id, full_name, email, job_title, personality_type, personality_notes, devis_sent_at, prospect_companies(name)')
    .eq('id', prospectId)
    .single();
  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${prospect.company_id}/devis/${prospectId}-${Date.now()}-${sanitizeFilenameForStorageKey(file.name)}`;
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Lecture du document (PDF, Word, texte) — extrait limité pour les tokens.
  let extracted: string | null = null;
  try {
    extracted = await extractDocumentText(buffer, file.type);
  } catch {}

  const companyName = (prospect as any).prospect_companies?.name || '';
  const { data: user } = await supabaseAdmin.from('users').select('full_name, locale').eq('id', authedUser.id).maybeSingle();

  // Vérification + email d'accompagnement en un seul appel (JSON strict).
  let check: Record<string, any> = { matches_prospect: null, detected_client: null, detected_company: null, total_ttc_eur: null, reason: extracted ? null : 'Document illisible (image scannée ?) — vérification impossible, je te fais confiance.' };
  let emailSubject = `Votre devis — ${companyName || prospect.full_name}`;
  let emailBody = `Bonjour ${prospect.full_name},\n\nComme convenu, vous trouverez ci-joint notre proposition.\n\nJe reste à votre disposition pour toute question ou ajustement.\n\nBien à vous,\n${user?.full_name || ''}`;

  if (extracted) {
    try {
      const data = await callClaude(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 700,
          messages: [
            {
              role: 'user',
              content:
                `Tu es Aaron, copilote commercial IA. Le commercial "${user?.full_name || ''}" vient de déposer un devis (fichier "${file.name}") destiné au contact "${prospect.full_name}"` +
                (companyName ? ` de la société "${companyName}"` : '') +
                (prospect.job_title ? ` (${prospect.job_title})` : '') +
                `.\n\nTexte extrait du devis :\n"""\n${extracted.slice(0, 3500)}\n"""\n\n` +
                `1. Vérifie que ce devis est bien adressé à CE contact / CETTE société (compare les noms, tolère les variantes d'orthographe et raisons sociales). ` +
                `2. Relève le montant total TTC en euros s'il apparaît (nombre, sans symbole ; null sinon). ` +
                `3. Rédige l'email d'accompagnement que le commercial enverra avec le devis en pièce jointe : court (5 à 8 lignes), chaleureux, vouvoiement, qui rappelle en une phrase ce que couvre la proposition, invite à échanger, et se termine par une formule de politesse puis le prénom/nom du commercial. ` +
                (prospect.personality_type ? `Adapte le ton au profil DISC ressenti du contact : ${prospect.personality_type}${prospect.personality_notes ? ` (${prospect.personality_notes.slice(0, 200)})` : ''}. ` : '') +
                `Rédige l'email ${localeInstruction(user?.locale)}.\n\n` +
                `Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de la forme :\n` +
                `{"matches_prospect": true|false, "detected_client": "nom lu sur le devis ou null", "detected_company": "société lue ou null", "total_ttc_eur": 1234.56|null, "reason": "1 phrase en français expliquant la vérification", "email_subject": "…", "email_body": "…"}`,
            },
          ],
        },
        prospect.company_id,
        'as'
      );
      const text = data.content.find((b: any) => b.type === 'text')?.text || '';
      const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const parsed = JSON.parse(jsonText);
      check = {
        matches_prospect: typeof parsed.matches_prospect === 'boolean' ? parsed.matches_prospect : null,
        detected_client: parsed.detected_client || null,
        detected_company: parsed.detected_company || null,
        total_ttc_eur: typeof parsed.total_ttc_eur === 'number' ? parsed.total_ttc_eur : null,
        reason: parsed.reason || null,
      };
      if (parsed.email_subject) emailSubject = String(parsed.email_subject).trim();
      if (parsed.email_body) emailBody = String(parsed.email_body).trim();
    } catch (err: any) {
      if (err instanceof MonthlyCapExceededError) {
        check.reason = 'Plafond API atteint — vérification impossible ce mois-ci, email générique proposé.';
      } else {
        console.error('Erreur vérification devis déposé:', err.message);
        check.reason = "Je n'ai pas réussi à analyser le devis — vérifie toi-même qu'il est bien adressé à ce contact.";
      }
    }
  }

  const now = new Date().toISOString();
  const update: Record<string, any> = {
    devis_file_path: storagePath,
    devis_file_name: file.name,
    devis_file_type: file.type || 'application/octet-stream',
    devis_uploaded_at: now,
    devis_check: check,
    devis_subject: emailSubject,
    devis_body: emailBody,
    devis_recap: null, // le devis déposé remplace la proposition chiffrée générée
    devis_generated_at: now,
    devis_sent_at: null, // nouveau devis → nouvel envoi possible (devis corrigé)
  };
  const { error: updateError } = await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);
  if (updateError) {
    if (updateError.code === '42703') {
      return NextResponse.json({ error: "Lance d'abord la migration migration_devis_upload_2026-09-01.sql" }, { status: 500 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, check, email_subject: emailSubject, email_body: emailBody, file_name: file.name });
}
