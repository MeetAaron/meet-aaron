// app/api/users/[id]/route.ts
// GET -> renvoie les infos de base d'un utilisateur (utilisé par le frontend pour
// récupérer son company_id, nécessaire à la création de campagnes/prospects)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

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
