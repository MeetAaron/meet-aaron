# Meet Aaron — application Android (coque TWA)

Ce dossier contient l'application Android de Meet Aaron. Ce n'est **pas** une
réécriture : c'est une *Trusted Web Activity*, une coque qui ouvre
`https://meetaaron.app` dans le Chrome de l'appareil, en plein écran, avec
l'icône et le nom d'Aaron. Une mise à jour du site est une mise à jour de
l'app, sans rien republier sur le Play Store.

Pourquoi ce choix plutôt qu'une WebView « native » : Google **refuse** son
écran de connexion dans une WebView. Dans une TWA, c'est le vrai Chrome →
Google OAuth fonctionne, le service worker et les notifications push du site
aussi.

---

## 1. Obtenir un APK de test — sans rien installer

Le dépôt contient un workflow GitHub Actions (`.github/workflows/android.yml`)
qui construit l'app sur les serveurs GitHub.

1. GitHub → onglet **Actions** → workflow **Android** → **Run workflow**
   (ou attends : il se lance seul à chaque modification de `android/`).
2. Une fois vert (~3 min), ouvre le run → section **Artifacts** →
   `meet-aaron-debug-apk` → télécharge le zip, il contient `app-debug.apk`.
3. Envoie l'APK sur le téléphone (câble, Drive, email à soi-même), ouvre-le,
   accepte « installer depuis des sources inconnues ». C'est tout.

Cet APK est signé avec `app/debug.keystore` — une clé de test aux identifiants
universels Android (`android` / `android`). Elle n'a rien de secret et ne doit
**jamais** servir pour le Play Store.

## 2. Faire disparaître la barre d'adresse (vérification du domaine)

Tant qu'Android n'a pas vérifié que le site et l'app sont au même
propriétaire, l'app s'ouvre avec la barre d'adresse Chrome visible. Pour la
faire disparaître, le site doit publier l'empreinte de la clé qui a signé
l'APK, sur `https://meetaaron.app/.well-known/assetlinks.json`
(route `app/api/android/assetlinks/route.ts`, servie sous ce chemin par `next.config.js`).

Sur Vercel → projet `meet-aaron` → Settings → Environment Variables :

```
ANDROID_ASSETLINKS_SHA256 = 0C:38:50:42:00:24:65:32:1A:53:D3:AC:B3:A7:79:F7:A0:F6:90:92:5F:9C:05:83:50:F9:71:89:8A:6F:28:5E
```

(c'est l'empreinte SHA-256 de `debug.keystore` ; plusieurs empreintes se
séparent par des virgules). Redéployer, réinstaller l'APK : la barre d'adresse
a disparu. Vérification possible sur
`https://meetaaron.app/.well-known/assetlinks.json` — le JSON doit contenir
l'empreinte.

## 3. Publier sur le Play Store (quand les tests sont verts)

1. **Compte développeur Google Play** : 25 $ une seule fois, sur
   play.google.com/console. (Alex le crée lui-même.)
2. **Clé d'upload** — créée par Alex, sur son PC, jamais dans le dépôt :
   ```
   keytool -genkeypair -v -keystore meet-aaron-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Garder ce fichier et ses mots de passe en lieu sûr : sans eux, plus aucune
   mise à jour de l'app n'est possible.
3. **Secrets GitHub** (dépôt → Settings → Secrets and variables → Actions) :
   - `ANDROID_KEYSTORE_BASE64` : le contenu du `.jks` encodé en base64
     (`base64 -w0 meet-aaron-upload.jks` sous Linux/Mac,
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("meet-aaron-upload.jks"))` sous PowerShell)
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= `upload`), `ANDROID_KEY_PASSWORD`
4. Relancer le workflow : un second artefact `meet-aaron-release-aab` apparaît.
   Déposer l'`.aab` dans la Play Console (Production → Créer une release).
5. **Empreinte de production** : la Play Console re-signe l'app avec SA propre
   clé (« Play App Signing »). Récupérer son empreinte SHA-256 dans
   Play Console → Configuration → Intégrité de l'application → *Certificat de
   clé de signature d'application*, et l'**ajouter** à
   `ANDROID_ASSETLINKS_SHA256` sur Vercel (virgule après l'empreinte debug).
   Sans ça, l'app du Store afficherait la barre d'adresse.
6. Fiche Play : l'icône 512×512 est `public/icon.png` ; captures d'écran à
   faire depuis l'app installée ; politique de confidentialité :
   `https://meetaaron.app/privacy`.

Chaque nouvelle version : incrémenter `versionCode` (et `versionName`) dans
`app/build.gradle`, pousser, relancer le workflow, déposer l'AAB.

## 4. Ce qui n'est pas dans cette coque, volontairement

- **Pas d'achat intégré.** L'abonnement se prend sur le site (Stripe). Google
  ne prélève rien tant que l'app ne vend rien et ne renvoie pas vers un
  paiement depuis l'app.
- **Pas de code natif.** Tout ce qu'Aaron fait, il le fait dans le site.

## 5. Ouvrir le projet dans Android Studio (facultatif)

`File → Open → dossier android/`. Android Studio télécharge le SDK et Gradle
tout seul. `Run` installe l'app sur un téléphone branché en USB (mode
développeur + débogage USB activés).
