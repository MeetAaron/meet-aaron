// app/api/preferences/route.ts
// GET   -> lit les préférences du commercial + niveau de collaboration + offre souscrite
// PATCH -> met à jour préférences, niveau de collaboration, et/ou offre souscrite

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('full_name, email, notify_channel, notify_before_appointment_minutes, require_first_email_approval, daily_prospecting_email_cap, company_id, role, onboarding_tour_seen')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('collaboration_level, offer, offer_ap_active, offer_as_active, offer_ac_active, crm_provider, crm_connection_notes')
    .eq('id', user.company_id)
    .single();

  return NextResponse.json({
    preferences: {
      ...user,
      require_first_email_approval: user.require_first_email_approval ?? false,
      daily_prospecting_email_cap: user.daily_prospecting_email_cap ?? 40,
      collaboration_level: company?.collaboration_level ?? 0,
      offer: company?.offer ?? 'AP',
      // Abonnement multi-module (docx item 31 + section STRIPE) — source de
      // vérité pour la navigation et pour l'onglet Abonnement, voir
      // lib/subscription.ts et app/api/subscription/modules/route.ts.
      // L'ancien champ `offer` ci-dessus reste renvoyé pour compatibilité
      // mais n'est plus utilisé pour verrouiller la navigation.
      offer_ap_active: company?.offer_ap_active ?? true,
      offer_as_active: company?.offer_as_active ?? false,
      offer_ac_active: company?.offer_ac_active ?? false,
      crm_provider: company?.crm_provider ?? null,
      crm_connection_notes: company?.crm_connection_notes ?? null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user_id, notify_channel, notify_before_appointment_minutes, require_first_email_approval, daily_prospecting_email_cap, collaboration_level, crm_provider, crm_connection_notes } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const updates: Record<string, unknown> = {};
  if (notify_channel) updates.notify_channel = notify_channel;
  if (notify_before_appointment_minutes) updates.notify_before_appointment_minutes = notify_before_appointment_minutes;
  // Booléen : garde le check "!== undefined" (pas "if (x)") pour pouvoir
  // repasser l'option à false, contrairement aux champs texte ci-dessus.
  if (require_first_email_approval !== undefined) updates.require_first_email_approval = require_first_email_approval;
  // Plafond quotidien d'emails de prospection (protection délivrabilité, voir
  // lib/messaging.ts) — bornes larges mais réelles pour éviter une valeur
  // absurde saisie par erreur (0 bloquerait toute prospection, un nombre
  // négatif ferait planter le calcul de la limite).
  if (daily_prospecting_email_cap !== undefined) {
    const cap = Number(daily_prospecting_email_cap);
    if (!Number.isFinite(cap) || cap < 1 || cap > 2000) {
      return NextResponse.json({ error: 'Le plafond quotidien doit être un nombre entre 1 et 2000' }, { status: 400 });
    }
    updates.daily_prospecting_email_cap = Math.round(cap);
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from('users').update(updates).eq('id', user_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : `offer`
  // n'est plus modifiable via cette route générique — activer/désactiver un
  // module a un effet Stripe réel (ajout/suppression d'une ligne
  // d'abonnement, voire annulation complète), ce que ce PATCH générique ne
  // fait pas. Voir app/api/subscription/modules/route.ts, la route dédiée.
  if (collaboration_level !== undefined || crm_provider !== undefined || crm_connection_notes !== undefined) {
    const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
    if (user) {
      const companyUpdates: Record<string, unknown> = {};
      if (collaboration_level !== undefined) companyUpdates.collaboration_level = collaboration_level;
      if (crm_provider !== undefined) companyUpdates.crm_provider = crm_provider;
      if (crm_connection_notes !== undefined) companyUpdates.crm_connection_notes = crm_connection_notes;

      await supabaseAdmin
        .from('companies')
        .update(companyUpdates)
        .eq('id', user.company_id);
    }
  }

  return NextResponse.json({ success: true });
}
