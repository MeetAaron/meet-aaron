# Supprimer le « non vérifié » (Google + Outlook) — guide opérationnel

> Rédigé le 31/08/2026 pour Alex, suite au docx Modifs Aaron (item 16 +
> bloc CONNEXION OUTLOOK) et au message « si ça se trouve c'est parce que
> l'appli aaron est "non vérifié" ».
>
> **Point important d'abord** : l'avertissement « non vérifié » et le spam
> sont **deux problèmes indépendants**. L'écran « non vérifié » fait peur au
> moment de la connexion (et bloque à ~100 utilisateurs côté Google), mais
> il n'envoie **aucun** email en spam : les emails partent de la boîte du
> commercial, et leur délivrabilité dépend du DNS de SON domaine (SPF/DMARC
> — désormais vérifié et bloqué par Aaron, voir l'assistant dans
> Connexions). Régler la vérification est indispensable pour la confiance et
> le passage à l'échelle, pas pour la délivrabilité.

---

## 1. Google — vérification de l'app (écran OAuth)

**Pourquoi c'est exigeant** : Aaron demande `gmail.send`, `gmail.readonly`
et `gmail.modify` — des scopes classés **« restreints »** par Google. Leur
usage en production impose la vérification de l'app **plus** un audit de
sécurité annuel (CASA). Tant que ce n'est pas fait : écran « Google n'a pas
validé cette application » + plafond de ~100 utilisateurs au total.

### Étape A — Préparer (1-2 h de travail, à faire une fois)
1. **Search Console** : vérifier la propriété du domaine `meetaaron.app`
   (https://search.google.com/search-console) avec le compte Google
   propriétaire du projet Cloud (aaron@meetaaron.app).
2. **Page de confidentialité** : la politique de confidentialité publiée sur
   meetaaron.app doit dire explicitement comment Aaron **accède, utilise,
   stocke et supprime** les données Gmail de l'utilisateur, et citer la
   conformité à la « Google API Services User Data Policy », y compris les
   exigences **Limited Use**. (Je peux rédiger ce paragraphe quand tu veux.)
3. **Écran de consentement** (https://console.cloud.google.com/apis/credentials/consent) :
   nom de l'app, logo, domaine d'accueil `meetaaron.app`, lien vers la
   politique de confidentialité, domaines autorisés.

### Étape B — Vidéo de démonstration (30 min)
Une vidéo YouTube **non répertoriée**, en **anglais**, qui montre :
le flux OAuth complet (clic « Connecter Gmail » → écran Google → retour dans
Aaron), l'URL avec le **client ID visible dans la barre d'adresse**, puis
chaque scope en action : un envoi d'email par Aaron (gmail.send), la lecture
d'une réponse (gmail.readonly), la pose du libellé « Géré par Aaron »
(gmail.modify), et la création d'un RDV agenda (calendar.events).

### Étape C — Soumettre la vérification
Dans la console Cloud → « Data Access » : déclarer les scopes ci-dessus, puis
soumettre le formulaire de vérification avec la vidéo et les liens de doc.
Comptez **plusieurs semaines** d'allers-retours avec l'équipe Trust & Safety.

### Étape D — Audit CASA (le vrai morceau)
Pour les scopes Gmail restreints, Google exige un audit **CASA Tier 2**
par un labo agréé, **à renouveler chaque année** :
- Labos habituels : **TAC Security** (souvent le moins cher), Leviathan,
  DEKRA, Bishop Fox.
- Ordre de prix constaté : **~540 à 1 800 $/an** en Tier 2 (questionnaire +
  scans vérifiés par le labo), audit bouclé en 1 à 3 semaines.
- Livrable : une « Letter of Validation » à remettre à Google.

### Alternative à considérer (sérieusement)
Si le budget/le délai CASA est un frein immédiat : il est possible de
**réduire les scopes**. `gmail.modify` inclut déjà la lecture et l'envoi —
mais reste restreint. En revanche, passer par **Google Workspace Marketplace
+ domaine délégué** ne change rien ici. La seule vraie échappatoire aux
scopes restreints serait de perdre la lecture des réponses (impossible pour
Aaron — c'est le cœur du produit). Donc : **CASA est incontournable côté
Google**. Budget à prévoir, c'est le prix d'entrée de tous les outils
d'emailing qui lisent des boîtes Gmail.

---

## 2. Microsoft — vérification de l'éditeur (et fin du « approbation
   administrateur requise »)

**Bonne nouvelle : c'est gratuit et rapide** une fois les prérequis en place.
Et c'est précisément l'absence de cette vérification qui provoque le blocage
que tu as vu : depuis fin 2020, les tenants Microsoft avec la configuration
par défaut **interdisent aux utilisateurs de consentir à une app
multi-tenant « non vérifiée »** → d'où l'écran « Approbation
administrateur requise » / le détour par le portail Azure. Une fois
l'éditeur vérifié, la plupart des utilisateurs peuvent accepter la connexion
eux-mêmes, comme avec Google.

### Étapes (une demi-journée, étalée sur quelques jours d'attente)
1. **Créer un compte Microsoft AI Cloud Partner Program** (ex-MPN) sur
   https://partner.microsoft.com — gratuit. Faire la **vérification de la
   société** dans Partner Center (SIREN/justificatifs ; quelques jours).
   Récupérer le **Partner ID du compte global (PGA)**.
2. **Domaine éditeur** : dans le portail Entra
   (https://entra.microsoft.com → App registrations → l'app Aaron →
   Branding & properties), configurer le « Publisher domain » =
   `meetaaron.app` (vérification DNS si demandé).
3. **Associer le tenant** : le tenant Entra où l'app Aaron est enregistrée
   doit être associé au compte Partner Center (même société).
4. **Marquer l'app vérifiée** : App registrations → Branding & properties →
   « Publisher verification » → renseigner le Partner ID → valider (connexion
   avec **MFA** obligatoire, rôle Application Administrator).
5. Résultat : badge bleu « vérifié » sur l'écran de consentement, plus
   d'avertissement, et consentement utilisateur rétabli sur les tenants en
   configuration par défaut.

### Filet de sécurité pour les entreprises verrouillées
Certains clients (grosses boîtes) bloquent TOUT consentement utilisateur,
éditeur vérifié ou non. Pour eux, prévoir un **lien de consentement admin**
à transmettre à leur service informatique :
`https://login.microsoftonline.com/organizations/adminconsent?client_id=<CLIENT_ID_AARON>`
— l'admin clique, accepte une fois pour toute la société, et tous ses
commerciaux peuvent connecter Outlook sans rien voir passer. (On pourra
l'ajouter en bouton « Mon service informatique doit approuver » dans
Connexions quand tu veux.)

---

## 3. Ordre recommandé

1. **Microsoft d'abord** (gratuit, rapide, débloque le point le plus
   douloureux : l'approbation admin Outlook).
2. **Google ensuite** : lancer l'étape A-C tout de suite (gratuit), demander
   des devis CASA Tier 2 en parallèle (TAC Security + un concurrent), lancer
   l'audit dès validation du formulaire.
3. Pendant l'attente Google : le plafond de 100 utilisateurs suffit pour la
   phase de test/lancement — l'écran « non vérifié » s'accompagne d'un
   bouton « Continuer » (Avancé → Accéder à meetaaron.app) que tes
   premiers clients peuvent utiliser.
