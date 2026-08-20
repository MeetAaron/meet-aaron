-- migration_youtrust_signature_2026-08-20.sql
-- Docx "OPPORTUNITES A4" : "tu me mets en place yousign ? fais le merci."
-- Yousign a changé de nom pour Youtrust en 2026 (même produit, même API) —
-- voir lib/youtrust.ts. Jusqu'ici, prospects.signature_external_link /
-- signature_requested_at ne servaient qu'à COLLER MANUELLEMENT un lien de
-- signature généré ailleurs (voir action "set_signature_link" dans
-- app/api/prospects/[id]/route.ts). Ces deux colonnes existent déjà et sont
-- réutilisées telles quelles pour l'intégration automatique — inchangées
-- ici.
--
-- Nouvelles colonnes, uniquement pour le suivi du statut de signature
-- lancée via l'API Youtrust :
--   - youtrust_signature_request_id : id de la demande côté Youtrust,
--     nécessaire pour retrouver le bon prospect quand le webhook Youtrust
--     notifie un changement de statut (voir app/api/webhooks/youtrust).
--   - signature_status : 'en_attente' (envoyé, en attente de signature),
--     'signe', ou 'refuse' — piloté par le webhook, jamais modifié à la main.
--   - signature_completed_at : date de signature effective (ou de refus).
--
-- Quand signature_status passe à 'signe', le webhook déclenche AUSSI le
-- même effet que l'action manuelle "set_deal_stage = signé" (is_won,
-- won_at, first_order_confirmed_at) — voir app/api/webhooks/youtrust/route.ts.

alter table prospects add column if not exists youtrust_signature_request_id text;
alter table prospects add column if not exists signature_status text;
alter table prospects add column if not exists signature_completed_at timestamptz;
