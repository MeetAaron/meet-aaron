// app/api/team/results/route.ts
// GET -> pour un fondateur/patron, tableau complet de TOUS les prospects,
// opportunités et clients de la société (tous commerciaux confondus), pour
// le 2ᵉ onglet "Résultats détaillés" de Mon équipe (item 2 du docx) —
// exportable en CSV/XLS côté client (app/app/team/page.jsx).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

const DEAL_STAGE_LABELS: Record<string, string> = {
  rdv_fait: 'RDV fait',
  devis_envoye: 'Devis envoyé',
  en_negociation: 'En négociation',
  signe: 'Signé',
  perdu: 'Perdu',
};

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
    .select('company_id, role')
    .eq('id', userId)
    .single();

  if (!requester) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }
  if (requester.role !== 'patron') {
    return NextResponse.json({ error: "Réservé au fondateur/patron de l'entreprise" }, { status: 403 });
  }

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, full_name')
    .eq('company_id', requester.company_id);

  const memberIds = (members || []).map((m: any) => m.id);
  const nameByMember: Record<string, string> = {};
  for (const m of members || []) nameByMember[m.id] = m.full_name;

  if (memberIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, assigned_user_id, created_at, updated_at, deal_stage, deal_stage_updated_at,
       is_won, won_at, is_lost, lost_at, first_order_confirmed_at,
       prospect_companies(name)`
    )
    .in('assigned_user_id', memberIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Une seule ligne par prospect, catégorisée Prospect / Opportunité / Client
  // — même logique de catégorisation que app/app/prospects/page.jsx (item 12)
  // et lib/team-stats.ts, pour rester cohérent avec les chiffres du 1er onglet.
  const rows = (prospects || []).map((p: any) => {
    const companyName = p.prospect_companies?.name || '';
    const commercial = nameByMember[p.assigned_user_id] || '';
    const isClient = !!p.first_order_confirmed_at;

    if (isClient) {
      return {
        type: 'client',
        name: p.full_name,
        company: companyName,
        commercial,
        status: p.is_lost ? 'Client perdu' : 'Client actif',
        date: p.won_at,
      };
    }

    if (p.deal_stage) {
      return {
        type: 'opportunite',
        name: p.full_name,
        company: companyName,
        commercial,
        status: DEAL_STAGE_LABELS[p.deal_stage] || p.deal_stage,
        date: p.deal_stage_updated_at,
      };
    }

    return {
      type: 'prospect',
      name: p.full_name,
      company: companyName,
      commercial,
      status: p.is_lost ? 'Perdu' : p.is_won ? 'Gagné (en attente de 1ère commande)' : 'Actif',
      date: p.created_at || p.updated_at,
    };
  });

  return NextResponse.json({ rows });
}
