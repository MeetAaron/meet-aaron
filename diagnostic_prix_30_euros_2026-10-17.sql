-- DIAGNOSTIC (lecture seule) 17/10/2026 : où Aaron peut-il encore lire « 30 € » ?
-- Quand Aaron prospecte pour MEET AARON, il présente l'offre à partir des
-- données de la société : profil d'entreprise, premier email par défaut,
-- catalogue produits, documents (plaquette…), notes des campagnes. Le prix
-- actuel est 59 € HT. Cette requête liste chaque endroit qui contient encore
-- « 30 € » / « 30 euros », plus les emails ENVOYÉS ces 90 derniers jours qui
-- le mentionnent. Elle ne modifie rien.
WITH mes_societes AS (
  SELECT id FROM companies
  WHERE name ILIKE '%meet aaron%'
     OR id IN (SELECT company_id FROM users WHERE email ILIKE 'aaron@meetaaron.app')
),
motif AS (SELECT '30[[:space:]]?(€|eur|euros)|€[[:space:]]?30([^0-9]|$)'::text AS re)
SELECT 'profil société' AS source, c.id::text AS ligne,
       substring(to_jsonb(c)::text from '.{0,80}(?:' || (SELECT re FROM motif) || ').{0,80}') AS extrait
FROM companies c
WHERE c.id IN (SELECT id FROM mes_societes) AND to_jsonb(c)::text ~* (SELECT re FROM motif)
UNION ALL
SELECT 'catalogue produits', p.id::text,
       coalesce(substring(to_jsonb(p)::text from '.{0,80}(?:' || (SELECT re FROM motif) || ').{0,80}'),
                p.name || ' = ' || p.unit_price_eur || ' €')
FROM products p
WHERE p.company_id IN (SELECT id FROM mes_societes)
  AND (to_jsonb(p)::text ~* (SELECT re FROM motif) OR p.unit_price_eur = 30)
UNION ALL
SELECT 'document : ' || coalesce(d.file_name, ''), d.id::text,
       substring(to_jsonb(d)::text from '.{0,80}(?:' || (SELECT re FROM motif) || ').{0,80}')
FROM company_documents d
WHERE d.company_id IN (SELECT id FROM mes_societes) AND to_jsonb(d)::text ~* (SELECT re FROM motif)
UNION ALL
SELECT 'campagne : ' || coalesce(pc.zone_label, ''), pc.id::text,
       substring(to_jsonb(pc)::text from '.{0,80}(?:' || (SELECT re FROM motif) || ').{0,80}')
FROM prospecting_campaigns pc
WHERE pc.company_id IN (SELECT id FROM mes_societes) AND to_jsonb(pc)::text ~* (SELECT re FROM motif)
UNION ALL
SELECT 'email envoyé à ' || m.recipient_email, m.id::text,
       substring(m.body from '.{0,80}(?:' || (SELECT re FROM motif) || ').{0,80}')
FROM messages m
WHERE m.direction = 'outbound'
  AND m.sent_at > now() - interval '90 days'
  AND m.sender_email ILIKE '%@meetaaron.app'
  AND m.body ~* (SELECT re FROM motif)
ORDER BY 1;
