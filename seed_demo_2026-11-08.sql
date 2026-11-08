-- seed_demo_2026-11-08.sql
--
-- Remplit la société « Démo Meet Aaron » (compte aaron+demo@meetaaron.app)
-- avec des données FICTIVES pour : les captures d'écran des stores, la revue
-- Apple (compte de démonstration), les testeurs Android.
--
-- Deux campagnes : une française (Lyon, restaurants et traiteurs) et une
-- australienne (Perth, artisans du bâtiment), avec sociétés, contacts,
-- conversations, rendez-vous, une opportunité et un client gagné.
-- Toutes les entreprises, personnes et adresses email sont inventées
-- (domaines en .example.* ne pouvant recevoir d'email réel).
--
-- Rejouable : efface d'abord ce qu'il a créé (repère : found_by_campaign_id
-- des deux campagnes « démo »), jamais les données d'une autre société.

do $$
declare
  v_company uuid;
  v_user uuid;
  v_camp_fr uuid;
  v_camp_en uuid;
  v_pc uuid;
  v_p uuid;
  v_conv uuid;
begin
  select c.id, u.id into v_company, v_user
  from public.companies c
  join public.users u on u.company_id = c.id and u.email = 'aaron+demo@meetaaron.app'
  where c.name = 'Démo Meet Aaron'
  limit 1;
  if v_company is null then
    raise exception 'Société « Démo Meet Aaron » ou utilisateur aaron+demo@ introuvable — lancer d''abord la SQL du compte démo.';
  end if;

  -- Nettoyage des précédents passages de ce script.
  delete from public.messages m using public.conversations cv, public.prospects p
    where m.conversation_id = cv.id and cv.prospect_id = p.id and p.company_id = v_company;
  delete from public.conversations cv using public.prospects p where cv.prospect_id = p.id and p.company_id = v_company;
  delete from public.appointments a using public.prospects p where a.prospect_id = p.id and p.company_id = v_company;
  delete from public.prospects where company_id = v_company;
  delete from public.prospect_companies where company_id = v_company;
  delete from public.prospecting_campaigns where company_id = v_company;

  -- ---------------------------------------------------------------- FR
  insert into public.prospecting_campaigns (company_id, assigned_user_id, zone_label, zone_type, zone_codes, sector_keywords, company_sizes, target_count, context_notes, target_role, target_locale, status, created_at)
  values (v_company, v_user, 'Lyon et alentours', 'zone', array['69'], array['restaurant', 'traiteur', 'brasserie'], array['artisan_tpe','pme'], 20,
          'Mes clients habituels sont des restaurateurs pressés : aller droit au but.', 'Gérant ou chef', 'fr', 'en_cours', now() - interval '12 days')
  returning id into v_camp_fr;

  -- 1. Maison Delorme — opportunité, RDV fait, devis attendu
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary, aaron_opinion, aaron_opinion_fit, aaron_opinion_locale, aaron_opinion_generated_at)
  values (v_company, 'maison-delorme.example.fr', 'Maison Delorme Traiteur', v_camp_fr, 'https://maison-delorme.example.fr', '14 rue de la République, 69002 Lyon', 'Traiteur événementiel',
          'Traiteur événementiel lyonnais fondé en 2009, 18 salariés, mariages et séminaires d''entreprise, cuisine de saison.',
          'Cible idéale : un traiteur qui organise des séminaires d''entreprise a exactement le besoin que vous couvrez, et la taille (18 salariés) permet une décision rapide par la gérante.', 'strong', 'fr', now() - interval '10 days')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, phone, job_title, status, origin, aaron_advice, personality_type, personality_notes, conviction_score, conviction_reason, deal_stage, deal_stage_updated_at, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Claire Delorme', 'claire.delorme@maison-delorme.example.fr', '+33 4 72 00 00 11', 'Gérante', 'bleu', 'amene_par_aaron',
          'Elle a demandé un devis pour la saison des séminaires : envoyez-le avant jeudi, elle compare deux prestataires.', 'dominant',
          'Réponses courtes et directes, décide vite. Parlez résultats et délais, pas détails.', 72, 'Rendez-vous fait, devis demandé spontanément, délai de décision annoncé.', 'rdv_fait', now() - interval '2 days', now() - interval '2 days', now() - interval '10 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'claire.delorme@maison-delorme.example.fr', E'Bonjour Claire,\n\nJ''ai vu que Maison Delorme organise de plus en plus de séminaires d''entreprise. Nous aidons les traiteurs à remplir leur calendrier hors saison des mariages, sans démarchage de leur part.\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?\n\nBien à vous,', now() - interval '9 days'),
    (v_conv, 'inbound', 'claire.delorme@maison-delorme.example.fr', 'aaron+demo@meetaaron.app', E'Bonjour,\n\nOui, mardi 10h me va. Envoyez-moi une invitation.\n\nClaire Delorme', now() - interval '8 days'),
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'claire.delorme@maison-delorme.example.fr', E'Parfait Claire, c''est confirmé pour mardi 10h par téléphone. Vous recevrez une invitation pour votre agenda.\n\nÀ mardi,', now() - interval '8 days'),
    (v_conv, 'inbound', 'claire.delorme@maison-delorme.example.fr', 'aaron+demo@meetaaron.app', E'Merci pour l''échange de ce matin. Pouvez-vous m''envoyer un devis pour la saison des séminaires (septembre à décembre) ? Je compare avec un autre prestataire d''ici jeudi.\n\nClaire', now() - interval '2 days');
  insert into public.appointments (prospect_id, user_id, type, proposed_at, status, duration_minutes, outcome, outcome_mood, outcome_recorded_at, created_at)
  values (v_p, v_user, 'telephonique', now() - interval '2 days' + interval '10 hours', 'validé', 30, 'devis', 'bien', now() - interval '2 days', now() - interval '8 days');

  -- 2. Bistrot Les Tilleuls — a répondu, en bonne voie
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary, aaron_opinion, aaron_opinion_fit, aaron_opinion_locale, aaron_opinion_generated_at)
  values (v_company, 'bistrot-les-tilleuls.example.fr', 'Bistrot Les Tilleuls', v_camp_fr, 'https://bistrot-les-tilleuls.example.fr', '3 place des Tilleuls, 69006 Lyon', 'Restaurant',
          'Bistrot de quartier, 40 couverts, équipe de 6, ouvert midi et soir, clientèle de bureaux le midi.',
          'Bonne cible : clientèle de bureaux le midi, donc intérêt réel pour les repas d''équipe et les privatisations. Décideur unique, le chef-propriétaire.', 'medium', 'fr', now() - interval '9 days')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, phone, job_title, status, origin, aaron_advice, personality_type, personality_notes, conviction_score, conviction_reason, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Julien Mercier', 'julien.mercier@bistrot-les-tilleuls.example.fr', '+33 4 78 00 00 22', 'Chef-propriétaire', 'vert', 'amene_par_aaron',
          'Il a demandé des exemples concrets : répondez avec deux cas clients proches de son bistrot, pas une plaquette.', 'influent',
          'Chaleureux, aime les anecdotes et les exemples. Soignez le relationnel avant les chiffres.', 55, 'A répondu avec intérêt, pose des questions, pas encore de rendez-vous.', now() - interval '1 day', now() - interval '9 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'julien.mercier@bistrot-les-tilleuls.example.fr', E'Bonjour Julien,\n\nLes Tilleuls a une belle clientèle de bureaux le midi. Nous aidons les restaurants comme le vôtre à remplir les soirs de semaine avec des repas d''équipe, sans y passer leurs après-midis.\n\nUn exemple concret vous intéresserait ?\n\nBien à vous,', now() - interval '8 days'),
    (v_conv, 'inbound', 'julien.mercier@bistrot-les-tilleuls.example.fr', 'aaron+demo@meetaaron.app', E'Bonjour, pourquoi pas. Vous avez des exemples de restaurants qui l''ont fait ? Combien ça coûte ?\n\nJulien', now() - interval '1 day');

  -- 3. Pâtisserie Rozier — contactée, pas encore de réponse (relance prévue)
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary)
  values (v_company, 'patisserie-rozier.example.fr', 'Pâtisserie Rozier', v_camp_fr, 'https://patisserie-rozier.example.fr', '27 cours Vitton, 69006 Lyon', 'Pâtisserie',
          'Pâtisserie-chocolaterie familiale, deux boutiques, commandes d''entreprise en fin d''année.')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, job_title, status, origin, aaron_advice, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Sophie Rozier', 'sophie.rozier@patisserie-rozier.example.fr', 'Co-gérante', 'jaune', 'amene_par_aaron',
          'Pas de réponse au premier email : Aaron relance jeudi avec un angle « coffrets de fin d''année pour entreprises ».', now() - interval '5 days', now() - interval '6 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'sophie.rozier@patisserie-rozier.example.fr', E'Bonjour Sophie,\n\nVos coffrets de fin d''année sont très demandés par les entreprises lyonnaises. Nous aidons les pâtisseries à prendre ces commandes plus tôt dans la saison, sans relances manuelles.\n\nJe vous en dis plus en 10 minutes si vous le souhaitez.\n\nBien à vous,', now() - interval '5 days');

  -- 4. Brasserie du Parc — client gagné
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary)
  values (v_company, 'brasserie-du-parc.example.fr', 'Brasserie du Parc', v_camp_fr, 'https://brasserie-du-parc.example.fr', '1 boulevard des Belges, 69006 Lyon', 'Brasserie',
          'Brasserie de 120 couverts face au parc de la Tête d''Or, salle privatisable, 25 salariés.')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, phone, job_title, status, origin, aaron_advice, personality_type, conviction_score, conviction_reason, deal_stage, deal_stage_updated_at, is_won, won_at, first_order_confirmed_at, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Marc Vidal', 'marc.vidal@brasserie-du-parc.example.fr', '+33 4 72 00 00 44', 'Directeur', 'bleu', 'amene_par_aaron',
          'Client signé : Aaron lui demandera dans 30 jours s''il connaît d''autres restaurateurs intéressés.', 'stable', 90, 'Devis signé le mois dernier.', 'signe', now() - interval '20 days', true, now() - interval '20 days', now() - interval '20 days', now() - interval '20 days', now() - interval '11 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'marc.vidal@brasserie-du-parc.example.fr', E'Bonjour Marc,\n\nVotre salle privatisable face au parc est un atout pour les séminaires. Nous aidons les brasseries à la remplir en semaine. 15 minutes pour en parler ?\n\nBien à vous,', now() - interval '30 days'),
    (v_conv, 'inbound', 'marc.vidal@brasserie-du-parc.example.fr', 'aaron+demo@meetaaron.app', E'Bonjour, oui, jeudi 15h si vous êtes disponible.\n\nMarc Vidal', now() - interval '29 days'),
    (v_conv, 'inbound', 'marc.vidal@brasserie-du-parc.example.fr', 'aaron+demo@meetaaron.app', E'Devis signé et renvoyé ce matin. On démarre le 1er du mois.\n\nMarc', now() - interval '20 days');
  insert into public.appointments (prospect_id, user_id, type, proposed_at, status, duration_minutes, outcome, outcome_mood, outcome_recorded_at, created_at)
  values (v_p, v_user, 'physique', now() - interval '27 days', 'validé', 60, 'opportunite', 'bien', now() - interval '27 days', now() - interval '29 days');

  -- 5. Auberge des Monts d'Or — perdue (déjà équipée)
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry)
  values (v_company, 'auberge-monts-dor.example.fr', 'Auberge des Monts d''Or', v_camp_fr, 'https://auberge-monts-dor.example.fr', 'Route de la Croix, 69450 Saint-Cyr-au-Mont-d''Or', 'Restaurant gastronomique')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, job_title, status, origin, aaron_advice, deal_stage, deal_stage_updated_at, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Hélène Garnier', 'helene.garnier@auberge-monts-dor.example.fr', 'Propriétaire', 'rouge', 'amene_par_aaron',
          'Déjà équipée et satisfaite : Aaron arrête le contact et reviendra dans six mois.', 'perdu', now() - interval '3 days', now() - interval '3 days', now() - interval '8 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'helene.garnier@auberge-monts-dor.example.fr', E'Bonjour Hélène,\n\nL''Auberge des Monts d''Or accueille des mariages et des séminaires toute l''année. Nous aidons les maisons comme la vôtre à remplir les semaines creuses. Auriez-vous 15 minutes ?\n\nBien à vous,', now() - interval '7 days'),
    (v_conv, 'inbound', 'helene.garnier@auberge-monts-dor.example.fr', 'aaron+demo@meetaaron.app', E'Merci, mais nous travaillons déjà avec une agence et nous en sommes satisfaits.\n\nHélène Garnier', now() - interval '3 days');

  -- 6. Le Comptoir d'Ainay — rendez-vous à venir (visio) la semaine prochaine
  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary)
  values (v_company, 'comptoir-ainay.example.fr', 'Le Comptoir d''Ainay', v_camp_fr, 'https://comptoir-ainay.example.fr', '8 rue Vaubecour, 69002 Lyon', 'Restaurant', 'Restaurant bistronomique, 50 couverts, chef passé par deux maisons étoilées, ouvert depuis 2021.')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, phone, job_title, status, origin, aaron_advice, personality_type, personality_notes, conviction_score, conviction_reason, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Thomas Renard', 'thomas.renard@comptoir-ainay.example.fr', '+33 4 78 00 00 66', 'Chef et associé', 'vert', 'amene_par_aaron',
          'Visio mardi prochain : il veut comprendre le fonctionnement en 20 minutes. Préparez deux exemples de restaurants bistronomiques.', 'consciencieux',
          'Précis, veut des chiffres et un déroulé clair. Évitez les superlatifs.', 60, 'Rendez-vous accepté, questions précises sur le fonctionnement.', now() - interval '1 day', now() - interval '7 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'thomas.renard@comptoir-ainay.example.fr', E'Bonjour Thomas,\n\nLe Comptoir d''Ainay affiche complet le week-end ; nous aidons les restaurants bistronomiques à remplir aussi les mardis et mercredis avec des repas d''entreprise. 20 minutes en visio pour voir si c''est pertinent pour vous ?\n\nBien à vous,', now() - interval '6 days'),
    (v_conv, 'inbound', 'thomas.renard@comptoir-ainay.example.fr', 'aaron+demo@meetaaron.app', E'Bonjour, d''accord pour une visio mardi prochain à 11h. Comment ça fonctionne concrètement ?\n\nThomas Renard', now() - interval '1 day'),
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'thomas.renard@comptoir-ainay.example.fr', E'Parfait Thomas, c''est confirmé pour mardi 11h en visio. Vous recevrez une invitation avec le lien. Je vous montrerai deux cas concrets de restaurants comparables.\n\nÀ mardi,', now() - interval '1 day');
  insert into public.appointments (prospect_id, user_id, type, proposed_at, status, duration_minutes, created_at)
  values (v_p, v_user, 'visio', date_trunc('day', now()) + interval '5 days' + interval '11 hours', 'validé', 30, now() - interval '1 day');

  -- ---------------------------------------------------------------- EN
  insert into public.prospecting_campaigns (company_id, assigned_user_id, zone_label, zone_type, zone_codes, sector_keywords, company_sizes, target_count, context_notes, target_role, target_locale, status, created_at)
  values (v_company, v_user, 'Perth metropolitan area', 'zone', array['WA'], array['plumber', 'electrician', 'joinery'], array['artisan_tpe','pme'], 20,
          'Tradies are busy on site: short emails, propose a phone call early morning.', 'Owner or director', 'en', 'en_cours', now() - interval '6 days')
  returning id into v_camp_en;

  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary, aaron_opinion, aaron_opinion_fit, aaron_opinion_locale, aaron_opinion_generated_at)
  values (v_company, 'swanriverplumbing.example.com.au', 'Swan River Plumbing', v_camp_en, 'https://swanriverplumbing.example.com.au', '12 Canning Highway, South Perth WA 6151', 'Plumbing',
          'Residential and commercial plumbing, 9 staff, emergency call-outs, strata contracts.',
          'Strong fit: strata contracts mean recurring business, and the owner answers emails himself.', 'strong', 'en', now() - interval '5 days')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, phone, job_title, status, origin, aaron_advice, personality_type, personality_notes, conviction_score, conviction_reason, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'James Harper', 'james@swanriverplumbing.example.com.au', '+61 8 9000 0011', 'Owner', 'vert', 'amene_par_aaron',
          'He asked for a call before 7am: Aaron proposed Thursday 6:45. Keep it under 10 minutes.', 'dominant',
          'Blunt and fast. Lead with the outcome, skip the preamble.', 58, 'Replied within a day and asked for a call.', now() - interval '1 day', now() - interval '5 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'james@swanriverplumbing.example.com.au', E'Hi James,\n\nSwan River Plumbing already has strata contracts across South Perth. We help plumbing businesses win more of them without chasing property managers yourself.\n\nWorth a 10-minute call this week?\n\nCheers,', now() - interval '4 days'),
    (v_conv, 'inbound', 'james@swanriverplumbing.example.com.au', 'aaron+demo@meetaaron.app', E'Could be. Call me Thursday before 7, I''m on site after that.\n\nJames', now() - interval '1 day');
  insert into public.appointments (prospect_id, user_id, type, proposed_at, status, duration_minutes, created_at)
  values (v_p, v_user, 'telephonique', date_trunc('day', now()) + interval '3 days' + interval '6 hours 45 minutes', 'proposé', 15, now() - interval '1 day');

  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary)
  values (v_company, 'fremantleelectrical.example.com.au', 'Fremantle Electrical Co', v_camp_en, 'https://fremantleelectrical.example.com.au', '45 High Street, Fremantle WA 6160', 'Electrical contractor',
          'Electrical contractor, 14 staff, solar installations and commercial fit-outs.')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, job_title, status, origin, aaron_advice, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Charlotte Bennett', 'charlotte@fremantleelectrical.example.com.au', 'Director', 'jaune', 'amene_par_aaron',
          'No reply yet: Aaron follows up Monday with the solar-installations angle.', now() - interval '3 days', now() - interval '4 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'charlotte@fremantleelectrical.example.com.au', E'Hi Charlotte,\n\nFremantle Electrical does a lot of solar work. We help electrical contractors fill the quieter months with commercial fit-outs, without cold calling.\n\nHappy to explain in 10 minutes if useful.\n\nKind regards,', now() - interval '3 days');

  insert into public.prospect_companies (company_id, domain, name, found_by_campaign_id, website, address, industry, research_summary)
  values (v_company, 'harperjoinery.example.com.au', 'Harper Joinery', v_camp_en, 'https://harperjoinery.example.com.au', '8 Belmont Avenue, Belmont WA 6104', 'Joinery',
          'Custom joinery for kitchens and offices, 6 staff, family business since 1998.')
  returning id into v_pc;
  insert into public.prospects (company_id, assigned_user_id, prospect_company_id, full_name, email, job_title, status, origin, aaron_advice, last_contact_at, created_at)
  values (v_company, v_user, v_pc, 'Matt Walker', 'matt@harperjoinery.example.com.au', 'Sales director', 'jaune', 'amene_par_aaron',
          'First email sent yesterday. Nothing to do: Aaron watches the inbox.', now() - interval '1 day', now() - interval '2 days')
  returning id into v_p;
  insert into public.conversations (prospect_id, channel) values (v_p, 'email') returning id into v_conv;
  insert into public.messages (conversation_id, direction, sender_email, recipient_email, body, sent_at) values
    (v_conv, 'outbound', 'aaron+demo@meetaaron.app', 'matt@harperjoinery.example.com.au', E'Hi Matt,\n\nHarper Joinery''s office fit-outs caught my eye. We help joinery businesses get in front of fit-out companies and architects before projects are tendered.\n\nWould a short call make sense?\n\nKind regards,', now() - interval '1 day');

  raise notice 'Démo remplie : campagnes % et %', v_camp_fr, v_camp_en;
end $$;

-- Vérification
select c.name, count(distinct pc.id) as societes, count(distinct p.id) as contacts, count(distinct a.id) as rdv
from public.companies c
left join public.prospect_companies pc on pc.company_id = c.id
left join public.prospects p on p.company_id = c.id
left join public.appointments a on a.prospect_id = p.id
where c.name = 'Démo Meet Aaron'
group by c.name;
