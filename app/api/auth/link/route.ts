// app/api/auth/link/route.ts
// POST -> appelé juste après une connexion réussie via Supabase Auth (Google).
// Retrouve (ou refuse) le profil "users" Meet Aaron correspondant à l'email connecté,
// et lie définitivement auth_user_id à ce profil pour les prochaines connexions.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';

// CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : "A la fin de
// la durée de l'abonnement le client ne pourra plus accéder à rien. Il
// devra se réabonner avant de se connecter." — vérifié ici, au point d'entrée
// UNIQUE appelé par toutes les pages de l'app juste après connexion (voir le
// hook useAuthedUser dupliqué dans les 14 pages), plutôt que dans chacune
// des 14 pages séparément : un seul endroit à vérifier, comportement garanti
// partout.
async function subscriptionInactiveError(companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('offer_ap_active, offer_as_active, offer_ac_active')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return null;
  const anyActive = company.offer_ap_active || company.offer_as_active || company.offer_ac_active;
  if (anyActive) return null;
  return "Votre compte n'est pas actif : veuillez vous réabonner pour continuer à utiliser Meet Aaron.";
}

export async function POST(request: NextRequest) {
  // Sécurité : auth_user_id et email sont dérivés du token de session Supabase
  // vérifié côté serveur, JAMAIS du corps de la requête — sinon n'importe qui
  // pouvait envoyer l'auth_user_id de son choix + l'email d'un profil "users"
  // pas encore relié à un compte, et se lier définitivement au compte de
  // quelqu'un d'autre (prise de contrôle de compte).
  const identity = await getAuthedIdentity(request);
  if (!identity) {
    return unauthorizedResponse();
  }
  const { auth_user_id, email } = identity;

  const { data: alreadyLinked } = await supabaseAdmin
    .from('users')
    .select('id, company_id, first_name, full_name, role')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (alreadyLinked) {
    const inactiveError = await subscriptionInactiveError(alreadyLinked.company_id);
    if (inactiveError) {
      return NextResponse.json({ error: inactiveError }, { status: 403 });
    }
    return NextResponse.json({ user: alreadyLinked });
  }

  const { data: byEmail } = await supabaseAdmin
    .from('users')
    .select('id, company_id, first_name, full_name, role, auth_user_id')
    .eq('email', email)
    .maybeSingle();

  if (byEmail) {
    if (byEmail.auth_user_id) {
      return NextResponse.json({ error: 'Ce profil est déjà lié à un autre compte' }, { status: 409 });
    }
    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({ auth_user_id })
      .eq('id', byEmail.id)
      .select('id, company_id, first_name, full_name, role')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const inactiveError = await subscriptionInactiveError(updated.company_id);
    if (inactiveError) {
      return NextResponse.json({ error: inactiveError }, { status: 403 });
    }
    return NextResponse.json({ user: updated });
  }

  return NextResponse.json(
    { error: "Aucun profil Meet Aaron n'est associé à cette adresse email. Contactez votre administrateur." },
    { status: 404 }
  );
}
