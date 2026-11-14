#!/usr/bin/env node
// ios-app/android-push.js
//
// Notifications de l'application Android (14/11/2026). Appelé par
// .github/workflows/android-capacitor.yml, en deux temps :
//
//   node android-push.js config  (AVANT `npx cap add android`)
//     ajoute @capacitor/push-notifications à android.includePlugins de
//     capacitor.config.json ;
//   node android-push.js files   (APRÈS `npx cap add android`)
//     écrit android/app/google-services.json.
//
// Les deux ne font RIEN si le secret GitHub GOOGLE_SERVICES_JSON est absent :
// sans le fichier Firebase, le plugin de notifications ferait planter l'app
// Android au premier register() (FirebaseApp non initialisé). C'est pour ça
// qu'il est exclu par défaut de includePlugins.
//
// GOOGLE_SERVICES_JSON = le contenu du fichier google-services.json
// téléchargé dans la console Firebase (application Android
// app.meetaaron.mobile), tel quel ou encodé en base64. Le modèle Gradle de
// Capacitor applique le plugin com.google.gms.google-services dès que ce
// fichier existe.

const fs = require('fs');
const path = require('path');

const raw = (process.env.GOOGLE_SERVICES_JSON || '').trim();
const mode = process.argv[2];

if (!raw) {
  console.log('android-push: GOOGLE_SERVICES_JSON absent, notifications Android non embarquees.');
  process.exit(0);
}

let text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
let json;
try {
  json = JSON.parse(text);
} catch (err) {
  console.error('android-push: GOOGLE_SERVICES_JSON n\'est pas un JSON valide.');
  process.exit(1);
}
const clients = (json.client || []).map((c) => c?.client_info?.android_client_info?.package_name);
if (!clients.includes('app.meetaaron.mobile')) {
  console.error(`android-push: google-services.json ne contient pas app.meetaaron.mobile (trouve : ${clients.join(', ') || 'rien'}).`);
  process.exit(1);
}

if (mode === 'config') {
  const p = path.join(__dirname, 'capacitor.config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.android = cfg.android || {};
  const list = cfg.android.includePlugins || [];
  if (!list.includes('@capacitor/push-notifications')) list.push('@capacitor/push-notifications');
  cfg.android.includePlugins = list;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('android-push: @capacitor/push-notifications ajoute a includePlugins.');
} else if (mode === 'files') {
  const dir = path.join(__dirname, 'android', 'app');
  if (!fs.existsSync(dir)) {
    console.error('android-push: android/app introuvable — `npx cap add android` a-t-il tourne ?');
    process.exit(1);
  }
  fs.writeFileSync(path.join(dir, 'google-services.json'), JSON.stringify(json, null, 2));
  console.log('android-push: android/app/google-services.json ecrit.');
} else {
  console.error('usage : node android-push.js config|files');
  process.exit(1);
}
