// app/api/cron/customer-checkin-digest/route.ts
// Exécuté une fois par semaine via Vercel Cron. Complète
// app/api/cron/customer-checkins (qui envoie les sollicitations) : ici on
// agrège les RÉPONSES reçues sur les 7 derniers jours et on envoie une
// synthèse au commercial concerné (docx CLIENTS A1, "check-ins de
// satisfaction" — "synthèse des retours pour le fondateur/commercial").
// Un seul email par commercial, même s'il a plusieurs clients qui ont
// répondu cette semaine ; rien n'est envoyé à un commercial sans réponse à
// synthétiser (pas de bruit inutile).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';

const DIGEST_WINDOW_DAYS = 7;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: checkins, error } = await supabaseAdmin
    .from('customer_checkins')
    .select(
      `id, type, response_score, response_comment, responded_at,
       prospects ( id, full_name, assigned_user_id, users ( id, full_name, email ), prospect_companies ( name ) )`
    )
    .not('responded_at', 'is', null)
    .gte('responded_at', since);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    score: number | null;
    comment: string | null;
    clientName: string;
    companyName: string | null;
  };

  const byUser: Record<string, { user: { id: string; full_name: string; email: string }; rows: Row[] }> = {};

  for (const checkin of checkins || []) {
    const prospect = (checkin as any).prospects;
    const user = prospect?.users;
    if (!prospect || !user || !user.email) continue;

    if (!byUser[user.id]) {
      byUser[user.id] = { user, rows: [] };
    }
    byUser[user.id].rows.push({
      score: checkin.response_score,
      comment: checkin.response_comment,
      clientName: prospect.full_name,
      companyName: prospect.prospect_companies?.name || null,
    });
  }

  let sent = 0;

  for (const userId of Object.keys(byUser)) {
    try {
      const { user, rows } = byUser[userId];
      const scored = rows.filter((r) => r.score !== null) as (Row & { score: number })[];
      const promoters = scored.filter((r) => r.score >= 9).length;
      const passives = scored.filter((r) => r.score >= 7 && r.score <= 8).length;
      const detractors = scored.filter((r) => r.score <= 6).length;
      const avgScore = scored.length > 0 ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length : null;

      const lines: string[] = [];
      lines.push(`${rows.length} réponse(s) client cette semaine.`);
      if (avgScore !== null) {
        lines.push(`Note moyenne : ${avgScore.toFixed(1)}/10 (${promoters} promoteur(s), ${passives} neutre(s), ${detractors} détracteur(s)).`);
      }
      lines.push('');

      for (const row of rows) {
        const label = row.companyName ? `${row.clientName} (${row.companyName})` : row.clientName;
        const scoreLabel = row.score !== null ? `${row.score}/10` : 'sans note';
        lines.push(`- ${label} — ${scoreLabel}${row.comment ? ` : "${row.comment}"` : ''}`);
      }

      const subject = `Synthèse satisfaction client — ${rows.length} réponse(s) cette semaine`;
      await sendEmailForUser(user.id, user.email, subject, lines.join('\n'));
      sent++;
    } catch (err: any) {
      // Un échec pour UN commercial ne doit pas bloquer les autres synthèses.
      console.error(`Erreur envoi synthèse check-ins pour user ${userId}:`, err.message);
    }
  }

  return NextResponse.json({ sent });
}
