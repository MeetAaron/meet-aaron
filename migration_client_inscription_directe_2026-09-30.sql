-- migration_client_inscription_directe_2026-09-30.sql
--
-- LES CLIENTS QUI ARRIVENT TOUT SEULS.
--
-- Demande d'Alex (30/09/2026) : « certains, par le bouche a oreille,
-- installeront directement l'appli eux-memes et paieront. Il faut que je les
-- voie dans mes clients Meet Aaron. »
--
-- Ce qui existait deja : lib/prospect-conversion.ts bascule en client gagne
-- un prospect DEJA DEMARCHE qui finit par payer. Ce qui manquait : celui qui
-- n'a jamais ete demarche. Il payait, son compte se creait... et il
-- n'apparaissait nulle part dans le suivi commercial de Meet Aaron.
--
-- Une quatrieme provenance devient donc necessaire. La distinction n'est pas
-- cosmetique : « combien de clients viennent de la prospection, combien du
-- bouche a oreille » est exactement le chiffre qui dit s'il faut continuer a
-- payer pour prospecter — ecraser les deux sous 'amene_par_toi' rendrait ce
-- chiffre impossible a lire.

alter table public.prospects drop constraint if exists prospects_origin_check;
alter table public.prospects add constraint prospects_origin_check
  check (origin in (
    'amene_par_aaron',      -- trouve et demarche par Aaron
    'amene_par_toi',        -- ajoute a la main ou importe
    'reactive_par_aaron',   -- contact perdu, reintroduit par Aaron
    'inscription_directe'   -- s'est inscrit et a paye sans avoir ete demarche
  ));

comment on column public.prospects.origin is
  'Provenance : amene_par_aaron | amene_par_toi | reactive_par_aaron | inscription_directe (inscription spontanee, voir lib/self-signup-client.ts).';

-- Verification : repartition actuelle.
select origin, count(*) as prospects
from public.prospects
group by origin
order by prospects desc;
