// app/api/reply-rate/route.ts
// GET -> taux de réponse réel des prospects contactés par ce commercial :
// % de prospects ayant reçu au moins un email sortant qui ont répondu au
// moins une fois. Métrique manquante jusqu'ici dans Résultats (qui ne
// montrait que des comptages et le taux prospects→RDV) — le taux de réponse
// est l'une des métriques les plus demandées sur les outils de prospection
// IA (mesure la qualité de l'accroche, pas juste le volume envoyé).
//
// CHANGEMENTS A FAIRE #88 (2026-08-15) : accepte désormais un paramètre
// optionnel `since` (date ISO) pour rendre le taux de réponse sensible au
// sélecteur de période de la page Résultats — seuls les messages envoyés/
// reçus depuis cette date comptent alors dans le calcul (un prospect
// contacté puis relancé pendant la période choisie compte, mais un vieil
// échange antérieur à la période n'est plus pris en compte).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const since = request.nextUrl.searchParams.get('since'); // date ISO, optionnel

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Plafond défensif : cette route est appelée à chaque chargement de la page
  // Résultats (métrique, pas un export exhaustif) — sans limite, un compte
  // avec un très gros historique ferait une requête de plus en plus lourde
  // au fil du temps. 2000 prospects les plus récents suffit largement pour
  // une estimation représentative du taux de réponse actuel.
  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, conversations(messages(direction, created_at))')
    .eq('assigned_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sinceDate = since ? new Date(since) : null;

  let contacted = 0;
  let replied = 0;

  for (const p of prospects || []) {
    let allMessages = ((p as any).conversations || []).flatMap((c: any) => c.messages || []);
    if (sinceDate) {
      allMessages = allMessages.filter((m: any) => m.created_at && new Date(m.created_at) >= sinceDate);
    }
    const hasOutbound = allMessages.some((m: any) => m.direction === 'outbound');
    if (!hasOutbound) continue;
    contacted += 1;
    const hasInbound = allMessages.some((m: any) => m.direction === 'inbound');
    if (hasInbound) replied += 1;
  }

  const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;

  return NextResponse.json({ contacted, replied, reply_rate: replyRate });
}
