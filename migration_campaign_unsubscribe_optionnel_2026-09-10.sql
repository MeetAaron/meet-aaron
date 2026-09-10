-- migration_campaign_unsubscribe_optionnel_2026-09-10.sql
--
-- Lien de désabonnement des campagnes : désormais OPTIONNEL, et DÉSACTIVÉ
-- par défaut (demande d'Alex du 10/09/2026 : « désactive par défaut, j'y
-- tiens »). Jusqu'ici, un pied de page « Pour ne plus recevoir ce type
-- d'email : <lien> » était ajouté à CHAQUE email de campagne, sans échappatoire.
--
-- Ce que la colonne change :
--   false (défaut) → aucun pied de page ; l'email ressemble à un email écrit
--                    à la main, ce qui est le but recherché ;
--   true           → pied de page avec le lien de désabonnement, dans la
--                    langue du commercial.
--
-- Ce qui NE change pas, quelle que soit la valeur :
--   - la route /api/marketing-campaigns/track/unsubscribe/<token> reste
--     active, y compris pour les emails déjà partis avec un lien ;
--   - un prospect marqué marketing_opt_out n'est jamais réintégré à un envoi ;
--   - Aaron continue d'arrêter le contact sur un « ne me recontactez plus ».
--
-- Réserve professionnelle consignée ici pour l'avenir : le RGPD (art. 21) et
-- le Spam Act australien de 2003 imposent un moyen d'opposition dans chaque
-- message commercial, sans seuil de volume ni exception B2B. Le défaut à
-- false est une décision produit assumée par Alex, pas un oubli.

alter table public.marketing_campaigns
  add column if not exists include_unsubscribe boolean not null default false;

comment on column public.marketing_campaigns.include_unsubscribe is
  'true = ajouter le pied de page de désabonnement aux emails de cette campagne. Défaut false (décision Alex 10/09/2026).';
