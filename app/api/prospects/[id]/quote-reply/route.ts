// app/api/prospects/[id]/quote-reply/route.ts
// Lot 3 « Devis » (docx « mon avis » d'Alex, 31/08/2026) — bouton
// « Répondre » sur la notification « Devis à faire » :
//   POST { action: 'draft_missing_info', details }  -> Aaron rédige l'email
//        qui demande au contact les infos manquantes (retourné, pas envoyé :
//        le commercial le relit / modifie).
//   POST { action: 'send', subject, body }           -> envoie cet email au
//        contact, le journalise dans la conversation, et met la relance
//        quotidienne en pause (quote_paused_at) jusqu'à sa réponse.
//   POST { action: 'pause' }                         -> « je lui écris
//        moi-même sous 24h » : pause seule.
// La pause est levée par app/api/cron/check-inbox à la prochaine réponse
// entrante du contact.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { sendEmailForUser } from '@/lib/messaging';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const { action, details, subject, body } = await request.json();

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id, full_name, email, job_title, personality_type, personality_notes, prospect_companies(name)')
    .eq('id', prospectId)
    .single();
  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  async function pause() {
    const { error: pauseError } = await supabaseAdmin.from('prospects').update({ quote_paused_at: new Date().toISOString() }).eq('id', prospectId);
    if (pauseError && pauseError.code === '42703') {
      throw new Error("Lance d'abord la migration migration_devis_upload_2026-09-01.sql");
    }
    if (pauseError) throw new Error(pauseError.message);
  }

  if (action === 'pause') {
    try {
      await pause();
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'draft_missing_info') {
    const info = typeof details === 'string' ? details.trim().slice(0, 1500) : '';
    if (!info) {
      return NextResponse.json({ error: 'Précise les infos qui te manquent.' }, { status: 400 });
    }
    const { data: user } = await supabaseAdmin.from('users').select('full_name, locale').eq('id', authedUser.id).maybeSingle();
    const companyName = (prospect as any).prospect_companies?.name || '';
    try {
      const data = await callClaude(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 600,
          messages: [
            {
              role: 'user',
              content:
                `Tu es Aaron, copilote commercial IA. Le contact "${prospect.full_name}"${companyName ? ` (${companyName})` : ''} a demandé un devis au commercial "${user?.full_name || ''}". ` +
                `Avant de chiffrer, il lui manque ces informations : "${info}".\n\n` +
                `Rédige l'email que le commercial va envoyer au contact pour les lui demander : court (4 à 7 lignes), chaleureux, vouvoiement, qui remercie pour la demande, liste clairement les points manquants (une ligne par point), précise que le devis partira dès réception, et se termine par une formule de politesse puis le prénom/nom du commercial. ` +
                (prospect.personality_type ? `Adapte le ton au profil DISC ressenti : ${prospect.personality_type}. ` : '') +
                `Rédige ${localeInstruction(user?.locale)}.\n\n` +
                `Réponds UNIQUEMENT avec un JSON valide : {"subject": "…", "body": "…"}`,
            },
          ],
        },
        prospect.company_id,
        'as'
      );
      const text = data.content.find((b: any) => b.type === 'text')?.text || '';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return NextResponse.json({ subject: String(parsed.subject || '').trim(), body: String(parsed.body || '').trim() });
    } catch (err: any) {
      if (err instanceof MonthlyCapExceededError) {
        return NextResponse.json({ error: 'Plafond API atteint ce mois-ci.' }, { status: 429 });
      }
      console.error('Erreur brouillon infos manquantes:', err.message);
      return NextResponse.json({ error: "Je n'ai pas réussi à rédiger l'email, réessaie." }, { status: 500 });
    }
  }

  if (action === 'send') {
    const finalSubject = typeof subject === 'string' ? subject.trim() : '';
    const finalBody = typeof body === 'string' ? body.trim() : '';
    if (!finalSubject || !finalBody) {
      return NextResponse.json({ error: 'Objet et message requis.' }, { status: 400 });
    }
    try {
      await sendEmailForUser(prospect.assigned_user_id, prospect.email, finalSubject, finalBody);
    } catch (err: any) {
      const message = err.message?.includes('Aucune boîte mail connectée')
        ? "Aucune boîte mail connectée — connecte Gmail ou Outlook dans Mon compte."
        : "Erreur lors de l'envoi de l'email.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const { data: conversation } = await supabaseAdmin.from('conversations').select('id').eq('prospect_id', prospectId).eq('channel', 'email').maybeSingle();
    if (conversation) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: '',
        recipient_email: prospect.email,
        body: finalBody,
      });
    }
    try {
      await pause();
    } catch (err: any) {
      // Email parti : la pause est un confort, pas une condition.
      console.error('Pause relance devis impossible:', err.message);
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
