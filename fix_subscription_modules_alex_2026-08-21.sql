-- fix_subscription_modules_alex_2026-08-21.sql
--
-- Contexte : sur "Mes résultats" (et maintenant sur le tableau de bord), les
-- sections Opportunités/Clients affichent un badge "module non actif" basé
-- sur companies.offer_as_active / companies.offer_ac_active (voir
-- app/api/subscription/modules/route.ts et app/api/preferences/route.ts). Ces
-- deux colonnes ne passent à true QUE via un vrai abonnement Stripe (une
-- ligne d'abonnement Aaron Sales / Aaron Clients) — il n'y a pas de bug dans
-- le code de vérification (relu ligne par ligne), juste des données : si ton
-- compte de test n'a jamais été abonné à ces deux modules via Stripe, elles
-- restent à false/NULL par défaut, d'où le badge alors même que tu peux
-- naviguer librement (aucune route API ne bloque réellement l'accès —
-- isModuleActive() n'est utilisée que pour l'affichage, jamais en
-- enforcement côté serveur).
--
-- 1) D'ABORD : vérifie juste l'état actuel (ne modifie rien).
select
  c.id as company_id,
  c.offer_ap_active,
  c.offer_as_active,
  c.offer_ac_active,
  c.stripe_subscription_id
from companies c
join users u on u.company_id = c.id
where u.email = 'alexandre.fevre01@gmail.com';

-- 2) Si le résultat ci-dessus montre offer_as_active/offer_ac_active à
--    false ou NULL et que tu veux activer les deux modules pour TON compte
--    sans repasser par un vrai paiement Stripe (cas normal pour un compte
--    de test/démo), décommente les 2 lignes ci-dessous et exécute-les.
--
--    ATTENTION : ça ne crée AUCUNE ligne d'abonnement Stripe réelle. Si tu
--    cliques ensuite sur "désactiver" un de ces modules dans Préférences >
--    Abonnement, ça échouera (le code essaiera d'annuler une ligne Stripe
--    qui n'existe pas) — pour un usage normal avec facturation réelle, le
--    bon chemin reste le flux existant dans Préférences.

-- update companies set offer_as_active = true, offer_ac_active = true
-- where id = (select company_id from users where email = 'alexandre.fevre01@gmail.com' limit 1);
