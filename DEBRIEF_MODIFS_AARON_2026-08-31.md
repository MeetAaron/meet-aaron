# Débrief complet — docx « Modifs Aaron » (nuit du 30 au 31/08/2026)

Alex : voici le débrief que tu as demandé. D'abord ce qui est **déjà en
prod** depuis cette nuit, puis mes **réponses à chacune de tes questions**,
l'**analyse des coûts API**, et le **plan d'exécution** pour le reste avec
les décisions dont j'ai besoin de toi. Les SQL à exécuter sont dans le chat.

---

## 1. Livré et déployé cette nuit

**Connexion email « clé en main » (ta priorité n°1).**
- L'encadré de délivrabilité dans Connexions est devenu un vrai assistant :
  état clair (« ✅ Tout fonctionne » / « 🔴 Envois de prospection en
  pause »), étapes numérotées avec la valeur exacte à copier-coller,
  **détection automatique de l'hébergeur DNS** (OVH, IONOS, GoDaddy,
  Cloudflare… avec lien direct vers la bonne page), vérification **DKIM**
  par les sélecteurs standards du fournisseur (affichée en « petit conseil,
  non vital » — ton item 15), et surtout un bouton **« Vérifier
  maintenant »** : dès que l'enregistrement est posé chez l'hébergeur, un
  clic re-teste et **débloque immédiatement** les envois (le blocage strict
  d'hier soir lit ce même cache). Le bouton « copier un message pour ton
  informaticien » est conservé. Traduit dans les 7 langues.
- Bouton **« ⚠️ Signaler un problème de connexion avec Aaron »** sur la
  carte Outlook (connecté ou non) — ton bloc CONNEXION OUTLOOK.

**« Message tronqué » Gmail : trouvé et corrigé.** J'ai remonté la piste
jusqu'à la source (copie exacte du message envoyé) : le contenu était
minuscule, donc le tronquage ne venait pas du contenu mais de la FORME. Nos
emails partaient soit en MIME artisanal non conforme aux RFC côté Gmail
(fins de ligne LF, UTF-8 brut non déclaré), soit en texte brut converti en
HTML par Exchange côté Outlook — et c'est ce rendu-là que Gmail affichait
tronqué. Désormais **tous** les emails d'Aaron partent dans la structure
exacte qu'utilise le composeur Gmail lui-même : multipart/alternative
(texte + HTML minimal), encodages corrects, sur les deux fournisseurs. En
bonus, ça ouvre la voie au pixel de suivi d'ouverture marketing (qui était
bloqué par l'envoi texte brut) et le rendu mobile est plus fiable.

**Rubriques (docx).** Produits : retiré pour tout le monde. Clients :
visible uniquement pour aaron@meetaaron.app. Marketing (onglet Campagnes) :
uniquement aaron@meetaaron.app. Suggestions : sortie de la barre latérale,
devenue l'onglet « Suggestions de l'équipe » dans Mon équipe, à droite
d'Abonnement équipes.

**Bandeau publicitaire sous la signature (bloc AJOUT signature).** Dans Mon
entreprise, sous l'image de signature : importer/supprimer un bandeau
(PNG/JPEG/GIF/WEBP, 2 Mo). Il s'affiche sous la signature dans tous les
emails envoyés. ⚠️ Nécessite le SQL `migration_email_banner` (dans le chat).

**Limite API 20 €/utilisateur/mois répartie sur 30 jours (item 2).** Le
plafond était de 20 **dollars par société** lissé sur 15 jours ; il est
maintenant de **20 € par utilisateur** (21,5 USD au taux prudent) × le
nombre d'utilisateurs de la société, lissé sur **30 jours**. L'utilisateur
ne voit toujours que des crédits, jamais ces montants.

**Guide « non vérifié » (item 16).** Fichier
`GUIDE_VERIFICATION_OAUTH_2026-08-31.md` dans le repo : le pas-à-pas complet
Google (vérification + audit CASA Tier 2 annuel, ~540-1 800 $/an chez TAC
Security/Leviathan/DEKRA/Bishop Fox) et Microsoft (vérification éditeur
**gratuite** via Partner Center — et c'est PRÉCISÉMENT elle qui supprime
l'écran « approbation administrateur requise » d'Outlook qui t'agace : les
tenants en config par défaut interdisent le consentement des utilisateurs
aux apps multi-tenant non vérifiées). Ordre conseillé : Microsoft d'abord
(gratuit, rapide, débloque le point le plus douloureux), Google ensuite.
Important : le « non vérifié » ne met AUCUN email en spam — ce sont deux
problèmes séparés ; le spam, c'est le DNS, et c'est réglé par le blocage +
l'assistant.

---

## 2. Réponses à tes questions du docx

**« Mes documents » : à quoi servent les options prospect/opportunité ?**
Aujourd'hui, un document marqué « prospect » ou « opportunité » sert de
contexte à Aaron quand il écrit à un contact de CETTE étape (argumentaires,
études de cas, tarifs spécifiques). « Général » = docs société transverses
(plaquette). Honnêtement : la distinction est trop subtile pour l'usage réel.
**Mon avis** : garde « Général » pour le contexte d'Aaron, et transforme
prospect/opportunité/client en ce que tu décris — des FICHIERS DE BASE
(listes de contacts) qu'Aaron classe automatiquement au bon endroit :
clients → jamais démarchés, opportunités → pipeline, prospects → prospection.
C'est exactement ton scénario anti-doublons. Et oui, je confirme ta seconde
intuition : le meilleur endroit pour uploader ces fichiers reste les pages
Prospects/Opportunité elles-mêmes (l'import y existe déjà) — « Mes
documents » resterait le contexte d'Aaron, pas une porte d'entrée de
contacts. Une seule porte par usage = pas de confusion.

**Connexions : le bloc « 3 éléments vitaux ».** D'accord sur le fond et sur
le nom « Boîte email connectée ». La « solution miracle » qui lierait
email + notifs + agenda en un seul clic n'existe pas techniquement (trois
autorisations différentes, dont une par appareil), MAIS on peut s'en
approcher très fort : une **checklist unique « Mise en route » en 3 lignes**
dans l'onglet Connexion — 1) Boîte email ✅/→, 2) Notifications sur CET
appareil ✅/→ + QR code « active-les aussi sur ton téléphone », 3) Agenda
synchronisé ✅/→ — chaque ligne avec son bouton direct, l'état vert quand
c'est fait. 5 minutes chrono, une seule page. (Le dashboard a déjà une
checklist de mise en route — je propose de la déplacer/fusionner ici.)
Pour les notifs par appareil : techniquement chaque navigateur/appareil a
sa propre souscription push, donc « ordinateur » et « téléphone » sont bien
deux lignes distinctes — ta demande colle parfaitement à la réalité
technique. Par défaut : push activé sur les deux, email en option.

**Mon équipe : un seul abonnement à l'ajout d'un siège + boost par ligne.**
Validé, cohérent avec l'abonnement unique (voir §4 — j'ai besoin du price
ID Stripe pour finir). Le bouton « Booster » par ligne existe déjà ; j'y
ajouterai l'état de consommation de crédits du compte à côté (petite jauge).
L'erreur à l'ajout d'un compte commercial : je n'ai pas pu la reproduire
cette nuit sans tes identifiants — si tu me redonnes le message d'erreur
exact au réveil (ou refais l'action une fois), je la corrige dans la foulée.

**CRM : on garde l'onglet ?** Oui, mais réduit à ce que tu décris : un
interrupteur « Synchronisation automatique vers mon CRM » (Aaron → CRM
uniquement, jamais l'inverse — je le préciserai en toutes lettres sous
l'interrupteur) + le choix du CRM + les notes. Les niveaux 0-3
disparaissent : tu as raison, dès qu'on pousse en continu, les niveaux
« quotidien/horaire » n'ont plus de sens, et les niveaux 0-1 sont déjà
couverts par l'usage naturel (uploader un fichier ou lancer une campagne).

**Campagnes : le message anti-doublons.** Validé tel quel. Au lancement
d'une campagne, Aaron affichera : « Recommandation : importe d'abord tes
fichiers clients/opportunités/prospects (xls ou csv) pour éviter les
doublons. Sans ça, on risque de contacter des clients existants, perdus, ou
des opportunités en cours. » avec les deux boutons Importer / Continuer
quand même.

**Mes résultats.** D'accord sur toute la ligne : « Évolution des
performances » est moche ET mal placée — elle ira sous le « Bilan » de
Prospects et sous celui d'Opportunité (ton item 17-18 : chaque rubrique
gagne un onglet « Mes résultats », et la rubrique Mes résultats se recentre
sur les rapports de performance mensuels + un onglet de téléchargement).
Rapports : je précise qu'ils couvrent prospects + opportunités, cases
jour/semaine/mois cochées par défaut avec désinscription possible, export
PDF/XLS. Clients disparaît de Mes résultats (sauf aaron@) — cohérent avec
la suppression de la rubrique.

**Ton agenda : bloc synchro retiré** → oui, il part dans Connexions (avec la
checklist ci-dessus). À faire dans le lot Connexions.

**Pipeline Opportunité : je valide ton schéma, avec 2 ajustements.** Ton
flux : arrivée en « En cours » (RDV prospect concluant) → « Offre envoyée »
(devis/contrat/proposition — je préfère « Offre envoyée » à « Devis
envoyé », ça couvre tous les cas que tu cites) → « En négociation » (oui,
c'est bien ça : score de conviction + explication d'Aaron, mis à jour à
chaque échange) → « Offre acceptée 🎉 » = bascule Client + email de
félicitations. Mes 2 ajustements : (1) garde la possibilité de sauter
« En négociation » (un prospect qui dit oui direct passe d'Offre envoyée à
Acceptée) ; (2) l'onglet « Clients » dans Opportunité, purement consultatif
comme tu le décris (import/export/modèle vierge, aucune action d'Aaron,
une phrase le dit explicitement) — c'est LA bonne réponse au « où vont les
clients maintenant que la rubrique Clients disparaît ». Le circuit devis :
Aaron relance jusqu'à obtenir la demande → notification « Demande de
devis » → l'utilisateur fait son devis dans SON outil → il le dépose (par
la notification, par le bloc rouge « En attente de devis » sous le tableau,
ou par la ligne du tableau — les 3 mènent au même formulaire d'upload) →
Aaron l'envoie en PDF et passe l'affaire en « Offre envoyée ». Une colonne
« Offre » dans le tableau montre la PJ en cours et son statut
(envoyée/acceptée). Types de PJ : devis, contrat, proposition, abonnement —
je prévois aussi « autre », il y en aura toujours un imprévu.

**Notifications.** Je valide ta liste Prospect telle quelle. Opportunité :
- « Devis prêt à valider » → renommé **« Devis en attente »** ✅.
- **Nouveau client vs Contrat signé : tu as raison, c'est redondant.** Je
  propose exactement ton flux : une seule notif « 🎉 Accord reçu — valide
  ton nouveau client » ; l'utilisateur confirme (comme le bilan de RDV) ;
  à la confirmation → notif/écran « 🎉 Nouveau client ! ». La variante
  « signature électronique YouTrust » n'est qu'un déclencheur différent de
  la même notif (email « bon pour accord » OU webhook YouTrust → même
  chemin). Une seule cérémonie, pas trois.
- **Les 2 notifs de score (40-74 et ≥75), à quoi elles servent** : la
  première (score moyen) te dit « ça discute sérieusement, reste dispo » —
  SANS changer l'étape ; la seconde (score fort) bascule automatiquement
  l'affaire en « En négociation » et te le notifie. La différence avec
  « contrat signé » : le score mesure une PROBABILITÉ pendant la
  discussion ; « signé » est un FAIT. Mon conseil de simplification : garde
  la bascule automatique (≥75) qui est utile, et supprime la notif 40-74
  (elle fait du bruit sans action possible — et elle coûte un appel API
  d'analyse à chaque échange). Si tu veux garder l'info, le score reste
  visible sur la fiche sans notification.

**Items AJOUTS 30/08 déjà couverts cette nuit** : 2 (limite API), 15 (état
de connexion), 16 (guide non vérifié), et le 19 est appliqué sur tout ce qui
a été livré (7 langues). Item 3 (bilan RDV téléphonique manuel) : la zone
de texte existe déjà dans le bilan post-RDV ; il manque les boutons « bien
passé/moyen/mal passé » et le choix prospect/opportunité → prévu au lot
Agenda. Item 7 (brief post-RDV avec chips + envoi remerciement) : même lot,
même écran. Item 14 (messages multiples chat → ancrer sur le premier) et
11 (24h d'inactivité, pas 24h après le début) : lot Chat. Items 8-9 (UX
téléphone façon Things 3, veuves/orphelines) : lot Mobile dédié — j'y
passerai une session entière avec captures à chaque résolution. Item 10
(voix IA) : à préciser ensemble (qu'est-ce qui te déplaît : la voix, la
lenteur, les coupures ?). Items 12-13 (modale génération profil + étapes
guidées bloquantes avec reprise + écran félicitations) : lot Onboarding.
Item 5 (« On va t'aider à définir ton entreprise ») : même lot. Item 6
(le commercial qui rejoint par code hérite du profil entreprise) : à
vérifier — je crois que c'est déjà le cas côté données (company_id partagé),
il faut surtout SAUTER l'étape de création de fiche dans son onboarding.
Item 3bis (connexion depuis un autre PC → email de sécurité) : Supabase
Auth peut notifier les nouvelles connexions ; sinon je l'implémente à la
main (table des appareils connus + email d'alerte). Item 4 (« Générer fiche
client. Comme ») : ta phrase s'arrête net — dis-moi la suite.

---

## 3. Le debrief coûts API demandé (« ré-analyse tout Aaron »)

Ce qui consomme l'API Claude aujourd'hui, classé par rapport à LA mission
(prospect → opportunité → client) :

**Cœur de mission — à garder tel quel.**
Génération/réponses prospects (aaron.ts), recherche web sur la société d'un
nouveau prospect (~1-3 ct/prospect, améliore nettement le 1er email),
sourcing des campagnes, analyse des réponses entrantes (check-inbox),
relances, sauvetages, rapports d'équipe.

**Fuite silencieuse n°1 — les 5 crons du module Clients.** customer-checkins,
customer-health, upsell-signals, renewal-reminders, kickoff-followup
tournent CHAQUE JOUR pour TOUTES les sociétés, sans vérifier si le module
Clients est actif — alors que la rubrique est désormais réservée à ton
compte. À l'échelle (100 sociétés), c'est des centaines d'appels Claude
quotidiens pour un module que personne ne voit. **Reco : conditionner ces 5
crons à aaron@ / module AC actif** (Lot API-1, une heure de travail).
C'est LA plus grosse économie disponible.

**À supprimer selon ta propre décision produit (devis).** La génération de
devis par Aaron (route devis + la partie génération de lib/aaron-sales)
devient morte avec le nouveau pipeline (c'est l'utilisateur qui dépose son
devis). Chaque devis généré coûtait un appel long. À débrancher au moment
du chantier pipeline — pas avant, pour ne rien casser.

**Gadgets sympas mais périphériques (ton « ça éparpille »).** Témoignages
générés (testimonial), brouillons LinkedIn : usage réel probablement
faible ; coût par usage modéré. Reco : garde-les mais SANS notification/mise
en avant — s'ils ne manquent à personne dans 1 mois, on les retire. Le
résumé de documents uploadés : petit coût, vraie valeur (contexte d'Aaron),
à garder.

**Le chat Aaron.** C'est utile (c'est l'interface « magique ») mais c'est le
poste le plus imprévisible : recherche web activée (0,01 $/recherche en sus)
et conversations parfois longues. Le plafond 20 €/mois/utilisateur + le
lissage sur 30 jours le contiennent désormais. Reco supplémentaire au
prochain lot : réduire l'historique renvoyé à chaque message (fenêtre
glissante) — économie directe sur les tokens d'entrée.

**Bug repéré au passage** : un déploiement Vercel a échoué hier à 16:12
(email « Failed production deployment ») — transitoire, les déploiements
suivants sont verts et la prod est saine ; à surveiller si ça se reproduit
en série (3 échecs similaires le 28/08).

---

## 4. Ce qu'il me faut de toi pour continuer (dans l'ordre)

1. **Stripe — abonnement unique Aaron 30 €** : je ne touche pas au checkout
   en aveugle. Donne-moi (depuis ton dashboard Stripe) le **price ID** de
   l'abonnement Aaron à 30 €/mois (price_xxx), et confirme : les comptes
   déjà abonnés à d'anciens modules restent tels quels, ou on les migre ?
   Dès que je l'ai : simplification du choix d'abonnement (onboarding, ajout
   de siège équipe, page Abonnement, landing/plaquette) en une seule offre.
2. **L'erreur d'ajout d'un compte commercial** : le message exact (ou refais
   l'action une fois que je suis réveillé… enfin, que TU l'es).
3. **Item 4 du docx** (« Generer Fiche client. Comme ») : la phrase est
   coupée — précise ce que tu voulais.
4. **Voix IA (item 10)** : dis-moi ce qui cloche précisément (voix robotique ?
   lenteur ? coupures ? langue ?).
5. **SQL du matin** : 2 scripts dans le chat (bandeau + rappel du cache
   domaine si pas encore fait hier soir).

## 5. Proposition de lots pour la suite (par ordre de valeur)

- **Lot Connexions-2** : checklist « Mise en route » unifiée (email + push
  ordinateur/téléphone avec QR + agenda), déplacement du bloc synchro
  depuis Ton agenda, notif push par appareil. (Item central du docx.)
- **Lot Pipeline Opportunité** : étapes renommées, dépôt de devis (3 accès),
  bloc rouge « En attente de devis », onglet Clients consultatif,
  notifications simplifiées (une seule cérémonie nouveau client),
  suppression génération de devis. (Gros lot, le plus structurant.)
- **Lot API-1** : gating des 5 crons Clients + fenêtre glissante chat.
- **Lot Résultats** : onglets « Mes résultats » dans Prospects et
  Opportunité, rubrique Mes résultats recentrée (rapports + downloads PDF/
  XLS), cases jour/semaine/mois.
- **Lot Stripe** (dès ton price ID) : offre unique partout.
- **Lot Agenda/RDV** : bilan RDV manuel enrichi (boutons + type + chips
  remerciement, items 3 et 7).
- **Lot Onboarding** : étapes bloquantes avec reprise, modale génération
  profil, wording, héritage profil entreprise via code, partage fiche PDF
  par email (items 5, 6, 12, 13).
- **Lot Chat** : ancre premier message, 24h d'inactivité, coûts.
- **Lot Mobile** : passe UX complète toutes résolutions, esprit Things 3
  (items 8, 9) — session dédiée avec captures avant/après.
- **Lot Documents/fichiers de base** : classement auto des fichiers
  importés + question de prise en compte + filtres « géré par Aaron/par
  moi » + colonne géré par Aaron dans les modèles vierges.
