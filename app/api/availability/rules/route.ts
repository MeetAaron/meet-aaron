// app/api/availability/rules/route.ts
// POST -> crée une règle de disponibilité récurrente (ex: "lundi 9h-12h, tous types de RDV").

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { user_id, day_of_week, start_time, end_time, appointment_type } = await request.json();

  if (user_id === undefined || day_of_week === undefined || !start_time || !end_time) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  if (day_of_week < 0 || day_of_week > 6) {
    return NextResponse.json({ error: 'day_of_week doit être compris entre 0 (dimanche) et 6 (samedi)' }, { status: 400 });
  }

  if (start_time >= end_time) {
    return NextResponse.json({ error: "L'heure de fin doit être après l'heure de début" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('availability_rules')
    .insert({
      user_id,
      day_of_week,
      start_time,
      end_time,
      appointment_type: appointment_type || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}
