// app/api/products/route.ts
// GET  -> liste le catalogue produits/tarifs de la société du commercial
//         (utilisé par Aaron pour chiffrer un devis, et par la page Produits)
// POST -> ajoute un produit/tarif au catalogue

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('company_id', user.company_id)
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: products || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, reference, name, description, category, unit, unit_price_eur } = body;

  if (!user_id || !name || unit_price_eur === undefined || unit_price_eur === null || unit_price_eur === '') {
    return NextResponse.json({ error: 'Champs requis manquants (nom, prix unitaire)' }, { status: 400 });
  }

  const priceNumber = Number(unit_price_eur);
  if (Number.isNaN(priceNumber) || priceNumber < 0) {
    return NextResponse.json({ error: 'Prix unitaire invalide' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: product, error } = await supabaseAdmin
    .from('products')
    .insert({
      company_id: user.company_id,
      reference: reference || null,
      name,
      description: description || null,
      category: category || null,
      unit: unit || 'unité',
      unit_price_eur: priceNumber,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product });
}
