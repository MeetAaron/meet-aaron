// app/api/prospects/[id]/devis/retour/route.ts
// GET -> lien temporaire (10 min) vers la copie du devis renvoyé par le
//        client en pièce jointe (signé ou annoté), gardée par Aaron — voir
//        lib/quote-return.ts. [id] = id du PROSPECT. Même contrôle d'accès
//        que le devis lui-même : le commercial assigné ou sa société.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { serverError } from '@/lib/http';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id, devis_return_file_path')
    .eq('id', params.id)
    .maybeSingle();
  if (error) {
    if (error.code === '42703') return NextResponse.json({ error: 'Aucun document' }, { status: 404 });
    return serverError(error, '/api/prospects/[id]/devis/retour');
  }
  if (!prospect) return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }
  const path = (prospect as any).devis_return_file_path as string | null;
  // Le chemin doit appartenir à la société du prospect (défense en profondeur).
  if (!path || !path.startsWith(`${prospect.company_id}/devis/retours/`)) {
    return NextResponse.json({ error: 'Aucun document' }, { status: 404 });
  }
  const { data: signed, error: signError } = await supabaseAdmin.storage.from('documents').createSignedUrl(path, 600);
  if (signError || !signed?.signedUrl) return serverError(signError || new Error('signed url'), '/api/prospects/[id]/devis/retour');
  return NextResponse.json({ url: signed.signedUrl });
}
