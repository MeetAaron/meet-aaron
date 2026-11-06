// app/api/deliverability-test/route.ts
//
// Test de délivrabilité réel du commercial connecté (06/11/2026, voir
// lib/deliverability-test.ts).
//   GET   ?user_id=…           → dernier test (relu chez les témoins s'il est en cours)
//   POST  { user_id }          → lance un nouveau test (bouton « Tester » / « Retester »)
//   PATCH { user_id, action }  → 'retester' (nouveau test) ou 'ignorer' (continuer
//                                malgré un verdict négatif — choix explicite du
//                                commercial, consigné par acknowledged_at)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { readJsonBody } from '@/lib/http';
import {
  latestTestFor,
  pollDeliverabilityTest,
  startDeliverabilityTest,
  summarizeTest,
} from '@/lib/deliverability-test';

async function authed(request: NextRequest, userId: string | null) {
  if (!userId) return { error: NextResponse.json({ error: 'user_id manquant' }, { status: 400 }) };
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return { error: unauthorizedResponse() };
  if (authedUser.id !== userId) return { error: forbiddenResponse() };
  return { user: authedUser };
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const a = await authed(request, userId);
  if ('error' in a) return a.error;
  let test = await latestTestFor(userId!);
  if (test && test.verdict === 'en_attente') test = await pollDeliverabilityTest(test);
  return NextResponse.json({ test: summarizeTest(test) });
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const userId = body?.user_id ? String(body.user_id) : null;
  const a = await authed(request, userId);
  if ('error' in a) return a.error;
  const current = await latestTestFor(userId!);
  if (current && current.verdict === 'en_attente') {
    return NextResponse.json({ test: summarizeTest(await pollDeliverabilityTest(current)) });
  }
  const test = await startDeliverabilityTest(userId!);
  if (!test) return NextResponse.json({ error: 'Test impossible à lancer' }, { status: 500 });
  return NextResponse.json({ test: summarizeTest(test) });
}

export async function PATCH(request: NextRequest) {
  const body = await readJsonBody(request);
  const userId = body?.user_id ? String(body.user_id) : null;
  const a = await authed(request, userId);
  if ('error' in a) return a.error;
  const action = String(body?.action || '');
  const current = await latestTestFor(userId!);
  if (action === 'ignorer') {
    if (current && !current.acknowledged_at) {
      await supabaseAdmin
        .from('deliverability_tests')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', current.id);
    }
    return NextResponse.json({ ok: true });
  }
  if (action === 'retester') {
    if (current && current.verdict === 'en_attente') {
      return NextResponse.json({ test: summarizeTest(await pollDeliverabilityTest(current)) });
    }
    const test = await startDeliverabilityTest(userId!);
    if (!test) return NextResponse.json({ error: 'Test impossible à lancer' }, { status: 500 });
    return NextResponse.json({ test: summarizeTest(test) });
  }
  return NextResponse.json({ error: 'action inconnue' }, { status: 400 });
}
