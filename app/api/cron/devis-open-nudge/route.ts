// app/api/cron/devis-open-nudge/route.ts
// Toutes les 5 minutes (vercel.json). Décision Alex (docx 08/11/2026) : si
// le devis a été ouvert il y a plus de 30 minutes et que le commercial n'a
// pas cliqué « Appel fait », on le relance UNE fois : « appelle quand même ».
// Fenêtre 30 min → 3 h : au-delà, la story du devis ouvert suffit, un push
// de plus ne ferait que du bruit. devis_open_nudge_at évite les doublons
// (migration_devis_open_nudge_2026-11-08.sql).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';
import { devisOpenTexts } from '@/lib/devis-open-texts';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const now = Date.now();
  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, full_name, devis_opened_at, devis_last_opened_at, users(locale)')
    .not('devis_opened_at', 'is', null)
    .is('devis_call_done_at', null)
    .is('devis_open_nudge_at', null)
    .lt('devis_opened_at', new Date(now - 30 * 60 * 1000).toISOString())
    .gt('devis_opened_at', new Date(now - 3 * 3600 * 1000).toISOString());
  if (error) {
    // Colonne absente (migration pas passée) : on ne casse rien.
    console.error('[devis-open-nudge]', error.message);
    return NextResponse.json({ nudged: 0, error: error.message });
  }

  let nudged = 0;
  for (const p of (prospects || []) as any[]) {
    try {
      const minutes = Math.round((now - new Date(p.devis_opened_at).getTime()) / 60000);
      const T = devisOpenTexts(p.users?.locale);
      const { error: upErr } = await supabaseAdmin.from('prospects').update({ devis_open_nudge_at: new Date().toISOString() }).eq('id', p.id).is('devis_open_nudge_at', null);
      if (upErr) continue;
      await sendPushNotification(p.assigned_user_id, {
        title: T.nudgeTitle.replace('{name}', p.full_name || ''),
        body: T.nudgeBody.replace('{minutes}', String(minutes)),
        url: `/app/prospects?contact=${p.id}`,
        tag: `devis_ouvert:${p.id}`,
      });
      nudged++;
    } catch (err: any) {
      console.error(`[devis-open-nudge] ${p.id}:`, err?.message || err);
    }
  }
  return NextResponse.json({ nudged });
}
