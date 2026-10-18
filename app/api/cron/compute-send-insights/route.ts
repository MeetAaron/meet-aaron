// app/api/cron/compute-send-insights/route.ts
// Hebdomadaire (lundi 03:00 UTC, voir vercel.json) : recalcule pour chaque
// commercial ses taux de réponse par créneau d'envoi et son créneau appris —
// voir lib/send-insights.ts. Lecture seule sur messages/conversations/
// prospects, écriture dans send_insights. Sans la migration
// migration_apprentissage_envois_2026-10-18.sql, l'écriture est ignorée
// (table absente) et tout continue avec le créneau par défaut.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeSendInsightsForUser, saveSendInsights } from '@/lib/send-insights';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  // ?user_id= pour recalculer un seul compte (test, ou après un gros import).
  const only = request.nextUrl.searchParams.get('user_id');
  let q = supabaseAdmin.from('users').select('id').not('email', 'is', null);
  if (only) q = q.eq('id', only);
  const { data: users, error } = await q;
  if (error) return serverError(error, '/api/cron/compute-send-insights');

  const results: { user_id: string; sample_size?: number; learned?: boolean; error?: string }[] = [];
  for (const u of users || []) {
    try {
      const ins = await computeSendInsightsForUser(u.id);
      const saved = await saveSendInsights(ins);
      if (saved.error === 'table_missing') {
        return NextResponse.json({ error: 'Table send_insights absente — jouer migration_apprentissage_envois_2026-10-18.sql', computed: results.length });
      }
      results.push({ user_id: u.id, sample_size: ins.sample_size, learned: !!ins.learned_window, error: saved.error });
    } catch (err: any) {
      results.push({ user_id: u.id, error: err?.message || String(err) });
    }
  }
  return NextResponse.json({ computed: results.length, results });
}
