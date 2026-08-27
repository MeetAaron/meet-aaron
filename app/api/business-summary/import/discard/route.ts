// app/api/business-summary/import/discard/route.ts
// POST -> bouton "Ne pas analyser" (demande Alex, 27/08/2026) : efface le
// document importé en attente sans toucher au profil actif. Le profil de
// l'entreprise (companies.business_summary) reste strictement inchangé.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('companies')
    .update({
      business_summary_pending_text: null,
      business_summary_pending_file_name: null,
      business_summary_pending_uploaded_at: null,
      business_summary_pending_uploaded_by: null,
    })
    .eq('id', user.company_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
