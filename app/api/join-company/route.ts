// app/api/join-company/route.ts
// POST -> un commercial rejoint la société d'un patron déjà abonné, via un code
// (pas de paiement : la société est déjà abonnée via Stripe).
//
// Deux types de code acceptés depuis le 28/08/2026 (abonnements équipes,
// voir migration_team_seats_2026-08-28.sql) :
//  - un code de SIÈGE (team_seats.activation_code, format "SIEGE-XXXXXXXX")
//    -> rattache le commercial à CE siège précis (team_seats.user_id,
//    status -> 'active'), et à la société propriétaire du siège.
//  - l'ancien code SOCIÉTÉ (companies.invite_code) -> toujours accepté pour
//    compatibilité (codes déjà transmis avant ce lot), mais plus affiché
//    dans l'app (voir app/app/team/page.jsx) : les nouveaux comptes équipe
//    passent tous par un code de siège.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody, serverError } from '@/lib/http';
import { checkRateLimit, callerKey, tooManyRequestsResponse } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const { first_name, full_name, invite_code } = await readJsonBody(request);

  if (!first_name || !full_name || !invite_code) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }
  const code = invite_code.trim().toUpperCase();

  // auth_user_id et email proviennent du token vérifié, jamais du corps de la
  // requête — sinon n'importe qui connaissant l'UUID Supabase Auth d'une autre
  // personne pourrait rattacher SON compte à une société via un simple code
  // d'invitation (même faille que /api/auth/link avant correctif).
  const identity = await getAuthedIdentity(request);
  if (!identity) return unauthorizedResponse();
  const { auth_user_id, email } = identity;

  // ANTI-FORCE BRUTE SUR LES CODES (CASA 1.1.1, 23/10/2026). Un code donne
  // accès aux données d'une société : sans limite, un compte fraîchement
  // créé pouvait essayer des codes en boucle. 5 essais par compte et 20 par
  // adresse IP toutes les 15 minutes, comptés AVANT toute lecture en base ;
  // au-delà, 429 au message générique (voir lib/rate-limit.ts).
  const perAccount = checkRateLimit(`join-company:user:${auth_user_id}`, 5, 15 * 60 * 1000);
  if (!perAccount.ok) return tooManyRequestsResponse(perAccount.retryAfterSeconds) as any;
  const perIp = checkRateLimit(callerKey(request, 'join-company'), 20, 15 * 60 * 1000);
  if (!perIp.ok) return tooManyRequestsResponse(perIp.retryAfterSeconds) as any;

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Ce compte est déjà rattaché à une société' }, { status: 409 });
  }

  // Un code de siège ("SIEGE-XXXXXXXX") est prioritaire sur l'ancien code
  // société : le format généré par generateSeatActivationCode ne collisionne
  // jamais avec generateInviteCode (préfixe fixe "SIEGE" vs nom de société).
  const { data: seat } = await supabaseAdmin
    .from('team_seats')
    .select('id, company_id, status, companies(id, name)')
    .eq('activation_code', code)
    .maybeSingle();

  if (seat) {
    if (seat.status === 'cancelled') {
      return NextResponse.json({ error: 'Ce compte équipe a été annulé. Contactez votre responsable.' }, { status: 410 });
    }
    if (seat.status === 'active') {
      return NextResponse.json({ error: 'Ce code a déjà été utilisé. Contactez votre responsable si ce n\'est pas vous.' }, { status: 409 });
    }

    const company = (seat as any).companies;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        auth_user_id,
        email,
        first_name,
        full_name,
        role: 'commercial',
        company_id: seat.company_id,
        notify_channel: 'both',
      })
      .select('id, company_id, first_name, full_name, role')
      .single();

    if (error) {
      return serverError(error, '/api/join-company');
    }

    const { error: seatError } = await supabaseAdmin
      .from('team_seats')
      .update({ user_id: user.id, status: 'active', activated_at: new Date().toISOString() })
      .eq('id', seat.id);

    if (seatError) {
      // Le compte utilisateur existe déjà à ce stade (mieux vaut un
      // rattachement de siège manquant, corrigeable par le support, qu'un
      // compte commercial jamais créé après un paiement déjà engagé côté
      // Stripe pour ce siège).
      console.error(`Rattachement siège ${seat.id} au user ${user.id} a échoué`, seatError.message);
    }

    return NextResponse.json({ user, company_name: company?.name });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('invite_code', code)
    .maybeSingle();

  if (!company) {
    return NextResponse.json({ error: 'Code d\'invitation invalide. Vérifiez-le auprès de votre responsable.' }, { status: 404 });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      auth_user_id,
      email,
      first_name,
      full_name,
      role: 'commercial',
      company_id: company.id,
      // Par défaut, un nouveau compte reçoit les notifications par email ET
      // push (RDV proposé par un client, RDV annulé, etc.) — modifiable
      // ensuite dans Préférences.
      notify_channel: 'both',
    })
    .select('id, company_id, first_name, full_name, role')
    .single();

  if (error) {
    return serverError(error, '/api/join-company');
  }

  return NextResponse.json({ user, company_name: company.name });
}
