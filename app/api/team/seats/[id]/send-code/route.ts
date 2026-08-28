// app/api/team/seats/[id]/send-code/route.ts
// POST -> Aaron envoie au commercial l'email contenant son code d'activation
// de compte équipe (voir bouton "Envoyer par email" dans l'onglet
// "Abonnement équipes"). Envoyé depuis la boîte mail du FONDATEUR (comme
// tous les emails "gérés par Aaron" existants) — échoue si le fondateur n'a
// aucune boîte mail connectée, voir lib/messaging.ts.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { sendEmailForUser } from '@/lib/messaging';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const { data: seat } = await supabaseAdmin
    .from('team_seats')
    .select('id, first_name, last_name, email, activation_code, status')
    .eq('id', params.id)
    .eq('company_id', authedUser.company_id)
    .maybeSingle();

  if (!seat) return NextResponse.json({ error: 'Compte équipe introuvable' }, { status: 404 });
  if (seat.status === 'cancelled') {
    return NextResponse.json({ error: 'Ce compte équipe est annulé — impossible d\'envoyer son code.' }, { status: 400 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', authedUser.company_id)
    .single();

  const origin = request.nextUrl.origin;
  const subject = `Ton accès Meet Aaron chez ${company?.name || 'ta société'}`;
  const body =
    `Bonjour ${seat.first_name},\n\n` +
    `${company?.name || 'Ton entreprise'} t'a créé un accès à Meet Aaron, ton copilote commercial IA.\n\n` +
    `Pour l'activer, rends-toi sur ${origin}/onboarding, choisis "J'ai un code d'activation de mon entreprise" et renseigne ce code :\n\n` +
    `${seat.activation_code}\n\n` +
    `À très vite,\nAaron`;

  try {
    await sendEmailForUser(authedUser.id, seat.email, subject, body, { emailType: 'transactional' });
  } catch (err: any) {
    console.error(`Envoi code activation siège ${params.id} a échoué`, err.message);
    const message = /aucune bo(i|î)te mail/i.test(err.message)
      ? "Impossible d'envoyer l'email : connecte d'abord ta boîte Gmail ou Outlook dans Connexions."
      : `Impossible d'envoyer l'email : ${err.message}`;
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('team_seats')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('id', params.id);

  if (updateError) {
    console.error(`Email envoyé (siège ${params.id}) mais mise à jour email_sent_at échouée`, updateError.message);
  }

  return NextResponse.json({ success: true });
}
