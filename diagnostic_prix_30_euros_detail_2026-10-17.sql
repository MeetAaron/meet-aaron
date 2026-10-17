-- DIAGNOSTIC 2 (lecture seule) 17/10/2026 : le détail des 3 endroits trouvés.
-- Le premier diagnostic n'affichait que « € » ou « euros » : son motif avait
-- des parenthèses capturantes, et substring() renvoie alors seulement le
-- contenu de la parenthèse. Ici, (?: ) partout : on voit la phrase entière.
-- Ne modifie rien.
WITH motif AS (SELECT '30[[:space:]]?(?:€|eur|euros)|€[[:space:]]?30(?:[^0-9]|$)'::text AS re)
SELECT '1. profil société' AS source, kv.key AS champ,
       substring(kv.value from '.{0,160}(?:' || (SELECT re FROM motif) || ').{0,160}') AS extrait
FROM companies c, jsonb_each_text(to_jsonb(c)) kv
WHERE c.id = '5c1841ab-f734-42c3-83e9-f20419e6e811'
  AND kv.value ~* (SELECT re FROM motif)
UNION ALL
SELECT '2. document ' || d.file_name, kv.key,
       substring(kv.value from '.{0,160}(?:' || (SELECT re FROM motif) || ').{0,160}')
FROM company_documents d, jsonb_each_text(to_jsonb(d)) kv
WHERE d.id = '1d2a4eab-482b-47f9-a299-3e430cf913f0'
  AND kv.value ~* (SELECT re FROM motif)
UNION ALL
SELECT '2. document : réglages', 'joint aux réponses / langue / dans le contexte d''Aaron',
       coalesce(d.attach_to_first_email::text, '?') || ' / ' || coalesce(d.language, 'toutes') || ' / ' || coalesce(d.included_in_aaron_context::text, '?')
FROM company_documents d
WHERE d.id = '1d2a4eab-482b-47f9-a299-3e430cf913f0'
UNION ALL
SELECT '3. email à Axel (' || to_char(m.sent_at, 'DD/MM/YYYY') || ')', m.subject,
       substring(m.body from '.{0,200}(?:' || (SELECT re FROM motif) || ').{0,200}')
FROM messages m
WHERE m.id = '2ba1eb7b-f509-4bc2-bfb4-1b04273f806b'
UNION ALL
SELECT '4. réponse en attente pour ' || p.to_email, p.subject,
       substring(p.body from '.{0,160}(?:' || (SELECT re FROM motif) || ').{0,160}')
FROM pending_aaron_replies p
WHERE p.sent_at IS NULL AND p.cancelled_at IS NULL
  AND p.body ~* (SELECT re FROM motif)
ORDER BY 1;
