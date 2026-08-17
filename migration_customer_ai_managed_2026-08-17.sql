-- migration_customer_ai_managed_2026-08-17.sql
-- Bascule "Aaron gère ce client" (emails + devis) par client gagné, exposée
-- dans Aaron Client (app/app/customer/page.jsx). Défaut à true pour ne rien
-- casser sur les clients déjà gérés par Aaron aujourd'hui (comportement
-- inchangé tant que le commercial ne désactive pas explicitement l'option) —
-- voir handleWonCustomerMessage dans app/api/cron/check-inbox/route.ts.
alter table prospects add column if not exists ai_managed boolean not null default true;
