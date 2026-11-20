// app/api/social/campaigns/route.ts
//
// AARON SOCIAL — préparation d'une campagne (20/11/2026).
// GET  -> la dernière campagne de la société et ses posts.
// POST -> crée une campagne vide (statut « preparation »). L'écran lance
//         ensuite les 4 familles de posts, une requête chacune :
//         /api/social/campaigns/[id]/category (lib/social-posts.ts).
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).
// Rien n'est publié sur les réseaux à ce stade.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { socialPreviewAllowed } from '@/lib/social-access';

export const runtime = 'nodejs';


function tableMissing(error: any): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

// Une préparation abandonnée (écran fermé avant la fin) ne doit pas bloquer
// la suivante : au-delà de 10 minutes, on la considère en échec.
const STUCK_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: campaign, error } = await supabaseAdmin
    .from('social_campaigns')
    .select('id, status, locale, error, created_at, updated_at')
    .eq('company_id', authedUser.company_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return NextResponse.json({ campaign: null, posts: [], migration_missing: true });
    console.error('[social] lecture de la campagne :', error.code || '', error.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  if (!campaign) return NextResponse.json({ campaign: null, posts: [] });

  let current: any = campaign;
  if (current.status === 'preparation' && Date.now() - new Date(current.created_at).getTime() > STUCK_MS) {
    await supabaseAdmin.from('social_campaigns').update({ status: 'erreur', error: 'timeout', updated_at: new Date().toISOString() }).eq('id', current.id);
    current = { ...current, status: 'erreur', error: 'timeout' };
  }

  const { data: posts } = await supabaseAdmin
    .from('social_posts')
    .select('id, week, slot, category, subject, material_needed, material_hint, content, status')
    .eq('campaign_id', current.id)
    .order('week', { ascending: true })
    .order('slot', { ascending: true });

  return NextResponse.json({ campaign: current, posts: posts || [] });
}

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const companyId = authedUser.company_id;

  // Une seule préparation à la fois par société.
  const { data: running, error: readError } = await supabaseAdmin
    .from('social_campaigns')
    .select('id, created_at')
    .eq('company_id', companyId)
    .eq('status', 'preparation')
    .limit(1)
    .maybeSingle();
  if (readError) {
    if (tableMissing(readError)) return NextResponse.json({ error: 'migration_missing' }, { status: 409 });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  if (running && Date.now() - new Date((running as any).created_at).getTime() < STUCK_MS) {
    return NextResponse.json({ campaign_id: (running as any).id, already_running: true });
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('social_campaigns')
    .insert({ company_id: companyId, created_by: authedUser.id, status: 'preparation', locale: authedUser.locale || 'fr' })
    .select('id')
    .single();
  if (createError || !created) {
    if (tableMissing(createError)) return NextResponse.json({ error: 'migration_missing' }, { status: 409 });
    console.error('[social] création de la campagne :', createError?.code || '', createError?.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  const campaignId = (created as any).id as string;

  return NextResponse.json({ campaign_id: campaignId });
}
