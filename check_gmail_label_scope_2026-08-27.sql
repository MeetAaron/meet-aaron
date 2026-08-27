-- Vérification à lancer dans Supabase SQL editor (lecture seule, aucune
-- modification) : sert à confirmer si la connexion Gmail actuelle a bien
-- obtenu le scope "gmail.labels" (nécessaire pour poser le libellé
-- "🤖 Géré par Aaron" — voir app/api/auth/google/route.ts, commentaire du
-- 25/08/2026, et app/app/connexions/page.jsx, googleMissingLabelScope).
--
-- Contexte (27/08/2026) : Alex a déconnecté puis reconnecté Gmail et recréé
-- un prospect test, mais le libellé n'apparaît toujours pas. Le bug du
-- "fire-and-forget" (await manquant) est corrigé et déployé en production —
-- cette requête sert à écarter (ou confirmer) une deuxième cause possible :
-- le scope gmail.labels qui, avec le consentement granulaire de Google, peut
-- être décoché par l'utilisateur sur l'écran d'autorisation même si l'app le
-- demande.
select
  provider,
  provider_account_email,
  scopes,
  'https://www.googleapis.com/auth/gmail.labels' = any(scopes) as has_label_scope,
  created_at,
  last_checked_at
from oauth_connections
where provider = 'google'
order by created_at desc;
