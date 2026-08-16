// app/api/auth/jobber/route.ts
// Démarre le flux OAuth Jobber — même socle que HubSpot/Salesforce/Pipedrive
// (voir app/api/auth/hubspot/route.ts), adapté aux spécificités Jobber :
// - Jobber est un CRM GraphQL (pas REST), voir lib/crm-sync.ts.
// - Pas de paramètre `scope` dans l'URL d'autorisation (comme Pipedrive) :
//   les scopes sont fixés une fois pour toutes dans la configuration de
//   l'app côté Jobber Developer Center.
//
// IMPORTANT — configuration requise avant que ce flux fonctionne :
// 1. Créer une app sur https://developer.getjobber.com (Developer Center).
// 2. Renseigner l'URL de redirection : ${APP_URL}/api/auth/jobber/callback
// 3. Ajouter JOBBER_CLIENT_ID et JOBBER_CLIENT_SECRET dans les variables
//    d'environnement Vercel (jamais commitées dans le code).
// Sans ces 2 variables, ce endpoint répond 501 plutôt que d'échouer
// silencieusement avec un lien Jobber cassé.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize';

export async function GET(request: NextRequest) {
  if (!process.env.JOBBER_CLIENT_ID) {
    return NextResponse.json(
      { error: "Intégration Jobber pas encore configurée côté serveur (JOBBER_CLIENT_ID manquant) — voir le commentaire en tête de ce fichier." },
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

  const redirectUri = `${process.env.APP_URL}/api/auth/jobber/callback`;

  // Même schéma anti-CSRF que app/api/auth/hubspot/route.ts et pipedrive.
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${JOBBER_AUTH_URL}?${new URLSearchParams({
      response_type: 'code',
      client_id: process.env.JOBBER_CLIENT_ID!,
      redirect_uri: redirectUri,
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_jobber_state', `${nonce}:${authedUser.company_id}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/jobber',
  });

  return redirectResponse;
}
