// app/api/user/timezone/route.ts
// PATCH -> mémorise le fuseau horaire réel du commercial (users.timezone),
// tel que son navigateur le connaît (Intl.DateTimeFormat().resolvedOptions()
// .timeZone). Appelé en « fire and forget » par components/TimeZoneReporter.jsx
// au chargement de l'app.
//
// Pourquoi le navigateur et pas le pays de facturation : lib/user-timezone.ts
// sait déduire un fuseau du pays, mais seulement pour les pays qui n'en ont
// qu'un. L'Australie (Alex), les États-Unis, le Canada, le Brésil et la
// Russie en ont plusieurs — impossible de deviner. Le navigateur, lui, le
// sait exactement, et il suit le commercial quand il voyage.
//
// Sert au cron app/api/cron/send-results-reports : le rapport « d'hier » part
// à minuit CHEZ LE COMMERCIAL, pas à minuit UTC.
//
// Si migration_fuseau_horaire_rapports_2026-09-12.sql n'est pas encore jouée,
// la colonne n'existe pas (42703) : on répond quand même 200 avec
// stored:false, pour que le navigateur n'entre pas dans une boucle de
// nouvelles tentatives et que rien ne casse à l'écran.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { isValidTimeZone } from '@/lib/user-timezone';

export async function PATCH(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const body = await request.json().catch(() => ({}));
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';

  // On refuse tout ce qu'Intl ne reconnaît pas : la valeur finit dans un
  // Intl.DateTimeFormat côté cron, où une chaîne inventée ferait planter le
  // rapport de CE commercial (et de lui seul, mais quand même).
  if (!isValidTimeZone(timezone)) {
    return NextResponse.json({ error: 'Fuseau horaire invalide' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ timezone })
    .eq('id', authedUser.id);

  if (error) {
    if ((error as any).code === '42703') {
      return NextResponse.json({ success: true, stored: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, stored: true });
}
