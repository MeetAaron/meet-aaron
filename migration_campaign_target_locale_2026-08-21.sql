-- migration_campaign_target_locale_2026-08-21.sql
-- Ajoute la langue cible d'une campagne : sur quelle langue Aaron doit
-- rédiger le tout premier email de prospection envoyé à un prospect trouvé
-- par cette campagne (avant toute réponse du prospect — une fois qu'il a
-- répondu, Aaron continue d'adapter la langue à la sienne comme aujourd'hui,
-- voir lib/aaron_system_prompt.md section "LANGUE DE LA RÉPONSE"). Utile
-- pour une campagne visant un pays où la langue attendue diffère de celle
-- du compte du commercial (ex: campagne Australie -> anglais, même si le
-- commercial utilise l'app en français).
--
-- Nullable et idempotente : une campagne existante sans valeur garde le
-- comportement actuel (langue du commercial par défaut) — voir lib/aaron.ts
-- (campaignContext) et lib/aaron_system_prompt.md.

alter table prospecting_campaigns add column if not exists target_locale text;
