// app/api/auth/pipedrive/route.ts
// Démarre le flux OAuth Pipedrive — même socle que HubSpot/Salesforce (voir
// app/api/auth/hubspot/route.ts), adapté aux spécificités Pipedrive :
// - la réponse d'échange de token renvoie EN PLUS un `api_domain` (l'URL
//   propre à la société Pipedrive du client, ex: https://monentreprise.pipedrive.com)
//   à utiliser pour tous les appels API suivants — même logique que
//   `instance_url` pour Salesforce, voir callback/route.ts.
//
// IMPORTANT — configuration requise avant que ce flux fonctionne :
// 1. Créer une app privée sur https://app.pipedrive.com/developer-hub
//    (Create an app -> Create a private app suffit pour un usage interne à
//    Meet Aaron, une app publique n'est nécessaire que pour publier sur le
//    Marketplace Pipedrive).
// 2. Renseigner l'URL de redirection (Callback URL) :
//    ${APP_URL}/api/auth/pipedrive/callback
// 3. Scopes à cocher : "Contacts" (lecture + écriture), "Deals" (lecture +
//    écriture) — dans l'onglet "OAuth & access scopes" de l'app.
// 4. Ajouter PIPEDRIVE_CLIENT_ID et PIPEDRIVE_CLIENT_SECRET dans les
//    variables d'environnement Vercel (jamais commitées dans le code).
// Sans ces 4 étapes, ce endpoint répond 501 plutôt que d'échouer silencieusement
// avec un lien Pipedrive cassé.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

const PIPEDRIVE_AUTH_URL = 'https://oauth.pipedrive.com/oauth/authorize';

export async function GET(request: NextRequest) {
  if (!process.env.PIPEDRIVE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Intégration Pipedrive pas encore configurée côté serveur (PIPEDRIVE_CLIENT_ID manquant) — voir le commentaire en tête de ce fichier." },
      { status: 501 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUserFromToken(token);
  if (!authedUser) {
    return NextResponse.json({ error: 'Non authentifié — reconnectez-vous.' }, { status: 401 });
  }
  if (authedUser.role !== 'patron') {
    return NextResponse.json({ error: "Seul le patron peut connecter le CRM de l'entreprise." }, { status: 403 });
  }
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte.' }, { status: 400 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/pipedrive/callback`;

  // Même schéma anti-CSRF que app/api/auth/hubspot/route.ts. Pipedrive ne
  // prend pas de paramètre `scope` dans l'URL d'autorisation : les scopes
  // sont fixés une fois pour toutes dans la configuration de l'app côté
  // Pipedrive (voir commentaire en tête de fichier, étape 3).
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${PIPEDRIVE_AUTH_URL}?${new URLSearchParams({
      client_id: process.env.PIPEDRIVE_CLIENT_ID!,
      redirect_uri: redirectUri,
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_pipedrive_state', `${nonce}:${authedUser.company_id}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/pipedrive',
  });

  return redirectResponse;
}
