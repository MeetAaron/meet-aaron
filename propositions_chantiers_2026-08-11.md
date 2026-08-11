# Meet Aaron — Propositions pour les 7 chantiers à valider

Document préparé le 11/08/2026. Ces 7 chantiers ne sont **pas déployés** — ce sont des propositions concrètes pour que tu puisses trancher rapidement. Dès que tu valides un point (même juste "ok vas-y" ou "non, plutôt X"), je le construis et le déploie.

---

## 1. Dashboard admin — facturation (chantier #3)

**Contexte** : Stripe gère déjà les paiements (Checkout + webhooks), mais il n'existe aucune vue d'ensemble côté admin (toi / Open X) pour suivre qui paie quoi.

**Proposition** :
- Nouvelle page `app/admin/billing` (visible seulement au rôle "patron" ou à un rôle "admin" dédié si tu préfères le séparer du rôle patron classique).
- Tableau : société, plan, statut abonnement (actif/impayé/annulé), prochain prélèvement, montant, lien direct vers la fiche client dans le Stripe Dashboard.
- Données lues directement depuis Stripe (API `subscriptions.list`) plutôt que dupliquées dans Supabase, pour éviter les désynchronisations.
- Option : alerte email (à toi) en cas d'échec de paiement (`invoice.payment_failed` dans le webhook Stripe, déjà écouté partiellement).

**Décisions à prendre** :
- Ce dashboard est réservé à toi uniquement, ou aussi visible par un patron d'une société cliente pour SA propre facturation (dans ce cas il faut filtrer par `company_id`) ?
- Veux-tu l'alerte email en cas d'échec de paiement dès maintenant ?

**Effort estimé** : petit à moyen (une page + une route API qui interroge Stripe).

---

## 2. Plafond de dépense API (chantier #18)

**Contexte** : Chaque appel à Claude (chat, prospection, résumé de documents...) a un coût. Sans garde-fou, une société cliente très active (ou un bug en boucle) pourrait générer une facture Anthropic imprévue.

**Proposition** :
- Table `companies.monthly_api_budget_cents` (nullable = pas de limite) + table `api_usage_log` qui enregistre le coût estimé de chaque appel Claude (déjà possible à estimer via le nombre de tokens renvoyé par l'API).
- Un cron quotidien additionne l'usage du mois en cours par société ; si le budget est dépassé, Aaron bascule en mode dégradé pour cette société (ex : réponses plus courtes, ou blocage des nouveaux appels avec message clair côté commercial : "Contactez Open X, quota API atteint pour ce mois").
- Toi, tu reçois un email d'alerte à 80 % du budget, avant le blocage.

**Décisions à prendre** :
- Le plafond est-il par société cliente, ou un plafond global tous clients confondus (plus simple, mais moins fin) ?
- Que doit-il se passer concrètement en cas de dépassement : blocage total, mode dégradé, ou juste une alerte sans blocage (le plus simple pour commencer) ?

**Effort estimé** : moyen (nécessite d'instrumenter tous les appels Claude existants).

---

## 3. Notifications push réelles (chantier #16)

**Contexte** : Aujourd'hui les notifications passent uniquement par email (rappels RDV, relances...). Une notification push (mobile/desktop) serait plus immédiate pour un commercial en déplacement.

**Proposition** :
- L'app étant une PWA, on peut utiliser les **Web Push notifications** standard (API `PushManager`, pas besoin d'app native).
- Ajout d'une table `push_subscriptions` (par utilisateur), demande de permission navigateur au premier lancement (ou depuis Préférences, pour rester non-intrusif), et un service worker qui affiche la notification.
- Réutilise les mêmes déclencheurs que les emails actuels (nouveau RDV, annulation client, rappel 24h) sans dupliquer la logique métier.

**Décisions à prendre** :
- Notification push en complément de l'email, ou en remplacement pour certains types d'alertes ?
- Qui reçoit des push : uniquement les commerciaux, ou aussi les patrons (ex: alerte quand un prospect "rouge" apparaît) ?

**Effort estimé** : moyen (mise en place du service worker + permission navigateur, ce dernier point demandant un peu de pédagogie utilisateur car les navigateurs sont stricts sur ces permissions).

---

## 4. CGU / Conditions Générales d'Utilisation (chantier #17)

**Contexte** : L'app collecte des données personnelles (prospects, emails, données de calendrier) et traite des paiements — des CGU (et une politique de confidentialité, déjà partiellement présente via `/privacy`) sont nécessaires avant une vraie mise en production commerciale.

**Important — je ne suis pas juriste** : Je peux préparer un premier brouillon structuré à partir de ce que fait techniquement l'app (quelles données, avec qui elles sont partagées — Anthropic, Google, Stripe, Supabase — durée de conservation, etc.), mais ce brouillon **doit être relu par un professionnel du droit** avant publication, en particulier pour la conformité RGPD (traitement de données de prospects tiers, sous-traitance via des APIs américaines comme Claude/Anthropic).

**Proposition concrète** :
- Je rédige un brouillon de CGU + CGV (vu qu'il y a de la facturation) basé sur les flux réels de l'app.
- Je liste séparément les points RGPD qui demandent une vraie vérification juridique (base légale du traitement des données des prospects qui n'ont rien demandé, transferts hors UE via Anthropic/Google, droit à l'oubli, etc.).

**Décision à prendre** : veux-tu que je prépare ce brouillon maintenant (en le marquant clairement "à faire valider par un juriste"), ou préfères-tu passer directement par un professionnel pour cette partie ?

**Effort estimé** : petit pour le brouillon technique, mais la validation juridique est hors de mon périmètre.

---

## 5. LinkedIn comme canal de prospection (chantier #19)

**Contexte** : Aujourd'hui Aaron prospecte par email uniquement. LinkedIn est souvent plus efficace en B2B, mais techniquement plus contraint.

**Ce qu'il faut savoir avant de trancher** :
- LinkedIn n'a pas d'API publique pour l'automatisation de messages ou de connexions — l'API officielle (LinkedIn Marketing/Sales Navigator API) est réservée à des partenariats spécifiques et très restreinte.
- Les outils qui "automatisent LinkedIn" (type PhantomBuster, la plupart des extensions Chrome) fonctionnent en simulant un vrai navigateur connecté au compte LinkedIn d'un commercial — ce qui viole les conditions d'utilisation de LinkedIn et expose le compte du commercial à une suspension.

**Proposition réaliste** :
- Option A (recommandée pour démarrer) : Aaron **prépare** un message LinkedIn personnalisé (comme il le fait pour l'email), mais c'est le commercial qui l'envoie manuellement depuis son propre LinkedIn — zéro risque, juste un gain de temps de rédaction.
- Option B (plus risquée) : automatisation via un outil tiers type PhantomBuster, avec le risque de suspension de compte assumé par chaque commercial — à ne faire qu'avec un avertissement explicite.

**Décision à prendre** : Option A pour commencer ?

**Effort estimé** : petit pour l'option A (Aaron génère déjà du texte, il "suffit" d'un nouveau type de brouillon LinkedIn dans son interface).

---

## 6. Intégrations CRM (chantier #20)

**Contexte** : Certaines sociétés clientes ont probablement déjà un CRM (HubSpot, Salesforce, Pipedrive...) et voudraient que les prospects/RDV de Meet Aaron y apparaissent automatiquement.

**Proposition** :
- Commencer par **un seul CRM** plutôt que plusieurs en parallèle — HubSpot a l'API la plus simple et une offre gratuite généreuse, ce qui en fait souvent le premier choix pour ce type d'intégration.
- Synchronisation one-way pour commencer (Meet Aaron → CRM) : création automatique du contact et du RDV dans le CRM dès qu'ils existent côté Meet Aaron, via un webhook sortant.
- Chaque société cliente connecte son propre compte CRM (OAuth), configurable depuis Préférences.

**Décision à prendre** : quel CRM prioriser (HubSpot par défaut si tu n'as pas de préférence, sauf si Open X ou un client pilote utilise déjà autre chose) ?

**Effort estimé** : moyen à important selon le nombre de CRMs à supporter — prévoir un chantier par CRM plutôt qu'une solution générique dès le départ.

---

## 7. Aaron "Sales" vs Aaron "Customer" (chantier #22)

**Contexte** : Aujourd'hui Aaron a un seul rôle : aider à la prospection et à la prise de RDV commerciaux. L'idée d'un Aaron "Customer" serait un assistant orienté support/fidélisation des clients existants, après la vente.

**Proposition de cadrage (à affiner avec toi)** :
- Aaron "Sales" = ce qui existe aujourd'hui (prospection, qualification, RDV).
- Aaron "Customer" = un second mode/persona, avec accès à l'historique du client (pas aux prospects), pensé pour répondre aux questions d'un client existant, remonter les signaux d'insatisfaction, ou proposer des upsells — mais avec un system prompt et des outils différents (pas les mêmes API : pas de sourcing de nouveaux prospects par exemple).
- Techniquement, ça peut réutiliser une bonne partie de l'infrastructure existante (chat, base de connaissance des documents/résumé d'activité) avec un system prompt et un jeu de permissions séparés.

**Décision à prendre** : est-ce un chantier prioritaire à court terme, ou une idée à garder pour plus tard une fois les fonctionnalités actuelles bien rodées ? Si prioritaire, quel est le premier cas d'usage concret que tu veux couvrir (support technique ? renouvellement d'abonnement ? les deux) ?

**Effort estimé** : important — c'est un vrai nouveau produit, pas juste une fonctionnalité.

---

## Résumé — ce qui débloquerait le plus vite

Si tu veux avancer sans tout trancher d'un coup, voici ce qui peut démarrer immédiatement sans aucune décision bloquante de ta part :
- **#5 LinkedIn (option A)** — aucun risque, gain de temps direct pour les commerciaux.
- **#1 Dashboard admin facturation** — juste à confirmer si c'est réservé à toi ou aussi aux patrons clients.

Les autres (CGU, plafond API, push, CRM, Aaron Customer) demandent une vraie décision de ta part avant que je puisse construire quoi que ce soit d'utile.
