// app/api/preferences/route.ts
// GET   -> lit les préférences actuelles du commercial + le niveau de collaboration de sa société
// PATCH -> met à jour ses préférences (canal de notif, délai avant RDV, niveau de collaboration)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('full_name, email, notify_channel, notify_before_appointment_minutes, company_id')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('collaboration_level')
    .eq('id', user.company_id)
    .single();

  return NextResponse.json({
    preferences: {
      ...user,
      collaboration_level: company?.collaboration_level ?? 0,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user_id, notify_channel, notify_before_appointment_minutes, collaboration_level } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (notify_channel) updates.notify_channel = notify_channel;
  if (notify_before_appointment_minutes) updates.notify_before_appointment_minutes = notify_before_appointment_minutes;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from('users').update(updates).eq('id', user_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (collaboration_level !== undefined) {
    const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
    if (user) {
      await supabaseAdmin
        .from('companies')
        .update({ collaboration_level })
        .eq('id', user.company_id);
    }
  }

  return NextResponse.json({ success: true });
}
