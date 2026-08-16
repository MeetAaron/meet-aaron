// app/api/auth/salesforce/route.ts
// Démarre le flux OAuth Salesforce — même socle que HubSpot (voir
// app/api/auth/hubspot/route.ts), adapté aux spécificités Salesforce :
// - l'URL d'autorisation est login.salesforce.com (compte "production" ou
//   "Developer Edition" standard — la grande majorité des TPE/PME utilisent
//   ce domaine ; un client avec un "domaine personnalisé" (My Domain) devra
//   nous transmettre l'URL exacte si jamais ce point posait problème, non
//   géré ici pour rester simple pour une première version).
// - la réponse d'échange de token renvoie EN PLUS un `instance_url` (l'URL
//   propre à l'organisation Salesforce du client, ex:
//   https://monentreprise.my.salesforce.com) qui doit être stocké et utilisé
//   pour tous les appels API suivants — voir callback/route.ts et
//   lib/crm-sync.ts.
//
// IMPORTANT — configuration requise avant que ce flux fonctionne :
// 1. Créer une "Connected App" sur https://login.salesforce.com (Setup ->
//    App Manager -> New Connected App), avec "Enable OAuth Settings" activé.
// 2. Renseigner l'URL de redirection (Callback URL) :
//    ${APP_URL}/api/auth/salesforce/callback
// 3. Scopes (OAuth Scopes) à cocher : "Manage user data via APIs (api)",
//    "Perform requests at any time (refresh_token, offline_access)".
// 4. Ajouter SALESFORCE_CLIENT_ID et SALESFORCE_CLIENT_SECRET dans les
//    variables d'environnement Vercel (jamais commitées dans le code).
// Sans ces 4 étapes, ce endpoint répond 501 plutôt que d'échouer silencieusement
// avec un lien Salesforce cassé.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

const SALESFORCE_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';

const SCOPES = ['api', 'refresh_token', 'offline_access'].join(' ');

export async function GET(request: NextRequest) {
  if (!process.env.SALESFORCE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Intégration Salesforce pas encore configurée côté serveur (SALESFORCE_CLIENT_ID manquant) — voir le commentaire en tête de ce fichier." },
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

  const redirectUri = `${process.env.APP_URL}/api/auth/salesforce/callback`;

  // Même schéma anti-CSRF que app/api/auth/hubspot/route.ts.
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${SALESFORCE_AUTH_URL}?${new URLSearchParams({
      response_type: 'code',
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_salesforce_state', `${nonce}:${authedUser.company_id}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/salesforce',
  });

  return redirectResponse;
}
