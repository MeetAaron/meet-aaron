// app/api/notifications/route.ts
// GET ?user_id= -> les notifications « stories » du commercial connecté,
// regroupées par type et triées par urgence (voir lib/notifications.ts).
// Utilisé par components/Stories.jsx (tableau de bord, Prospects) et par la
// cloche du rail d'icônes (components/NotificationBell.jsx) sur les autres pages.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { buildNotifications, countNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  try {
    const groups = await buildNotifications(userId);
    return NextResponse.json({ groups, total: countNotifications(groups) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
