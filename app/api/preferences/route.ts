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
    .select('full_name, email, notify_channel, notify_before_appointment_minutes, require_first_email_approval, daily_prospecting_email_cap, company_id, role, onboarding_tour_seen, ics_feed_token')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('collaboration_level, offer, offer_ap_active, offer_as_active, offer_ac_active, crm_provider, crm_connection_notes, prospecting_goal, prospecting_goal_details, default_first_email_enabled, default_first_email_subject, default_first_email_body, external_conversion_webhook_secret, public_link_url')
    .eq('id', user.company_id)
    .single();

  const { ics_feed_token, ...userWithoutIcsToken } = user;

  return NextResponse.json({
    preferences: {
      ...userWithoutIcsToken,
      // Demande Alex (29/08/2026) : nouvelle étape "Agenda synchronisé" dans
      // la checklist de mise en route (voir app/app/dashboard/page.jsx) —
      // signal booléen uniquement, jamais le token brut lui-même (pas
      // nécessaire côté frontend, et évite de l'exposer sans besoin).
      ics_link_generated: !!ics_feed_token,
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
      // Objectif de prospection + email de premier contact par défaut (demande
      // Alex, 2026-08-26) — voir migration_prospecting_goal_default_email_2026-08-26.sql,
      // lu par lib/aaron.ts.
      prospecting_goal: company?.prospecting_goal || 'rdv',
      prospecting_goal_details: company?.prospecting_goal_details || '',
      default_first_email_enabled: company?.default_first_email_enabled ?? false,
      default_first_email_subject: company?.default_first_email_subject || '',
      default_first_email_body: company?.default_first_email_body || '',
      // Lien public à mentionner dans les emails de prospection (demande
      // Alex, 27/08/2026, suite à l'absence de lien landing page dans le
      // premier email à Ludovic) — voir migration_public_link_url_2026-08-27.sql
      // et lib/aaron.ts. Jamais fabriqué par Aaron : vide tant que le
      // commercial ne l'a pas renseigné explicitement.
      public_link_url: company?.public_link_url || '',
      // Webhook générique de conversion prospect -> client (demande Alex,
      // 2026-08-26) — voir migration_external_conversion_webhook_2026-08-26.sql
      // et app/api/webhooks/external-conversion/[secret]/route.ts. Lecture
      // seule ici (généré côté base, jamais modifiable via ce PATCH) : null
      // tant que la migration n'a pas été exécutée par Alex.
      external_conversion_webhook_secret: company?.external_conversion_webhook_secret || null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const {
    user_id,
    notify_channel,
    notify_before_appointment_minutes,
    require_first_email_approval,
    daily_prospecting_email_cap,
    collaboration_level,
    crm_provider,
    crm_connection_notes,
    prospecting_goal,
    prospecting_goal_details,
    default_first_email_enabled,
    default_first_email_subject,
    default_first_email_body,
    public_link_url,
  } = await request.json();

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
  // Objectif de prospection : valide la valeur avant écriture (contrainte
  // SQL déjà en place côté base, mais on préfère un message d'erreur clair
  // ici plutôt qu'une 500 générique en cas de valeur inattendue).
  if (prospecting_goal !== undefined && !['rdv', 'devis', 'essai_gratuit', 'autre'].includes(prospecting_goal)) {
    return NextResponse.json({ error: 'Objectif de prospection invalide' }, { status: 400 });
  }

  // Lien public (demande Alex, 27/08/2026) : validation basique côté serveur
  // pour éviter qu'un texte libre non-URL se retrouve inséré tel quel dans un
  // email envoyé à un prospect — vide autorisé (retire le lien).
  if (public_link_url !== undefined && public_link_url) {
    try {
      const parsed = new URL(public_link_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      return NextResponse.json({ error: 'Lien public invalide (doit être une URL complète, ex: https://...)' }, { status: 400 });
    }
  }

  if (
    collaboration_level !== undefined ||
    crm_provider !== undefined ||
    crm_connection_notes !== undefined ||
    prospecting_goal !== undefined ||
    prospecting_goal_details !== undefined ||
    default_first_email_enabled !== undefined ||
    default_first_email_subject !== undefined ||
    default_first_email_body !== undefined ||
    public_link_url !== undefined
  ) {
    const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
    if (user) {
      const companyUpdates: Record<string, unknown> = {};
      if (collaboration_level !== undefined) companyUpdates.collaboration_level = collaboration_level;
      if (crm_provider !== undefined) companyUpdates.crm_provider = crm_provider;
      if (crm_connection_notes !== undefined) companyUpdates.crm_connection_notes = crm_connection_notes;
      if (prospecting_goal !== undefined) companyUpdates.prospecting_goal = prospecting_goal;
      if (prospecting_goal_details !== undefined) companyUpdates.prospecting_goal_details = prospecting_goal_details || null;
      // Booléen : "!== undefined" (pas "if (x)") pour pouvoir repasser
      // l'option à false, même logique que require_first_email_approval plus haut.
      if (default_first_email_enabled !== undefined) companyUpdates.default_first_email_enabled = default_first_email_enabled;
      if (default_first_email_subject !== undefined) companyUpdates.default_first_email_subject = default_first_email_subject || null;
      if (default_first_email_body !== undefined) companyUpdates.default_first_email_body = default_first_email_body || null;
      if (public_link_url !== undefined) companyUpdates.public_link_url = public_link_url || null;

      await supabaseAdmin
        .from('companies')
        .update(companyUpdates)
        .eq('id', user.company_id);
    }
  }

  return NextResponse.json({ success: true });
}
