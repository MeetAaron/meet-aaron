// app/api/auth/link/route.ts
// POST -> appelé juste après une connexion réussie via Supabase Auth (Google).
// Retrouve (ou refuse) le profil "users" Meet Aaron correspondant à l'email connecté,
// et lie définitivement auth_user_id à ce profil pour les prochaines connexions.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';
import { sendSystemEmail } from '@/lib/google';

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
    .select('id, company_id, first_name, full_name, role, email')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (alreadyLinked) {
    const inactiveError = await subscriptionInactiveError(alreadyLinked.company_id);
    if (inactiveError) {
      return NextResponse.json({ error: inactiveError }, { status: 403 });
    }
    // Item 3bis (docx 30/08) : appareil signalé par le navigateur (une fois
    // par jour, voir AuthFetchInterceptor) — email de sécurité si jamais vu.
    const deviceId = request.headers.get('x-aaron-device');
    if (deviceId) {
      registerDeviceAndNotify(alreadyLinked.id, alreadyLinked.email || email, alreadyLinked.first_name, deviceId, request.headers.get('user-agent') || '').catch(() => {});
    }
    // Changement d'email depuis "Mon compte" (demande Alex 2026-08-25) :
    // supabaseBrowser.auth.updateUser({ email }) envoie un lien de
    // confirmation à la NOUVELLE adresse et ne fait rien tant qu'il n'est pas
    // cliqué — `email` ici vient du token de session déjà vérifié
    // (getAuthedIdentity), donc une différence signifie que la confirmation
    // a bien eu lieu. Ce point d'entrée est appelé au chargement de chaque
    // page (voir useAuthedUser, dupliqué dans les 14 pages), c'est donc
    // l'endroit le plus fiable pour répercuter le changement dans la table
    // "users" sans construire un webhook Supabase Auth dédié.
    if (email && alreadyLinked.email && email !== alreadyLinked.email) {
      await supabaseAdmin.from('users').update({ email }).eq('id', alreadyLinked.id);
      alreadyLinked.email = email;
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


// Item 3bis (docx Modifs Aaron 30/08/2026) : "si connexion via un autre PC,
// demander email de sécurité". Chaque navigateur envoie un identifiant
// opaque (localStorage, voir lib/supabase-browser.ts) ; la table user_devices
// (migration_user_devices_2026-08-31.sql) mémorise ceux déjà vus par compte.
// Un appareil inconnu déclenche un email d'alerte au commercial — sauf pour
// le tout premier appareil enregistré (mise en place de la table : on
// n'alerte pas tous les comptes existants d'un coup). Best-effort : jamais
// bloquant pour la connexion.
function describeUserAgent(ua: string): string {
  const os = /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'appareil inconnu';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : 'navigateur inconnu';
  return `${browser} sur ${os}`;
}

async function registerDeviceAndNotify(userId: string, userEmail: string | null, firstName: string | null, deviceId: string, userAgent: string) {
  const safeId = deviceId.slice(0, 128);
  const { data: known, error: knownError } = await supabaseAdmin
    .from('user_devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_id', safeId)
    .maybeSingle();
  if (knownError) return; // table absente (migration pas encore passée) : on ne fait rien

  const now = new Date().toISOString();
  if (known) {
    await supabaseAdmin.from('user_devices').update({ last_seen_at: now }).eq('id', known.id);
    return;
  }

  const { count } = await supabaseAdmin
    .from('user_devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  await supabaseAdmin.from('user_devices').insert({
    user_id: userId,
    device_id: safeId,
    user_agent: userAgent.slice(0, 500),
    first_seen_at: now,
    last_seen_at: now,
  });

  if (!count || !userEmail) return; // premier appareil : enregistrement silencieux

  const when = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
  const body =
    `Bonjour${firstName ? ' ' + firstName : ''},\n\n` +
    `Une connexion à ton compte Meet Aaron vient d'être faite depuis un appareil jamais utilisé jusqu'ici :\n` +
    `• ${describeUserAgent(userAgent)}\n` +
    `• le ${when} (heure de Paris)\n\n` +
    `Si c'est bien toi (nouvel ordinateur, nouveau téléphone, nouveau navigateur), tu n'as rien à faire.\n\n` +
    `Si ce n'est pas toi : change ton mot de passe dès maintenant (Mon compte → Mon profil → Changer le mot de passe) et écris-nous à aaron@meetaaron.app — on coupera l'accès de cet appareil.\n\n` +
    `Aaron`;
  try {
    await sendSystemEmail(userEmail, 'Nouvelle connexion à ton compte Meet Aaron', body);
  } catch (err: any) {
    console.error('Email de sécurité nouvel appareil non envoyé:', err?.message || err);
  }
}
