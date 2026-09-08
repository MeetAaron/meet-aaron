// app/api/diagnostics/outlook/route.ts
// GET ?user_id=…[&target=…][&fix=1][&list=1] → diagnostic complet de la boîte
// Outlook connectée (voir lib/outlook-diagnostics.ts). Affiché par
// /app/diagnostic-outlook.
//
// - Par défaut, le commercial diagnostique SA boîte.
// - Le patron peut diagnostiquer la boîte d'un membre de SON entreprise
//   (`target`) — c'est le cas d'usage réel : le fondateur teste une boîte
//   Outlook rattachée à un autre siège.
// - `list=1` (patron) : membres de l'entreprise avec leurs fournisseurs
//   connectés, pour choisir la cible.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { runOutlookDiagnostics } from '@/lib/outlook-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: requester } = await supabaseAdmin
    .from('users')
    .select('id, company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (!requester) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const isPatron = requester.role === 'patron';

  if (request.nextUrl.searchParams.get('list') === '1') {
    if (!isPatron) return forbiddenResponse();
    const { data: members } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role')
      .eq('company_id', requester.company_id)
      .order('created_at', { ascending: true });
    const ids = (members || []).map((m: any) => m.id);
    const { data: conns } = ids.length
      ? await supabaseAdmin.from('oauth_connections').select('user_id, provider, provider_account_email').in('user_id', ids)
      : { data: [] as any[] };
    return NextResponse.json({
      members: (members || []).map((m: any) => ({
        ...m,
        connections: (conns || []).filter((c: any) => c.user_id === m.id).map((c: any) => ({ provider: c.provider, email: c.provider_account_email })),
      })),
    });
  }

  let target = request.nextUrl.searchParams.get('target') || userId;
  if (target !== userId) {
    if (!isPatron) return forbiddenResponse();
    const { data: targetUser } = await supabaseAdmin.from('users').select('id, company_id').eq('id', target).maybeSingle();
    if (!targetUser || targetUser.company_id !== requester.company_id) return forbiddenResponse();
    target = targetUser.id;
  }

  const fix = request.nextUrl.searchParams.get('fix') === '1';
  try {
    const report = await runOutlookDiagnostics(target, { fix });
    return NextResponse.json({ target_user_id: target, ...report });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
