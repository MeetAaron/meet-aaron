// app/api/ios/aasa/route.ts
//
// Servi à /.well-known/apple-app-site-association par une réécriture dans
// next.config.js (même détour que assetlinks.json : GitHub refuse les
// dossiers de ce nom dans son interface d'envoi).
//
// Moitié « site » des liens universels de l'application iOS (dossier
// ios-app/) : avec ce fichier, et l'habilitation Associated Domains posée par
// ios-app/patch-ios.rb, un lien https://meetaaron.app/… touché dans un email
// ou une notification s'ouvre dans l'app plutôt que dans Safari — et la page
// /connexion-terminee peut ramener dans l'app après un consentement Gmail.
//
// L'identifiant d'app Apple = <Team ID>.<bundle id>. Le Team ID (10
// caractères, developer.apple.com/account) vient de APPLE_TEAM_ID — ou, à
// défaut, d'APNS_TEAM_ID, c'est le même. Absent → fichier vide mais valide.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'app.meetaaron.mobile';

export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID || process.env.APNS_TEAM_ID || '').trim();
  const appIds = /^[A-Z0-9]{10}$/.test(teamId) ? [`${teamId}.${BUNDLE_ID}`] : [];
  const body = {
    applinks: {
      apps: [],
      details: appIds.length
        ? [
            {
              appIDs: appIds,
              components: [
                // Tout le site sauf les routes techniques et les pages
                // légales (qu'on préfère laisser lisibles dans Safari).
                { '/': '/api/*', exclude: true },
                { '/': '/privacy*', exclude: true },
                { '/': '/terms*', exclude: true },
                { '/': '/*' },
              ],
            },
          ]
        : [],
    },
    webcredentials: { apps: appIds },
  };
  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
