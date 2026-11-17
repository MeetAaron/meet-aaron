// app/api/push/test/route.ts
// POST — notification d'essai sur TOUS les appareils de la personne connectée
// (17/11/2026, Alex : « les notifications fonctionnent avec les 2 applis ? »).
// Le bouton « Envoyer une notification d'essai » (components/
// PushNotificationManager.jsx) l'appelle ; la réponse dit, appareil par
// appareil (iPhone, Android, navigateur), si l'envoi est parti.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { sendPushNotification } from '@/lib/push';
import { checkRateLimit, tooManyRequestsResponse } from '@/lib/rate-limit';

const TEXT: Record<string, { title: string; body: string }> = {
  fr: { title: 'Notification d’essai', body: 'Les notifications de Meet Aaron arrivent bien sur cet appareil.' },
  en: { title: 'Test notification', body: 'Meet Aaron notifications are reaching this device.' },
  de: { title: 'Testbenachrichtigung', body: 'Benachrichtigungen von Meet Aaron kommen auf diesem Gerät an.' },
  it: { title: 'Notifica di prova', body: 'Le notifiche di Meet Aaron arrivano su questo dispositivo.' },
  es: { title: 'Notificación de prueba', body: 'Las notificaciones de Meet Aaron llegan a este dispositivo.' },
  pt: { title: 'Notificação de teste', body: 'As notificações do Meet Aaron chegam a este dispositivo.' },
  nl: { title: 'Testmelding', body: 'Meldingen van Meet Aaron komen aan op dit apparaat.' },
};

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorizedResponse();
  const limit = await checkRateLimit(`push-test:${user.id}`, 5, 10 * 60 * 1000);
  if (!limit.ok) return tooManyRequestsResponse(limit.retryAfterSeconds);
  const T = TEXT[String(user.locale || 'fr')] || TEXT.fr;
  const results = await sendPushNotification(user.id, { title: T.title, body: T.body, url: '/app/campaigns', tag: 'essai' } as any);
  return NextResponse.json({ devices: results.length, results });
}
