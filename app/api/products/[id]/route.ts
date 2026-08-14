// app/api/products/[id]/route.ts
// PATCH  -> modifie un produit du catalogue (nom, prix, description, actif...)
// DELETE -> désactive un produit (soft delete — on garde la ligne pour ne pas
//           casser l'historique des devis qui le référencent déjà)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

async function loadProductCompanyId(productId: string): Promise<string | null> {
  const { data: product } = await supabaseAdmin.from('products').select('company_id').eq('id', productId).maybeSingle();
  return product?.company_id || null;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const productCompanyId = await loadProductCompanyId(params.id);
  if (!productCompanyId || productCompanyId !== authedUser.company_id) return forbiddenResponse();

  const body = await request.json();
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  if (body.reference !== undefined) updates.reference = body.reference || null;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description || null;
  if (body.category !== undefined) updates.category = body.category || null;
  if (body.unit !== undefined) updates.unit = body.unit || 'unité';
  if (body.is_active !== undefined) updates.is_active = !!body.is_active;
  if (body.unit_price_eur !== undefined) {
    const priceNumber = Number(body.unit_price_eur);
    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      return NextResponse.json({ error: 'Prix unitaire invalide' }, { status: 400 });
    }
    updates.unit_price_eur = priceNumber;
  }

  const { data: product, error } = await supabaseAdmin
    .from('products')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const productCompanyId = await loadProductCompanyId(params.id);
  if (!productCompanyId || productCompanyId !== authedUser.company_id) return forbiddenResponse();

  const { error } = await supabaseAdmin.from('products').update({ is_active: false }).eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
