// app/api/customers/[id]/onboarding/route.ts
// GET  -> renvoie le plan d'onboarding + l'email de bienvenue déjà générés
//         (mis en cache sur prospects.onboarding_plan / welcome_email_*), ou
//         les génère à la volée si absents. ?regenerate=1 force une nouvelle
//         génération. [id] = id du PROSPECT (client gagné), pas d'un RDV.
// POST -> envoie l'email de bienvenue déjà généré au client, au nom du
//         commercial. Étape de validation explicite, même logique que
//         l'envoi de la relance post-RDV d'Aaron Sales.
// Voir lib/aaron-customer.ts (generateOnboarding) et app/app/customer/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateOnboarding } from '@/lib/aaron-customer';
import { sendEmailForUser } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;
  const forceRegenerate = request.nextUrl.searchParams.get('regenerate') === '1';

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, company_id, onboarding_plan, onboarding_generated_at, welcome_email_subject, welcome_email_body')
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

  if (!forceRegenerate && prospect.onboarding_plan) {
    return NextResponse.json({
      plan: prospect.onboarding_plan,
      welcome_email: { subject: prospect.welcome_email_subject, body: prospect.welcome_email_body },
      generated_at: prospect.onboarding_generated_at,
      cached: true,
    });
  }

  try {
    const result = await generateOnboarding(prospectId);
    return NextResponse.json({ ...result, generated_at: new Date().toISOString(), cached: false });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error("Erreur génération plan d'onboarding:", err.message);
    return NextResponse.json({ error: "Impossible de générer le plan d'onboarding pour le moment." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, full_name, email, welcome_email_subject, welcome_email_body, welcome_email_sent_at')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.is_won) {
    return NextResponse.json({ error: "Ce prospect n'est pas (encore) un client gagné" }, { status: 400 });
  }

  if (!prospect.welcome_email_subject || !prospect.welcome_email_body) {
    return NextResponse.json({ error: "Aucun email de bienvenue généré — génère d'abord le plan d'onboarding." }, { status: 400 });
  }

  if (prospect.welcome_email_sent_at) {
    return NextResponse.json({ error: 'Cet email de bienvenue a déjà été envoyé.' }, { status: 400 });
  }

  try {
    await sendEmailForUser(prospect.assigned_user_id, prospect.email, prospect.welcome_email_subject, prospect.welcome_email_body);
  } catch (err: any) {
    console.error("Erreur envoi email de bienvenue:", err.message);
    const message = err.message?.includes('Aucune boîte mail connectée')
      ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
      : "Erreur lors de l'envoi de l'email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const sentAt = new Date().toISOString();
  await supabaseAdmin.from('prospects').update({ welcome_email_sent_at: sentAt }).eq('id', prospectId);

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
      body: prospect.welcome_email_body,
    });
  }

  return NextResponse.json({ success: true, sent_at: sentAt });
}
