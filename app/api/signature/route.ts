// app/api/signature/route.ts
// GET    -> lit la signature email enregistrée pour le commercial
// PATCH  -> enregistre la signature (après relecture/correction manuelle)
// POST   -> tente de détecter automatiquement une signature à partir du
//           dernier email envoyé (Gmail uniquement pour l'instant) — ne
//           l'enregistre PAS, la renvoie juste pour relecture côté UI.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { getLastSentGmailBodyText } from '@/lib/google';
import { guessEmailSignature } from '@/lib/signature';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('email_signature').eq('id', userId).single();

  return NextResponse.json({ signature: user?.email_signature || null });
}

export async function PATCH(request: NextRequest) {
  const { user_id, signature } = await request.json();

  if (!user_id || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { error } = await supabaseAdmin
    .from('users')
    .update({ email_signature: signature.trim() || null })
    .eq('id', user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: connection } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider')
    .eq('user_id', user_id)
    .eq('provider', 'google')
    .maybeSingle();

  if (!connection) {
    return NextResponse.json(
      { error: "Détection automatique disponible uniquement pour Gmail — connectez votre compte Google, ou saisissez votre signature manuellement." },
      { status: 400 }
    );
  }

  try {
    const bodyText = await getLastSentGmailBodyText(user_id);
    const guess = guessEmailSignature(bodyText);

    if (!guess) {
      return NextResponse.json(
        { error: "Aucune signature détectée dans votre dernier email envoyé — saisissez-la manuellement ci-dessous.", signature: null },
        { status: 200 }
      );
    }

    return NextResponse.json({ signature: guess });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur lors de la détection' }, { status: 500 });
  }
}
