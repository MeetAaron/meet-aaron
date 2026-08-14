// app/api/prospects/route.ts
// GET  -> liste les prospects du commercial connecté
// POST -> crée un nouveau prospect, détecte/crée sa "prospect_company" via le domaine
//         email, puis déclenche le tout premier message d'Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser } from '@/lib/messaging';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain)')
    .eq('assigned_user_id', userId)
    // Reste visible tant qu'aucune 1ère commande n'est confirmée — un
    // prospect "gagné" (is_won=true) mais sans commande confirmée reste donc
    // ici sous le badge "🏆 Gagné — en attente de 1ère commande" au lieu de
    // disparaître immédiatement vers Clients (voir
    // migration_first_order_confirmed_2026-08-14.sql).
    .is('first_order_confirmed_at', null)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ prospects });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { company_id, assigned_user_id, full_name, email, phone, job_title, company_name, linkedin_url } = body;

  if (!company_id || !assigned_user_id || !full_name || !email) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== assigned_user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  const domain = email.split('@')[1];
  const cleanCompanyName = company_name?.trim() || null;

  // Cherche ou crée la prospect_company associée à ce domaine
  let { data: prospectCompany } = await supabaseAdmin
    .from('prospect_companies')
    .select('id, name')
    .eq('company_id', company_id)
    .eq('domain', domain)
    .single();

  if (!prospectCompany) {
    const { data: newCompany, error: companyError } = await supabaseAdmin
      .from('prospect_companies')
      .insert({ company_id, domain, name: cleanCompanyName })
      .select('id, name')
      .single();

    if (companyError) {
      return NextResponse.json({ error: companyError.message }, { status: 500 });
    }
    prospectCompany = newCompany;
  } else if (cleanCompanyName && !prospectCompany.name) {
    // La société existait déjà (autre prospect sur le même domaine) mais sans nom connu :
    // on complète avec ce que le commercial vient de renseigner.
    await supabaseAdmin.from('prospect_companies').update({ name: cleanCompanyName }).eq('id', prospectCompany.id);
  }

  // Crée le prospect
  const { data: prospect, error: prospectError } = await supabaseAdmin
    .from('prospects')
    .insert({
      company_id,
      assigned_user_id,
      prospect_company_id: prospectCompany.id,
      full_name,
      email,
      phone,
      job_title,
      linkedin_url: linkedin_url?.trim() || null,
      status: 'jaune',
    })
    .select()
    .single();

  if (prospectError) {
    return NextResponse.json({ error: prospectError.message }, { status: 500 });
  }

  // Crée la conversation associée
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .insert({ prospect_id: prospect.id, channel: 'email' })
    .select()
    .single();

  // Le prospect est créé à ce stade quoi qu'il arrive : si la génération du
  // premier message ou l'envoi d'email échoue (ex: le commercial n'a pas
  // encore connecté sa boîte mail dans "Connexions"), on ne casse pas la
  // création du prospect — on le renvoie avec un avertissement exploitable
  // par le frontend plutôt qu'une 500 sans rollback.
  let aaronOutput = null;
  let emailWarning = null;

  try {
    // Récupère l'email réel du commercial pour l'enregistrer comme expéditeur
    const { data: sender } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', assigned_user_id)
      .single();

    aaronOutput = await generateAaronResponse(prospect.id);

    // Envoie l'email au nom du commercial (Gmail ou Outlook selon ce qu'il a connecté)
    await sendEmailForUser(assigned_user_id, email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body);

    // Enregistre le message envoyé
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation!.id,
      direction: 'outbound',
      sender_email: sender?.email || null,
      recipient_email: email,
      body: aaronOutput.email_draft.body,
    });

    // Met à jour le statut/personnalité détectés
    await supabaseAdmin
      .from('prospects')
      .update({
        status: aaronOutput.prospect_status,
        personality_type: aaronOutput.personality_type,
        personality_notes: aaronOutput.personality_notes,
        aaron_advice: aaronOutput.aaron_advice,
      })
      .eq('id', prospect.id);
  } catch (err: any) {
    console.error('Erreur génération/envoi du premier message prospect:', err.message);
    emailWarning =
      err.message?.includes('Aucune boîte mail connectée')
        ? "Prospect ajouté, mais aucun email n'a été envoyé : connectez votre boîte mail dans \"Connexions\"."
        : "Prospect ajouté, mais le premier message n'a pas pu être envoyé automatiquement.";
  }

  return NextResponse.json({ prospect, aaronOutput, emailWarning });
}
