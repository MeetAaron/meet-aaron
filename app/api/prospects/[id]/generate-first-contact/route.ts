// app/api/prospects/[id]/generate-first-contact/route.ts
// POST -> déclenche la recherche web de la société + la génération/l'envoi du
// tout premier message d'Aaron pour un prospect qui vient d'être créé à la
// main.
//
// docx item 13 (2026-08-27, remonté par Alex) : "l'ajout manuel d'un
// prospect prend environ 1 minute" — POST /api/prospects faisait tout de
// façon strictement synchrone (recherche web de la société + appel Claude
// pour générer le 1er email + envoi Gmail/Outlook réel) avant de répondre,
// bloquant le formulaire d'ajout pendant toute cette durée. Cette route
// isole cette partie lente : POST /api/prospects répond désormais en moins
// d'une seconde (juste les écritures DB), et le frontend
// (app/app/prospects/page.jsx) déclenche cet appel séparément, SANS
// l'attendre, juste après — exactement le même schéma déjà en place pour
// /api/prospects/[id]/linkedin-draft. Le prospect reste visible et
// utilisable dans la liste pendant qu'Aaron prépare son premier message en
// arrière-plan ; l'utilisateur est notifié comme avant (push si validation
// requise, ou tout simplement le prospect qui se met à jour au prochain
// rafraîchissement de la liste).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { runFirstContact } from '@/lib/first-contact';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, company_id, assigned_user_id, full_name, email, prospect_company_id, aaron_advice, origin')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  // Garde-fou idempotence : si ce prospect a déjà un conseil d'Aaron
  // renseigné, le premier contact a déjà été généré (appel précédent déjà
  // passé, ou double-appel accidentel côté frontend) — on ne relance jamais
  // une deuxième génération/un deuxième envoi pour le même prospect.
  // Logique dans lib/first-contact.ts (28/10/2026), partagée avec l'import CSV.
  const result = await runFirstContact(prospect as any);
  return NextResponse.json(result);
}
