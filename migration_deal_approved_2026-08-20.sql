-- migration_deal_approved_2026-08-20.sql
-- Docx "OPPORTUNITES A1" : quand Aaron détecte dans un email reçu un accord
-- ferme du prospect ("bon pour accord", "j'ai validé le devis", etc.), le
-- backend bascule automatiquement ce prospect en client gagné (même logique
-- que l'action manuelle "set_deal_stage = signé" : is_won, won_at,
-- first_order_confirmed_at) et prévient le commercial. Cette colonne stocke
-- la phrase d'explication qu'Aaron génère pour justifier la bascule
-- automatique (ex: "Le client a écrit « bon pour accord » en réponse au
-- devis envoyé le 12 août."), affichée dans Aaron Opportunité / Aaron
-- Client à côté du badge "Client" pour que le commercial comprenne d'où
-- vient la conversion sans avoir à rouvrir tout l'historique d'emails.
--
-- Voir lib/aaron.ts (champ deal_approved), lib/aaron_system_prompt.md
-- (section "DÉTECTION D'UN ACCORD FERME"), et
-- app/api/cron/check-inbox/route.ts pour la logique de bascule.

alter table prospects add column if not exists won_reason text;
