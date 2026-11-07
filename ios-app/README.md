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

- charge `https://meetaaron.app/app/campaigns` (voir `capacitor.config.json`) ;
- affiche `www/index.html` uniquement s'il n'y a pas de reseau au lancement ;
- fond `#0D0F20` sous l'encoche et la barre d'accueil, pour ne pas voir une
  bande blanche autour de la page ;
- ecran de lancement et icones generes depuis `assets/icon.png`, qui est
  `public/icon.png` — une seule source de verite pour l'icone.

## Notifications — APNs, implemente le 07/11/2026

**Le Web Push ne fonctionne PAS dans une WKWebView** (Apple ne l'autorise que
dans Safari et dans une PWA installee depuis l'ecran d'accueil). La coque
passe donc par le canal natif d'Apple, APNs :

- telephone : `@capacitor/push-notifications` donne un jeton d'appareil, que
  `components/PushNotificationManager.jsx` envoie a `/api/push/subscribe`
  (champ `apns_token`) — meme bouton « Activer les notifications » que sur le
  web, le composant detecte la coque via `lib/native-app.js` ;
- serveur : `lib/apns.ts` (HTTP/2 + JWT ES256, zero dependance) ; `lib/push.ts`
  choisit le canal d'apres l'endpoint (`apns://<token>` = iOS natif) ;
- toucher une notification ouvre la bonne page (`components/NativeAppBridge.jsx`).

A poser sur Vercel : `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`
(contenu du `.p8` cree dans developer.apple.com → Certificates, Identifiers &
Profiles → Keys, case « Apple Push Notifications service »). Sans elles, les
autres canaux continuent et l'iPhone ne recoit simplement rien.

## Consentements Gmail / Outlook et liens universels

Google et Microsoft refusent leurs ecrans de consentement dans une WebView.
Dans la coque, `lib/native-app.js` (`openExternal`) les ouvre dans Safari ;
la fin du flux atterrit sur la page publique `/connexion-terminee`
(`?native=1` pose un drapeau dans le cookie anti-CSRF), et la coque recharge
Connexions quand Safari se ferme.

Liens universels : `patch-ios.rb` pose l'habilitation Associated Domains
(`applinks:meetaaron.app`), et le site sert
`/.well-known/apple-app-site-association` (`app/api/ios/aasa/route.ts`, qui a
besoin de `APPLE_TEAM_ID` sur Vercel — ou d'`APNS_TEAM_ID`, c'est le meme).
**Dans le portail developpeur, les capacites Push Notifications et Associated
Domains doivent etre cochees sur l'identifiant `app.meetaaron.mobile`**, sinon
le profil de provisionnement genere par Codemagic ne couvrira pas les
habilitations et la signature echouera.

## Pas d'achat dans l'application

Regle Apple 3.1.1 : l'onglet Abonnement (credits, carte, portail de
facturation) et l'inscription payante sont remplaces par un simple message
dans la coque (`isNativeApp()` dans `app/app/connexions/page.jsx` et
`app/onboarding/page.jsx`). La connexion d'un commercial invite (code
d'activation) reste possible : ce n'est pas un achat.

## iPhone et iPad

`patch-ios.rb` declare `TARGETED_DEVICE_FAMILY = '1,2'` : l'application est
proposee sur iPhone **et** sur iPad (choix d'Alex, 01/10/2026).

Consequence concrete : App Store Connect reclamera un jeu complet de captures
iPad 13 pouces (2064 x 2752) en plus des captures iPhone, et la revue Apple
regardera la mise en page sur tablette. L'interface etant responsive le risque
est faible, mais une colonne qui s'etire sur toute la largeur d'un iPad en
paysage peut valoir un refus au titre de la regle 4.0 (Design) — a verifier
sur un vrai iPad avant de soumettre.

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
