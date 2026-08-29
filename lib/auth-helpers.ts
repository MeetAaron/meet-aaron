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
//
// Retente une fois en cas d'ERREUR de la vérification elle-même (pas "token
// invalide/expiré" — un vrai souci ponctuel côté serveur Supabase Auth, un
// blip réseau entre notre backend et Supabase). Ajouté le 25/08 en écho au
// même correctif déjà fait sur fetchUserRow ci-dessous (25/08 également) :
// avant ça, CETTE étape-ci (vérification du token) n'avait aucune
// résilience — une seule erreur transitoire ici renvoyait null tout de
// suite, donc un 401 "Non authentifié" alors que le token était en fait
// valide. Alex a remonté (25/08) que le 401 persistant touchait plusieurs
// pages différentes malgré "Réessayer" : cette étape, plus en amont que le
// correctif précédent, est une piste supplémentaire.
async function resolveIdentityFromToken(token: string): Promise<{ auth_user_id: string; email: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data?.user?.id && data.user.email) {
      return { auth_user_id: data.user.id, email: data.user.email };
    }
    if (error) {
      console.error('[auth-helpers] Erreur vérification token Supabase Auth, tentative ' + (attempt + 1) + ' :', error.message);
    }
  }
  return null;
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

// Déduplication + cache court des vérifications d'authentification (25/08,
// round 3 sur le bug persistant "Non authentifié — reconnecte-toi." sur
// Préférences et Mon équipe, remonté à nouveau par Alex malgré les deux
// correctifs précédents de ce même jour — retry serveur sur la vérification
// du token/la lecture de la ligne "users", puis revalidation via getUser()
// côté client avant de rediriger). Point commun identifié entre CES deux
// pages précises (jamais Dashboard/Prospects, qui fonctionnent) : elles
// chargent 6 à 7 appels /api/... EN PARALLÈLE dès le montage (voir le
// commentaire dans components/AuthFetchInterceptor.jsx), donc jusqu'à 6-7
// vérifications de token strictement identiques (même token, à la même
// seconde) contre l'API Supabase Auth PUIS la table users, déclenchées en
// même temps — Dashboard/Prospects n'en déclenchent qu'1-2 au montage. Sous
// cette charge en rafale, un léger ralentissement ou une erreur transitoire
// sur l'UN des 6-7 appels suffit à afficher l'erreur, alors que la session
// est parfaitement valide.
//
// On mutualise donc, PAR INSTANCE SERVERLESS CHAUDE (pas de garantie
// inter-instances sur Vercel, mais une instance est généralement réutilisée
// pour des requêtes aussi rapprochées dans le temps), toute vérification en
// cours pour un même token : les appels concurrents attendent la MÊME
// promesse au lieu de déclencher chacun leur propre aller-retour réseau —
// exactement le même principe que refreshSessionShared() côté navigateur
// (AuthFetchInterceptor.jsx). Un résultat RÉUSSI reste ensuite disponible
// quelques secondes, pour que les appels qui suivent de très près (mais pas
// strictement en même milliseconde) en profitent aussi. Un ÉCHEC n'est
// volontairement PAS mis en cache : on ne veut pas transformer un blip
// transitoire sur le tout premier appel en 401 garanti pour les 6 autres du
// même lot — chaque appel qui arrive après un échec retente franchement.
const AUTHED_USER_CACHE_TTL_MS = 8000;
const authedUserCache = new Map<string, { promise: Promise<AuthedUser | null>; expiresAt: number }>();

function getCachedAuthedUser(token: string, resolve: () => Promise<AuthedUser | null>): Promise<AuthedUser | null> {
  const now = Date.now();
  const cached = authedUserCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = resolve().then((result) => {
    if (result) {
      authedUserCache.set(token, { promise, expiresAt: Date.now() + AUTHED_USER_CACHE_TTL_MS });
    } else {
      authedUserCache.delete(token);
    }
    return result;
  });

  // Occupe immédiatement la place pour la déduplication EN VOL (avant même
  // que cette promesse soit résolue) : les appels concurrents qui arrivent
  // pendant qu'elle est en cours la réutilisent au lieu d'en déclencher une
  // nouvelle.
  authedUserCache.set(token, { promise, expiresAt: now + AUTHED_USER_CACHE_TTL_MS });

  return promise;
}

// Résout l'identité ET le profil "users" Meet Aaron correspondant — utilisé par
// toutes les autres routes protégées. Renvoie null si le token est absent/
// invalide, ou si aucun profil "users" n'est encore lié à ce compte.
export async function getAuthedUser(request: NextRequest): Promise<AuthedUser | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  return getCachedAuthedUser(token, async () => {
    const identity = await resolveIdentityFromToken(token);
    if (!identity) return null;
    return fetchUserRow(identity.auth_user_id);
  });
}

// Même chose que getAuthedUser, mais à partir d'un token déjà extrait (pas d'un
// en-tête Authorization) — nécessaire pour /api/auth/google et /api/auth/microsoft,
// atteintes par navigation complète (window.location.href) et non par fetch(),
// donc invisibles pour AuthFetchInterceptor. Le frontend passe le token en
// paramètre "?token=..." plutôt que le user_id brut, pour empêcher quiconque de
// forger un lien "Connecter Gmail" qui lierait sa propre boîte mail au compte
// Meet Aaron d'un tiers.
export async function getAuthedUserFromToken(token: string): Promise<AuthedUser | null> {
  return getCachedAuthedUser(token, async () => {
    const identity = await resolveIdentityFromToken(token);
    if (!identity) return null;
    return fetchUserRow(identity.auth_user_id);
  });
}

// Consomme un jeton QR OAuth à usage unique (demande Alex, 28/08/2026 : un QR
// code à côté des boutons "Connecter" Google/Outlook dans Connexions, pour
// lancer l'autorisation directement depuis le téléphone du commercial —
// voir migration_oauth_qr_tokens_2026-08-28.sql et app/api/auth/qr-token/
// route.ts pour la création du jeton).
//
// Volontairement une table dédiée à usage unique/courte durée plutôt que de
// coder le token de session (Supabase access_token) dans le QR : ce dernier
// reste valide plusieurs heures et donne accès à toute l'app — l'exposer
// dans un QR affiché à l'écran (capture d'écran, partage) serait risqué.
//
// UPDATE...WHERE used_at IS NULL AND expires_at > now()...RETURNING est une
// opération atomique côté Postgres : deux scans/consommations concurrentes
// du même QR ne peuvent pas toutes les deux réussir.
export async function resolveAndConsumeQrToken(
  qrToken: string,
  provider: 'google' | 'microsoft'
): Promise<AuthedUser | null> {
  const { data: row, error } = await supabaseAdmin
    .from('oauth_qr_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', qrToken)
    .eq('provider', provider)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();

  if (error || !row) return null;

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, company_id, role, email, locale')
    .eq('id', row.user_id)
    .maybeSingle();

  if (userError || !user) return null;
  return user as AuthedUser;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Non authentifié — reconnecte-toi.' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
}
