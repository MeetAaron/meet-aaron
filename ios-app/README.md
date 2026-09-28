# Coque iOS de Meet Aaron

Meme principe que `android/` : une coque native minimale qui affiche
`https://meetaaron.app`. Ici c'est Capacitor plutot qu'une TWA, parce qu'iOS
n'a pas d'equivalent des Trusted Web Activities.

## Pourquoi le projet Xcode n'est pas dans le depot

Il est genere a chaque compilation par `npx cap add ios`, puis retouche par
`patch-ios.rb`. Deux raisons :

1. **`@capacitor/cli` est bloque par le proxy de l'environnement de
   developpement** — le projet ne peut pas etre genere ici. Il l'est sur le
   macOS de Codemagic.
2. Un projet Xcode, c'est 200 fichiers dont un `project.pbxproj` illisible.
   Le garder genere evite toute fusion manuelle a chaque mise a jour de
   Capacitor.

## Ce que fait la coque

- charge `https://meetaaron.app/app/dashboard` (voir `capacitor.config.json`) ;
- affiche `www/index.html` uniquement s'il n'y a pas de reseau au lancement ;
- fond `#0D0F20` sous l'encoche et la barre d'accueil, pour ne pas voir une
  bande blanche autour de la page ;
- ecran de lancement et icones generes depuis `assets/icon.png`, qui est
  `public/icon.png` — une seule source de verite pour l'icone.

## Notifications — la limite a connaitre

**Le Web Push ne fonctionne PAS dans une WKWebView.** Apple ne l'autorise que
dans Safari et dans une PWA installee depuis l'ecran d'accueil. Concretement :
la PWA iOS actuelle recoit les notifications, cette coque non.

`@capacitor/push-notifications` est deja declare et l'habilitation
`aps-environment` est posee par `patch-ios.rb`, donc la partie telephone est
prete. Il manque la partie serveur : `lib/push.ts` envoie du Web Push
(VAPID), et APNs est un autre protocole. Il faudra :

1. une cle APNs `.p8` depuis le compte Apple (Certificates → Keys) ;
2. une route qui enregistre le jeton APNs du telephone ;
3. un envoi APNs dans `lib/push.ts`, choisi selon le type d'abonnement.

Ce n'est pas bloquant pour une premiere mise en ligne, mais il faut le savoir
avant de promettre les notifications a un client sur iPhone.

## Compilation

Rien a lancer a la main : `codemagic.yaml`, a la racine du depot, fait tout.
Voir ce fichier pour la seule chose a configurer (une integration App Store
Connect).

Pour compiler en local, sur un Mac :

```bash
cd ios-app
npm install
npx cap add ios && npx cap sync ios
npx @capacitor/assets generate --ios --assetPath assets
gem install xcodeproj plist && ruby patch-ios.rb
cd ios/App && pod install && open App.xcworkspace
```
