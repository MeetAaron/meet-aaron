// app/api/preferences/route.ts
// GET   -> lit les préférences actuelles du commercial
// PATCH -> met à jour ses préférences (canal de notif, délai avant RDV)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('full_name, email, notify_channel, notify_before_appointment_minutes')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  return NextResponse.json({ preferences: user });
}

export async function PATCH(request: NextRequest) {
  const { user_id, notify_channel, notify_before_appointment_minutes } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (notify_channel) updates.notify_channel = notify_channel;
  if (notify_before_appointment_minutes) updates.notify_before_appointment_minutes = notify_before_appointment_minutes;

  const { error } = await supabaseAdmin.from('users').update(updates).eq('id', user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
