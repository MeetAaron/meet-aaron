#!/usr/bin/env node
// ios-app/patch-android.js
//
// Retouche le projet Android genere par `npx cap add android` (12/11/2026).
// Meme principe que patch-ios.rb : le projet natif n'est pas dans le depot,
// il est regenere a chaque compilation par GitHub Actions
// (.github/workflows/android-capacitor.yml), puis ajuste ici.
//
// Pourquoi on a quitte la TWA (dossier android/ a la racine) : une TWA fait
// tourner l'app DANS Chrome. Google compte mal l'activite des testeurs du
// test ferme (elle est vue comme de l'activite Chrome), et les prestataires
// de testeurs refusent desormais les TWA. Ici l'app embarque sa propre
// WebView, comme l'app iPhone.
//
// Ce que `cap add android` ne fait pas et dont on a besoin :
//   1. numero de version (versionCode croissant, sinon Google refuse l'envoi)
//      et nom de version alignes sur iOS ;
//   2. signature release avec la cle d'upload (secrets GitHub ANDROID_*) ;
//   3. SDK : minSdk 24 (exige par la protection automatique de Google
//      Play), compile/target 36 ;
//   4. liens d'application : https://meetaaron.app/... s'ouvre dans l'app
//      (la moitie « site » est /.well-known/assetlinks.json, empreinte de la
//      cle de signature Google Play dans ANDROID_ASSETLINKS_SHA256).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'android');
const APP_GRADLE = path.join(ROOT, 'app', 'build.gradle');
const VARIABLES = path.join(ROOT, 'variables.gradle');
const MANIFEST = path.join(ROOT, 'app', 'src', 'main', 'AndroidManifest.xml');

const VERSION_CODE = parseInt(process.env.VERSION_CODE || '2', 10);
const VERSION_NAME = process.env.APP_VERSION || '1.0.0';

function fail(msg) {
  console.error(`patch-android: ${msg}`);
  process.exit(1);
}

for (const f of [APP_GRADLE, VARIABLES, MANIFEST]) {
  if (!fs.existsSync(f)) fail(`fichier introuvable : ${f} — \`npx cap add android\` a-t-il tourne ?`);
}

// 1. Version
let gradle = fs.readFileSync(APP_GRADLE, 'utf8');
if (!/versionCode\s+\d+/.test(gradle)) fail('versionCode introuvable dans app/build.gradle');
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);

// 2. Signature release. Ajoutee en fin de fichier : Gradle fusionne les blocs
// `android { }`, ce qui evite de dependre de la mise en forme du modele.
if (!gradle.includes('MEET_AARON_RELEASE_SIGNING')) {
  gradle += `

// MEET_AARON_RELEASE_SIGNING (ios-app/patch-android.js) — cle d'upload fournie
// par les secrets GitHub ; absente, la variante release n'est pas signee.
android {
    signingConfigs {
        release {
            def ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (System.getenv("ANDROID_KEYSTORE_PATH")) {
                signingConfig signingConfigs.release
            }
        }
    }
}
`;
}
fs.writeFileSync(APP_GRADLE, gradle);
console.log(`app/build.gradle : versionCode ${VERSION_CODE}, versionName ${VERSION_NAME}, signature release`);

// 3. SDK
let vars = fs.readFileSync(VARIABLES, 'utf8');
const setVar = (name, value, min) => {
  const re = new RegExp(`(${name}\\s*=\\s*)(\\d+)`);
  const m = vars.match(re);
  if (!m) fail(`${name} introuvable dans variables.gradle`);
  const current = parseInt(m[2], 10);
  const next = min ? Math.max(current, value) : value;
  vars = vars.replace(re, `$1${next}`);
  return next;
};
const minSdk = setVar('minSdkVersion', 24, true);
const compileSdk = setVar('compileSdkVersion', 36, true);
const targetSdk = setVar('targetSdkVersion', 36, true);
fs.writeFileSync(VARIABLES, vars);
console.log(`variables.gradle : minSdk ${minSdk}, compileSdk ${compileSdk}, targetSdk ${targetSdk}`);

// 4. Liens d'application (App Links) sur l'activite principale
let manifest = fs.readFileSync(MANIFEST, 'utf8');
if (!manifest.includes('android:host="meetaaron.app"')) {
  const filter = `
            <!-- Liens d'application (ios-app/patch-android.js) : tout lien
                 https://meetaaron.app/... (email, notification) s'ouvre dans l'app. -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="meetaaron.app" />
            </intent-filter>
`;
  const idx = manifest.indexOf('</activity>');
  if (idx < 0) fail('</activity> introuvable dans AndroidManifest.xml');
  manifest = manifest.slice(0, idx) + filter + '        ' + manifest.slice(idx);
  fs.writeFileSync(MANIFEST, manifest);
  console.log('AndroidManifest.xml : liens https://meetaaron.app ajoutes');
}

// 5. Petite icône des notifications (14/11/2026) : sans elle, Android
// affiche un carré blanc dans la barre d'état. Icône monochrome reprise de
// l'ancienne coque TWA, copiée depuis ios-app/android-res/ et déclarée comme
// icône par défaut de Firebase Cloud Messaging (voir android-push.js).
const RES_SRC = path.join(__dirname, 'android-res');
const RES_DST = path.join(ROOT, 'app', 'src', 'main', 'res');
if (fs.existsSync(RES_SRC)) {
  fs.cpSync(RES_SRC, RES_DST, { recursive: true });
  manifest = fs.readFileSync(MANIFEST, 'utf8');
  if (!manifest.includes('default_notification_icon')) {
    const meta = `
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_aaron" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/notification_accent" />
`;
    const i = manifest.indexOf('<activity');
    if (i < 0) fail('<activity introuvable dans AndroidManifest.xml');
    manifest = manifest.slice(0, i) + meta.trimStart() + '\n        ' + manifest.slice(i);
    fs.writeFileSync(MANIFEST, manifest);
  }
  console.log('Icone de notification ajoutee (res/drawable-xxxhdpi/ic_stat_aaron.png)');
}

