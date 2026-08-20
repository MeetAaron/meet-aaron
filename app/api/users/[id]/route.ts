// app/api/users/[id]/route.ts
// GET   -> renvoie les infos de base d'un utilisateur (utilisé par le frontend pour
//          récupérer son company_id, nécessaire à la création de campagnes/prospects)
// PATCH -> modifie le nom affiché de l'utilisateur (docx C1, "Mon compte" ->
//          "mon profil", 2026-08-20). Volontairement limité à full_name/first_name :
//          changer l'email ou le mot de passe touche à Supabase Auth (ré-
//          vérification, session à invalider, etc.) et n'est pas quelque chose
//          qu'on devine ici sans un flux dédié — l'utilisateur ne peut modifier
//          que son propre profil (pas celui d'un collègue).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== params.id) return forbiddenResponse();

  const update: Record<string, any> = {};
  if (typeof body.full_name === 'string') {
    const fullName = body.full_name.trim().slice(0, 200);
    if (!fullName) {
      return NextResponse.json({ error: 'Le nom ne peut pas être vide' }, { status: 400 });
    }
    update.full_name = fullName;
    // first_name reste utilisé ailleurs (emails, salutations) — on garde les
    // deux synchronisés en prenant le premier mot du nom complet.
    update.first_name = fullName.split(' ')[0];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('users')
    .update(update)
    .eq('id', params.id)
    .select('id, company_id, first_name, full_name, email, role')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: updated });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, company_id, first_name, full_name, email, role')
    .eq('id', params.id)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user.id && authedUser.company_id !== user.company_id) return forbiddenResponse();

  return NextResponse.json({ user });
}
