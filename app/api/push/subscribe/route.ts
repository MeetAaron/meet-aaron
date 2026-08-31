// app/api/push/subscribe/route.ts
// GET    -> liste les appareils (abonnements push) du commercial connecté,
//           pour la checklist « Mise en route » de Mon compte > Connexion
//           (docx Modifs Aaron 30/08/2026 : "2 lignes dédiées pour la
//           notification push : ordinateur et téléphone" — on sait dire
//           « activées sur ton téléphone ✓ » depuis l'ordinateur, et
//           inversement, grâce au user-agent mémorisé à l'abonnement).
// POST   -> enregistre l'abonnement push créé par le navigateur du commercial
//           (voir components/PushNotificationManager.jsx).
// DELETE -> supprime un abonnement (désactivation depuis Mon compte).
//
// Comme pour toutes les routes protégées : l'utilisateur qui possède
// l'abonnement est dérivé de la session vérifiée (getAuthedUser), jamais d'un
// user_id envoyé tel quel par le client — sinon n'importe qui aurait pu
// enregistrer son propre appareil pour recevoir les notifications d'un autre
// commercial, ou supprimer l'abonnement de quelqu'un d'autre.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';

// Colonne ajoutée par migration_push_user_agent_2026-08-31.sql. Tant que la
// migration n'a pas été exécutée, Postgres renvoie 42703 (undefined_column) :
// on réessaie alors sans la colonne plutôt que de casser l'activation des
// notifications — la checklist saura juste moins bien distinguer les
// appareils (voir GET).
const UNDEFINED_COLUMN = '42703';

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  // select('*') plutôt qu'une liste de colonnes : ne casse pas si la colonne
  // user_agent n'existe pas encore (elle est alors simplement absente).
  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', authedUser.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erreur lecture abonnements push:', error.message);
    return NextResponse.json({ error: 'Impossible de lire les appareils' }, { status: 500 });
  }

  // p256dh/auth sont des secrets de chiffrement : jamais renvoyés au client,
  // même à leur propriétaire (le navigateur n'en a pas besoin — il connaît
  // déjà son propre abonnement via pushManager.getSubscription()).
  const devices = (data || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    endpoint: row.endpoint,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    created_at: row.created_at,
  }));

  return NextResponse.json({ devices });
}

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Abonnement push invalide' }, { status: 400 });
  }

  const base = {
    user_id: authedUser.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500) || null;

  let { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ ...base, user_agent: userAgent }, { onConflict: 'endpoint' });

  if (error && error.code === UNDEFINED_COLUMN) {
    ({ error } = await supabaseAdmin.from('push_subscriptions').upsert(base, { onConflict: 'endpoint' }));
  }

  if (error) {
    console.error('Erreur enregistrement abonnement push:', error.message);
    return NextResponse.json({ error: "Impossible d'enregistrer l'abonnement" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { endpoint } = await request.json();
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint manquant' }, { status: 400 });
  }

  // .eq('user_id', ...) empêche de désabonner l'appareil de quelqu'un d'autre
  // même si son endpoint (unique mais non secret) était deviné.
  await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', authedUser.id);

  return NextResponse.json({ success: true });
}
