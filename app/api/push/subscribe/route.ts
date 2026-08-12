// app/api/push/subscribe/route.ts
// POST   -> enregistre l'abonnement push créé par le navigateur du commercial
//           (voir components/PushNotificationManager.jsx).
// DELETE -> supprime un abonnement (désactivation depuis /app/preferences).
//
// Comme pour toutes les routes protégées : l'utilisateur qui possède
// l'abonnement est dérivé de la session vérifiée (getAuthedUser), jamais d'un
// user_id envoyé tel quel par le client — sinon n'importe qui aurait pu
// enregistrer son propre appareil pour recevoir les notifications d'un autre
// commercial, ou supprimer l'abonnement de quelqu'un d'autre.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Abonnement push invalide' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
    {
      user_id: authedUser.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: 'endpoint' }
  );

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
