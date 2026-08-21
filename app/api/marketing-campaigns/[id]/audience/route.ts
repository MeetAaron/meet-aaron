// app/api/marketing-campaigns/[id]/audience/route.ts
// GET -> aperçu de l'audience correspondant au filtre actuel de la campagne
//        (sans rien figer) — permet au commercial de voir "23 clients"
//        avant de lancer quoi que ce soit.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { resolveAudience } from '@/lib/marketing-audience';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: campaign } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', params.id).single();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  try {
    const prospects = await resolveAudience(campaign);
    return NextResponse.json({
      count: prospects.length,
      sample: prospects.slice(0, 20).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        customer_health_label: p.customer_health_label,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
