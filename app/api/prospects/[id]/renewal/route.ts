// app/api/prospects/[id]/renewal/route.ts
// GET  -> renvoie l'email de relance de renouvellement déjà généré (mis en
//         cache sur prospects.renewal_email_*, généré automatiquement par le
//         cron app/api/cron/renewal-reminders), ou le génère à la volée si
//         absent. ?regenerate=1 force une nouvelle génération.
// POST -> envoie l'email de renouvellement au client, au nom du commercial.
// Voir lib/aaron-customer.ts (generateRenewalOutreach) et app/app/customer/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateRenewalOutreach } from '@/lib/aaron-customer';
import { sendEmailForUser } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const forceRegenerate = request.nextUrl.searchParams.get('regenerate') === '1';

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, company_id, renewal_email_subject, renewal_email_body')
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

  if (!forceRegenerate && prospect.renewal_email_subject) {
    return NextResponse.json({ subject: prospect.renewal_email_subject, body: prospect.renewal_email_body, cached: true });
  }

  try {
    const outreach = await generateRenewalOutreach(prospectId);
    await supabaseAdmin
      .from('prospects')
      .update({ renewal_email_subject: outreach.subject, renewal_email_body: outreach.body })
      .eq('id', prospectId);
    return NextResponse.json({ ...outreach, cached: false });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error('Erreur génération email de renouvellement:', err.message);
    return NextResponse.json({ error: 'Impossible de générer cet email pour le moment.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, full_name, email, renewal_email_subject, renewal_email_body, renewal_email_sent_at')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.renewal_email_subject || !prospect.renewal_email_body) {
    return NextResponse.json({ error: "Aucun email de renouvellement généré." }, { status: 400 });
  }

  if (prospect.renewal_email_sent_at) {
    return NextResponse.json({ error: 'Cet email a déjà été envoyé.' }, { status: 400 });
  }

  try {
    await sendEmailForUser(prospect.assigned_user_id, prospect.email, prospect.renewal_email_subject, prospect.renewal_email_body);
  } catch (err: any) {
    console.error('Erreur envoi email de renouvellement:', err.message);
    const message = err.message?.includes('Aucune boîte mail connectée')
      ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
      : "Erreur lors de l'envoi de l'email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const sentAt = new Date().toISOString();
  await supabaseAdmin.from('prospects').update({ renewal_email_sent_at: sentAt }).eq('id', prospectId);

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
      body: prospect.renewal_email_body,
    });
  }

  return NextResponse.json({ success: true, sent_at: sentAt });
}
