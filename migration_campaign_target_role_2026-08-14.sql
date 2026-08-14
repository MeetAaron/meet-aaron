-- migration_campaign_target_role_2026-08-14.sql
-- Ajoute le ciblage de poste/rôle à une campagne : qui, chez les entreprises
-- trouvées, Aaron doit chercher en priorité comme contact (fondateur/dirigeant,
-- responsable commercial, responsable achats, RH, ou peu importe tant que
-- c'est un décisionnaire). Voir lib/sourcing.ts (searchContactAtCompany) et
-- app/api/campaigns/chat/route.ts pour l'utilisation.

alter table prospecting_campaigns add column if not exists target_role text;
