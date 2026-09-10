// app/api/android/assetlinks/route.ts
//
// Servi à l'adresse /.well-known/assetlinks.json par une réécriture dans
// next.config.js (le nom de dossier « assetlinks.json » est refusé par
// l'interface d'envoi de fichiers de GitHub — HTTP 406 — d'où ce détour).
//
// Digital Asset Links — la moitié « site » du lien entre meetaaron.app et
// l'application Android (dossier android/, coque TWA). Android télécharge ce
// fichier à l'installation de l'app : si l'empreinte SHA-256 du certificat
// qui a signé l'APK y figure, l'app s'ouvre en plein écran SANS barre
// d'adresse et capte tous les liens https://meetaaron.app/…  Sinon l'app
// fonctionne quand même, mais comme un simple onglet Chrome.
//
// Les empreintes viennent de la variable d'environnement
// ANDROID_ASSETLINKS_SHA256 (Vercel), séparées par des virgules :
//   - l'empreinte de android/app/debug.keystore pour les APK de test
//     (voir android/README.md) ;
//   - l'empreinte du certificat « App signing » donné par la Play Console
//     une fois l'app publiée (Play re-signe l'app avec SA clé, c'est donc
//     CETTE empreinte-là qui compte en production, pas celle d'Alex).
// Variable absente → tableau vide : le fichier existe, mais ne valide rien.
// On ne code aucune empreinte en dur : une clé de test qui traînerait ici
// ferait du dépôt un moyen de se faire passer pour l'app.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PACKAGE_NAME = 'app.meetaaron.twa';

function fingerprints(): string[] {
  return (process.env.ANDROID_ASSETLINKS_SHA256 || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    // Une empreinte SHA-256 = 32 octets en hexadécimal séparés par « : ».
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
}

export async function GET() {
  const prints = fingerprints();
  const body = prints.length
    ? [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: PACKAGE_NAME,
            sha256_cert_fingerprints: prints,
          },
        },
      ]
    : [];
  return NextResponse.json(body, {
    headers: {
      // Android et Google relisent ce fichier rarement ; une heure de cache
      // suffit et évite de solliciter la fonction à chaque installation.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
