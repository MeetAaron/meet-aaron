-- diagnostic_message_tronque_2026-09-11.sql
--
-- NE MODIFIE RIEN.
--
-- Ma première hypothèse (une image base64 dans la signature) est MORTE :
-- ton diagnostic du 11/09 montre 0 caractère de signature, 0 d'image, 0 de
-- bandeau, et aucun base64, sur les 8 comptes. Le corps ajouté sous
-- « Bonne journée, » est donc vide — et pourtant Gmail coupe.
--
-- Il ne reste que deux endroits où la taille peut exploser :
--   1) le corps rédigé par Aaron lui-même (bug de génération : contenu
--      répété, prompt recopié, chaîne à rallonge) ;
--   2) rien dans notre code — et alors c'est la couche de transport, et
--      seule l'en-tête brute reçue par Gmail le dira.
--
-- Cette requête tranche entre les deux. Gmail coupe vers 102 400 octets.

-- ── 1. Les plus gros corps de messages envoyés par Aaron ────────────────
select
  m.direction,
  m.sender_email,
  m.recipient_email,
  length(m.body)                    as octets_du_corps,
  left(m.body, 120)                 as debut_du_corps,
  right(m.body, 200)                as fin_du_corps,   -- c'est ICI que ça coupe
  m.created_at
from public.messages m
order by length(m.body) desc nulls last
limit 20;

-- ── 2. Le verdict en une ligne ──────────────────────────────────────────
select
  count(*)                                        as nb_messages,
  max(length(body))                               as plus_gros_corps_octets,
  round(avg(length(body)))                        as corps_moyen_octets,
  count(*) filter (where length(body) > 102400)   as au_dessus_de_la_limite_gmail,
  count(*) filter (where length(body) > 20000)    as anormalement_gros
from public.messages;
