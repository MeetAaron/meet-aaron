// app/api/prospects/[id]/testimonial/route.ts
// GET  -> renvoie la demande de témoignage déjà générée (mise en cache sur
//         prospects.testimonial_email_*, générée automatiquement quand un
//         client répond à un check-in avec une note promoteur, voir
//         app/api/cron/check-inbox), ou la génère à la volée si absente.
//         ?regenerate=1 force une nouvelle génération.
// POST -> envoie la demande de témoignage au client, au nom du commercial.
// Voir lib/aaron-customer.ts (generateTestimonialRequest) et app/app/customer/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateTestimonialRequest } from '@/lib/aaron-customer';
import { sendEmailForUser } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const forceRegenerate = request.nextUrl.searchParams.get('regenerate') === '1';

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, company_id, testimonial_email_subject, testimonial_email_body, testimonial_requested_at')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  if (!prospect.is_won) {
    return NextResponse.json({ error: "Ce prospect n'est pas (encore) un client gagné" }, { status: 400 });
  }

  if (!forceRegenerate && prospect.testimonial_email_subject) {
    return NextResponse.json({
      subject: prospect.testimonial_email_subject,
      body: prospect.testimonial_email_body,
      generated_at: prospect.testimonial_requested_at,
      cached: true,
    });
  }

  try {
    const request_ = await generateTestimonialRequest(prospectId);
    return NextResponse.json({ ...request_, generated_at: new Date().toISOString(), cached: false });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error('Erreur génération demande de témoignage:', err.message);
    return NextResponse.json({ error: 'Impossible de générer cette demande pour le moment.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, full_name, email, testimonial_email_subject, testimonial_email_body, testimonial_email_sent_at')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.testimonial_email_subject || !prospect.testimonial_email_body) {
    return NextResponse.json({ error: 'Aucune demande de témoignage générée.' }, { status: 400 });
  }

  if (prospect.testimonial_email_sent_at) {
    return NextResponse.json({ error: 'Cette demande a déjà été envoyée.' }, { status: 400 });
  }

  try {
    await sendEmailForUser(
      prospect.assigned_user_id,
      prospect.email,
      prospect.testimonial_email_subject,
      prospect.testimonial_email_body
    );
  } catch (err: any) {
    console.error('Erreur envoi demande de témoignage:', err.message);
    const message = err.message?.includes('Aucune boîte mail connectée')
      ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
      : "Erreur lors de l'envoi de l'email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const sentAt = new Date().toISOString();
  await supabaseAdmin.from('prospects').update({ testimonial_email_sent_at: sentAt }).eq('id', prospectId);

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
      body: prospect.testimonial_email_body,
    });
  }

  return NextResponse.json({ success: true, sent_at: sentAt });
}
