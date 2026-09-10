-- migration_meeting_link_2026-09-10.sql
--
-- LIEN DE VISIO PERMANENT du commercial.
--
-- Aaron sait créer un lien de réunion à usage unique quand une boîte Google
-- (Google Meet) ou Microsoft 365 (Teams) est connectée. Pour une boîte
-- « Autre boîte mail » (IMAP : OVH, Gandi, Ionos…), il n'existe AUCUN moyen
-- d'en générer un : Meet exige un compte Google, Teams un compte Microsoft.
--
-- La solution qui marche partout : le commercial colle une fois sa salle de
-- réunion permanente (Google Meet perso, Teams, Zoom, Whereby…), et Aaron la
-- réutilise pour chaque RDV visio. C'est aussi le réglage de ceux qui, même
-- avec Google ou Microsoft connecté, préfèrent leur propre salle — dans ce
-- cas ce lien l'emporte sur le lien généré automatiquement.
--
-- Sans lien renseigné ET sans agenda connecté, Aaron évite de proposer la
-- visio (téléphone ou présentiel), plutôt que de promettre une visio sans
-- lien à un prospect.

alter table public.users
  add column if not exists meeting_link text;

comment on column public.users.meeting_link is
  'Salle de visio permanente du commercial (Meet/Teams/Zoom/Whereby). Utilisée pour les RDV visio, prioritaire sur le lien généré par Google/Microsoft.';
