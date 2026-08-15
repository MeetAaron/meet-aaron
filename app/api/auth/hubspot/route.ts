// app/api/auth/hubspot/route.ts
// Démarre le flux OAuth HubSpot — socle de synchronisation CRM (voir statut
// projet, section CRM). Réservé au patron (role === 'patron') car la
// connexion HubSpot est au niveau SOCIÉTÉ, pas par commercial — même garde
// que la facturation (app/api/billing-portal).
//
// IMPORTANT — configuration requise avant que ce flux fonctionne :
// 1. Créer une app publique sur https://developers.hubspot.com (Apps -> Create app)
// 2. Renseigner l'URL de redirection : ${APP_URL}/api/auth/hubspot/callback
// 3. Scopes à demander : crm.objects.contacts.read, crm.objects.contacts.write,
//    crm.objects.deals.read, crm.objects.deals.write
// 4. Ajouter HUBSPOT_CLIENT_ID et HUBSPOT_CLIENT_SECRET dans les variables
//    d'environnement Vercel (jamais commitées dans le code).
// Sans ces 4 étapes, ce endpoint répond 501 plutôt que d'échouer silencieusement
// avec un lien HubSpot cassé.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';

const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
].join(' ');

export async function GET(request: NextRequest) {
  if (!process.env.HUBSPOT_CLIENT_ID) {
    return NextResponse.json(
      { error: "Intégration HubSpot pas encore configurée côté serveur (HUBSPOT_CLIENT_ID manquant) — voir le commentaire en tête de ce fichier." },
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

  const redirectUri = `${process.env.APP_URL}/api/auth/hubspot/callback`;

  // Même schéma anti-CSRF que app/api/auth/google/route.ts : le state qui part
  // vers HubSpot n'est qu'un aller-retour, la véritable identité (ici
  // company_id + l'utilisateur qui a initié la connexion) vient d'un cookie
  // httpOnly posé côté serveur à partir d'un token déjà vérifié.
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectResponse = NextResponse.redirect(
    `${HUBSPOT_AUTH_URL}?${new URLSearchParams({
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state: nonce,
    }).toString()}`
  );
  redirectResponse.cookies.set('oauth_hubspot_state', `${nonce}:${authedUser.company_id}:${authedUser.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/hubspot',
  });

  return redirectResponse;
}
