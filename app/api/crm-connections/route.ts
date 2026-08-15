// app/api/crm-connections/route.ts
// GET    -> statut de la connexion CRM de la société (HubSpot pour l'instant)
// DELETE -> déconnecte le CRM (réservé au patron)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!authedUser.company_id) return NextResponse.json({ connections: [] });

  const { data: connections } = await supabaseAdmin
    .from('crm_connections')
    .select('provider, portal_id, connected_at')
    .eq('company_id', authedUser.company_id);

  return NextResponse.json({ connections: connections || [] });
}

export async function DELETE(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get('provider');
  if (!provider) return NextResponse.json({ error: 'provider manquant' }, { status: 400 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) return NextResponse.json({ error: 'Aucune société associée' }, { status: 400 });

  await supabaseAdmin
    .from('crm_connections')
    .delete()
    .eq('company_id', authedUser.company_id)
    .eq('provider', provider);

  return NextResponse.json({ success: true });
}
