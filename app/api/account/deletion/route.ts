// app/api/account/deletion/route.ts
// "Supprimer mon compte" self-service (app/app/connexions/page.jsx, 4e onglet
// "Mon compte"), demande d'Alex (2026-08-25) : avertissement -> confirmation
// par saisie exacte -> "êtes-vous certain ?" -> suppression réelle 24h plus
// tard (jamais immédiate, pour laisser le temps de changer d'avis).
//
// GET    -> état actuel (une suppression est-elle programmée, et pour quand).
// POST   -> programme la suppression pour dans 24h (idempotent : un appel
//           répété ne redémarre PAS le délai, voir plus bas).
// DELETE -> annule une suppression programmée (garde-fou pas explicitement
//           demandé par Alex mais évident à offrir : se raviser doit rester
//           possible tant que les 24h ne sont pas écoulées).
//
// L'exécution réelle (résiliation Stripe incluse) est déléguée à
// lib/account-deletion.ts, appelée par app/api/cron/execute-account-deletions
// une fois deletion_scheduled_for dépassé — jamais depuis cette route, pour
// que le délai de 24h soit une vraie garantie et pas une simple mention dans
// le texte affiché.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';

const DELAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('deletion_requested_at, deletion_scheduled_for')
    .eq('id', authedUser.id)
    .maybeSingle();

  if (error || !user) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  return NextResponse.json({
    requested: !!user.deletion_scheduled_for,
    requested_at: user.deletion_requested_at,
    scheduled_for: user.deletion_scheduled_for,
  });
}

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('deletion_scheduled_for')
    .eq('id', authedUser.id)
    .maybeSingle();

  // Idempotent : si une suppression est déjà programmée, on renvoie
  // simplement l'échéance existante plutôt que de repousser le délai de 24h
  // à chaque nouvel appel (ex. l'utilisateur recharge la page pendant les
  // 24h et retombe sur l'écran "suppression programmée").
  if (existing?.deletion_scheduled_for) {
    return NextResponse.json({
      requested: true,
      scheduled_for: existing.deletion_scheduled_for,
    });
  }

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + DELAY_MS);

  const { error } = await supabaseAdmin
    .from('users')
    .update({
      deletion_requested_at: now.toISOString(),
      deletion_scheduled_for: scheduledFor.toISOString(),
    })
    .eq('id', authedUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requested: true, scheduled_for: scheduledFor.toISOString() });
}

export async function DELETE(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { error } = await supabaseAdmin
    .from('users')
    .update({ deletion_requested_at: null, deletion_scheduled_for: null })
    .eq('id', authedUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requested: false });
}
