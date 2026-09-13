-- diagnostic_langue_interface_2026-09-13.sql
--
-- « Quand on visualise, le texte est en français alors même qu'il a été
--   envoyé en anglais. »
--
-- Deux langues cohabitent dans Aaron, et c'est VOULU :
--
--   • ce que lit le PROSPECT (email_draft) — écrit dans SA langue à lui ;
--   • ce que lit le COMMERCIAL (aaron_advice, personality_notes,
--     action_required_from_sales) — écrit dans users.locale.
--
-- Donc un email parti en anglais avec des conseils en français, ce n'est un
-- bug QUE si users.locale n'est pas la langue que tu as choisie à l'écran.
-- Or le sélecteur de langue met localStorage à jour immédiatement, et la
-- base seulement en « fire and forget » : si cet appel a échoué une fois,
-- l'interface est en anglais et la base est restée en français.
--
-- C'est exactement ce que cette requête vérifie.

-- ── 1. La langue enregistrée pour chaque commercial ──────────────────────
select
  u.email,
  u.locale,
  case
    when u.locale is null then 'NULL — Aaron écrit en français par défaut'
    when u.locale = 'fr'  then 'français'
    else u.locale
  end as langue_des_contenus_generes
from public.users u
order by u.email;

-- ── 2. Correction pour la boîte de test de la vidéo ──────────────────────
-- À jouer si la ligne ci-dessus affiche autre chose que 'en' alors que ton
-- interface est en anglais.
-- update public.users set locale = 'en' where email = 'testcustomer1980@gmail.com';

-- ── 3. Voir, prospect par prospect, dans quelle langue Aaron a écrit ─────
-- Compare le corps de l'email envoyé (langue du prospect) avec le conseil
-- destiné au commercial (langue du commercial).
select
  p.full_name,
  p.email,
  left(coalesce(p.aaron_advice, ''), 90)  as conseil_pour_le_commercial,
  left(coalesce(m.body, ''), 90)          as email_envoye_au_prospect,
  m.created_at
from public.prospects p
left join public.conversations c on c.prospect_id = p.id and c.channel = 'email'
left join public.messages m on m.conversation_id = c.id and m.direction = 'outbound'
where p.created_at > now() - interval '3 days'
order by m.created_at desc nulls last
limit 20;
