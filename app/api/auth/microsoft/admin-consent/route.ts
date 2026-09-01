// app/api/auth/microsoft/admin-consent/route.ts
// Microsoft 365 : quand l'entreprise du commercial interdit le consentement
// utilisateur (réglage courant sur les locataires Entra ID "Ne pas autoriser
// le consentement utilisateur" ou "éditeurs vérifiés uniquement"), le
// commercial voit "Approbation de l'administrateur requise" et ne peut PAS
// connecter sa boîte lui-même. Son administrateur 365 doit autoriser Aaron
// une fois pour toute l'entreprise.
//
// Cette route est le lien à transmettre à cet administrateur (voir le bandeau
// "admin_consent_required" dans app/app/connexions/page.jsx). Elle est
// VOLONTAIREMENT publique et sans jeton : c'est l'administrateur qui l'ouvre,
// et il n'a pas de compte Meet Aaron. Elle ne fait que rediriger vers l'écran
// de consentement Microsoft — aucune donnée utilisateur n'y transite, et
// l'autorisation elle-même est accordée côté Microsoft, pas ici.
//
// Après validation, Microsoft renvoie sur le callback existant avec
// ?admin_consent=True (pas de code) — traité dans
// app/api/auth/microsoft/callback/route.ts.

import { NextRequest, NextResponse } from 'next/server';

// Mêmes permissions déléguées que le flux commercial (voir
// app/api/auth/microsoft/route.ts) : l'administrateur autorise exactement ce
// qu'un employé aurait autorisé pour lui-même, ni plus ni moins.
const SCOPES = [
  'offline_access',
  'Calendars.ReadWrite',
  'Mail.ReadWrite',
  'Mail.Send',
  'Mail.Read',
  'MailboxSettings.ReadWrite',
  'User.Read',
].join(' ');

export async function GET(request: NextRequest) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Connexion Microsoft pas encore configurée.' }, { status: 500 });
  }

  // /organizations : comptes professionnels/scolaires uniquement — un compte
  // Microsoft personnel n'a pas d'administrateur et n'a rien à faire ici.
  const url =
    'https://login.microsoftonline.com/organizations/v2.0/adminconsent?' +
    new URLSearchParams({
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: `${process.env.APP_URL}/api/auth/microsoft/callback`,
      state: 'admin_consent',
    }).toString();

  return NextResponse.redirect(url);
}
