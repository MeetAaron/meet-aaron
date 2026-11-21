// app/api/social/connections/route.ts
//
// GET    -> les réseaux liés de la société (nom du compte seulement, jamais
//           les jetons).
// DELETE -> ?provider=tiktok : délie le réseau (retire l'accès côté réseau
//           quand c'est possible, puis supprime la ligne).
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { decryptToken } from '@/lib/encryption';
import { socialPreviewAllowed } from '@/lib/social-access';
import { revokeTiktokToken } from '@/lib/social-tiktok';
import { revokeLinkedinToken } from '@/lib/social-linkedin';
import { revokeMetaPermissions } from '@/lib/social-meta';

const PROVIDERS = ['tiktok', 'linkedin', 'facebook', 'instagram'];

// Table absente tant que migration_social_connections_2026-11-19.sql n'est
// pas passée : PostgREST répond PGRST205, Postgres 42P01.
function tableMissing(error: any): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('social_connections')
    .select('provider, account_name, updated_at')
    .eq('company_id', authedUser.company_id);
  if (error) {
    if (tableMissing(error)) return NextResponse.json({ connections: [], migration_missing: true });
    console.error('[social] lecture des liaisons :', error.code || '', error.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  return NextResponse.json({ connections: data || [] });
}

export async function DELETE(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const provider = request.nextUrl.searchParams.get('provider') || '';
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: 'provider_invalide' }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from('social_connections')
    .select('id, access_token')
    .eq('company_id', authedUser.company_id)
    .eq('provider', provider)
    .maybeSingle();
  if (!row) return NextResponse.json({ success: true });

  if (provider === 'tiktok') {
    try {
      await revokeTiktokToken(decryptToken((row as any).access_token));
    } catch {
      // Jeton illisible ou TikTok injoignable : on délie quand même chez nous.
    }
  }
  if (provider === 'linkedin') {
    try {
      await revokeLinkedinToken(decryptToken((row as any).access_token));
    } catch {
      // Idem : on délie chez nous même si LinkedIn ne répond pas.
    }
  }

  // Facebook et Instagram partagent la même autorisation Meta : délier
  // l'un délie les deux (21/11/2026).
  if (provider === 'facebook' || provider === 'instagram') {
    try {
      await revokeMetaPermissions(decryptToken((row as any).access_token));
    } catch {
      // Meta injoignable : on délie quand même chez nous.
    }
    const { error: metaErr } = await supabaseAdmin
      .from('social_connections')
      .delete()
      .eq('company_id', authedUser.company_id)
      .in('provider', ['facebook', 'instagram']);
    if (metaErr) return NextResponse.json({ error: 'server_error' }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const { error } = await supabaseAdmin.from('social_connections').delete().eq('id', (row as any).id);
  if (error) {
    console.error('[social] suppression de la liaison :', error.code || '', error.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
