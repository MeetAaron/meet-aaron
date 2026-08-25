// lib/auth-helpers.ts
// Vérifie, côté serveur, que l'appelant d'une route API est bien la personne
// connectée qu'il prétend être — plutôt que de faire confiance à un user_id/
// company_id envoyé tel quel par le navigateur (voir l'audit de sécurité :
// avant ce fichier, une route recevait un user_id en paramètre et l'utilisait
// directement, ce qui permettait à n'importe qui connaissant l'identifiant
// d'un autre commercial d'agir à sa place).
//
// Le navigateur envoie le token de session Supabase dans l'en-tête
// "Authorization: Bearer <token>" (attaché automatiquement par
// components/AuthFetchInterceptor.jsx sur chaque appel /api/...).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase-admin';

export interface AuthedUser {
  id: string; // users.id (PAS l'identifiant Supabase Auth)
  auth_user_id: string;
  company_id: string | null;
  role: string | null;
  email: string;
  // Langue choisie par le commercial (sélecteur dans Shell) — utilisée pour
  // générer le contenu dynamique d'Aaron (conseils, emails, chat, devis)
  // dans la bonne langue. Voir lib/locale-instruction.ts et
  // migration_user_locale_2026-08-16.sql. Toujours renseignée (défaut 'fr'
  // en base), donc jamais null ici.
  locale: string;
}

// Résout uniquement l'identité Supabase Auth (auth_user_id + email) à partir d'un
// token de session déjà extrait — cœur commun à getAuthedIdentity (en-tête
// Authorization) et getAuthedUserFromToken (token en query param, pour les routes
// atteintes par navigation complète et non par fetch()).
async function resolveIdentityFromToken(token: string): Promise<{ auth_user_id: string; email: string } | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id || !data.user.email) return null;

  return { auth_user_id: data.user.id, email: data.user.email };
}

// Résout uniquement l'identité Supabase Auth (auth_user_id + email) à partir du
// token — utilisé par /api/auth/link, la toute première étape avant qu'une
// ligne "users" existe forcément côté appelant.
export async function getAuthedIdentity(
  request: NextRequest
): Promise<{ auth_user_id: string; email: string } | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  return resolveIdentityFromToken(token);
}

// Va chercher la ligne "users" liée à un auth_user_id, avec UNE tentative de
// nouvel essai en cas d'erreur (pas "pas de ligne trouvée", une vraie erreur
// de requête — connexion Supabase pas encore chaude sur une route peu
// sollicitée, coupure ponctuelle...). Avant ce correctif (25/08), l'erreur
// était silencieusement ignorée (`const { data } = await ...`) et traitée
// exactement comme "aucun profil" : un blip transitoire de la base se
// traduisait donc par un 401 "Non authentifié — reconnecte-toi." trompeur,
// alors que le token était parfaitement valide — piste sur le bug remonté par
// Alex (25/08) où "Mon équipe"/"Préférences & abonnement" échouent alors que
// Dashboard/Prospects (appelés bien plus souvent, connexion déjà chaude)
// fonctionnent.
async function fetchUserRow(authUserId: string): Promise<AuthedUser | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, auth_user_id, company_id, role, email, locale')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (!error) return (user as AuthedUser) || null;

    // Vraie erreur de requête (pas "pas de ligne") : on log pour garder une
    // trace côté serveur (au lieu de disparaître dans un 401 générique), et on
    // retente une fois avant d'abandonner.
    console.error('[auth-helpers] Erreur requête users (auth_user_id=' + authUserId + '), tentative ' + (attempt + 1) + ' :', error.message);
  }
  return null;
}

// Résout l'identité ET le profil "users" Meet Aaron correspondant — utilisé par
// toutes les autres routes protégées. Renvoie null si le token est absent/
// invalide, ou si aucun profil "users" n'est encore lié à ce compte.
export async function getAuthedUser(request: NextRequest): Promise<AuthedUser | null> {
  const identity = await getAuthedIdentity(request);
  if (!identity) return null;

  return fetchUserRow(identity.auth_user_id);
}

// Même chose que getAuthedUser, mais à partir d'un token déjà extrait (pas d'un
// en-tête Authorization) — nécessaire pour /api/auth/google et /api/auth/microsoft,
// atteintes par navigation complète (window.location.href) et non par fetch(),
// donc invisibles pour AuthFetchInterceptor. Le frontend passe le token en
// paramètre "?token=..." plutôt que le user_id brut, pour empêcher quiconque de
// forger un lien "Connecter Gmail" qui lierait sa propre boîte mail au compte
// Meet Aaron d'un tiers.
export async function getAuthedUserFromToken(token: string): Promise<AuthedUser | null> {
  const identity = await resolveIdentityFromToken(token);
  if (!identity) return null;

  return fetchUserRow(identity.auth_user_id);
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Non authentifié — reconnecte-toi.' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
}
