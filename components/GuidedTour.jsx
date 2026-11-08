// components/GuidedTour.jsx
'use client';

// Visite guidée « un scénario, pas une liste de pages » — maquette validée
// par Alex le 08/11/2026 (« Je valide ta presentation visite guidée »), avec
// ses corrections :
//   • par défaut Aaron envoie lui-même ; seul le TOUT PREMIER email du compte
//     attend la validation (option « je valide chaque premier email » dans
//     les préférences) ;
//   • dans les préférences : « je te conseille d'y mettre ta signature et
//     ton logo d'entreprise » ;
//   • les exemples (noms, villes, sociétés) sont dans la langue affichée :
//     anglais pour l'anglais, portugais pour le portugais… ;
//   • après « devis demandé », Aaron écrit « je reviens vers vous
//     prochainement avec notre offre » ;
//   • écran « Mes documents » ajouté.
// Affichée dans le parcours Bienvenue (après la fiche entreprise, avant les
// réglages) et sur /app/tour depuis le menu Aide. Aucune donnée réelle :
// les écrans sont des illustrations fixes.

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Megaphone, Users, CalendarDays, MessageCircle, MoreHorizontal, FileText, Bell } from 'lucide-react';

// ---- Exemples localisés -----------------------------------------------------
const EX = {
  fr: { f1: 'Claire', zone: 'Lyon et alentours', sector: 'restaurants, traiteurs', n: '20 entreprises', who: 'Gérant ou chef', c1: 'Maison Delorme Traiteur', p1: 'Claire Delorme', r1: 'gérante', c2: 'Bistrot Les Tilleuls', r2: 'chef-propriétaire', c3: 'Pâtisserie Rozier', r3: 'co-gérante', p3: 'Sophie Rozier', reply: 'Julien Mercier', client: 'Marc Vidal', clientCo: 'Brasserie du Parc', early: 'James Harper', doc1: 'Plaquette 2026.pdf', doc2: 'Tarifs séminaires.xlsx', doc3: 'Devis type.docx' },
  en: { f1: 'Emma', zone: 'Manchester and around', sector: 'restaurants, caterers', n: '20 companies', who: 'Owner or head chef', c1: 'Harper & Co Catering', p1: 'Emma Harper', r1: 'owner', c2: 'The Oak Bistro', r2: 'chef-owner', c3: 'Rowan Bakery', r3: 'co-owner', p3: 'Sophie Rowan', reply: 'James Walker', client: 'Daniel Price', clientCo: 'Riverside Brasserie', early: 'Liam Carter', doc1: 'Brochure 2026.pdf', doc2: 'Event pricing.xlsx', doc3: 'Quote template.docx' },
  de: { f1: 'Katrin', zone: 'München und Umgebung', sector: 'Restaurants, Caterer', n: '20 Unternehmen', who: 'Inhaber oder Küchenchef', c1: 'Feinkost Brandt Catering', p1: 'Katrin Brandt', r1: 'Geschäftsführerin', c2: 'Gasthaus Zur Linde', r2: 'Inhaber und Koch', c3: 'Konditorei Weber', r3: 'Mitinhaberin', p3: 'Sabine Weber', reply: 'Jonas Keller', client: 'Markus Vogel', clientCo: 'Brasserie am Park', early: 'Tobias Lang', doc1: 'Broschüre 2026.pdf', doc2: 'Preise Seminare.xlsx', doc3: 'Angebotsvorlage.docx' },
  it: { f1: 'Chiara', zone: 'Milano e dintorni', sector: 'ristoranti, catering', n: '20 aziende', who: 'Titolare o chef', c1: 'Delizie Moretti Catering', p1: 'Chiara Moretti', r1: 'titolare', c2: 'Trattoria I Tigli', r2: 'chef e titolare', c3: 'Pasticceria Rinaldi', r3: 'cotitolare', p3: 'Sofia Rinaldi', reply: 'Luca Ferrari', client: 'Marco Conti', clientCo: 'Brasserie del Parco', early: 'Andrea Galli', doc1: 'Brochure 2026.pdf', doc2: 'Tariffe eventi.xlsx', doc3: 'Preventivo tipo.docx' },
  es: { f1: 'Clara', zone: 'Valencia y alrededores', sector: 'restaurantes, catering', n: '20 empresas', who: 'Gerente o chef', c1: 'Casa Delgado Catering', p1: 'Clara Delgado', r1: 'gerente', c2: 'Bistró Los Tilos', r2: 'chef propietario', c3: 'Pastelería Romero', r3: 'cogerente', p3: 'Sofía Romero', reply: 'Javier Martín', client: 'Marcos Vidal', clientCo: 'Brasería del Parque', early: 'Diego Serrano', doc1: 'Folleto 2026.pdf', doc2: 'Tarifas eventos.xlsx', doc3: 'Presupuesto tipo.docx' },
  pt: { f1: 'Carla', zone: 'Porto e arredores', sector: 'restaurantes, catering', n: '20 empresas', who: 'Gerente ou chef', c1: 'Casa Duarte Catering', p1: 'Carla Duarte', r1: 'gerente', c2: 'Tasca das Tílias', r2: 'chef e proprietário', c3: 'Pastelaria Rocha', r3: 'cogerente', p3: 'Sofia Rocha', reply: 'João Mendes', client: 'Marco Vidal', clientCo: 'Brasserie do Parque', early: 'Tiago Nunes', doc1: 'Brochura 2026.pdf', doc2: 'Tarifas eventos.xlsx', doc3: 'Orçamento tipo.docx' },
  nl: { f1: 'Claire', zone: 'Utrecht en omgeving', sector: 'restaurants, cateraars', n: '20 bedrijven', who: 'Eigenaar of chef', c1: 'Van Dijk Catering', p1: 'Claire van Dijk', r1: 'eigenaar', c2: 'Bistro De Linde', r2: 'chef-eigenaar', c3: 'Bakkerij Roos', r3: 'mede-eigenaar', p3: 'Sophie Roos', reply: 'Jeroen Mulder', client: 'Mark Visser', clientCo: 'Brasserie aan het Park', early: 'Daan Bakker', doc1: 'Brochure 2026.pdf', doc2: 'Tarieven events.xlsx', doc3: 'Offerte sjabloon.docx' },
};

// ---- Textes -----------------------------------------------------------------
// s = slides : t titre, l texte, n note, y « Toi », a « Aaron », m textes de
// l'écran illustré. Les {clés} sont remplacées par EX[locale].
const T = {
  fr: {
    prev: 'Précédent', next: 'Suivant', done: 'C’est parti', skip: 'Passer la visite', counter: 'Visite guidée · {i} sur {n}', you: 'Toi', aaron: 'Aaron',
    nav: ['Campagnes', 'Contacts', 'Agenda', 'Chat', 'Plus'],
    s: [
      { t: 'Tout commence par une campagne', l: 'Tu dis à Aaron qui tu veux comme clients et où. Pas de fichier à acheter, pas de liste à préparer : il part de ta fiche entreprise et te propose une première campagne déjà pré-remplie.', n: 'On la lancera ensemble à la fin de cette visite.', y: 'Tu corriges la zone, les métiers visés, le nombre d’entreprises.', a: 'Il cherche les entreprises, trouve la bonne personne, écrit le premier email.',
        m: { h: 'Campagnes', reco: 'Aaron te recommande une campagne', line: '{zone} · {sector} · {n}', sizes: ['TPE', 'PME', 'ETI'], who: '{who}', whoSub: 'La personne à contacter', btn: 'Lancer la campagne' } },
      { t: 'Aaron cherche, lit, puis écrit', l: 'Pour chaque entreprise, il lit le site, identifie l’interlocuteur et rédige un premier email personnalisé, dans la langue du prospect, depuis ta boîte mail.', n: 'Seul le tout premier email de ton compte attend ta validation, pour vérifier ensemble le ton. Tous les suivants partent seuls. Si tu préfères relire chaque premier email, l’option existe dans tes préférences.', y: 'Tu valides le tout premier email, une seule fois.', a: 'Il envoie tous les autres, au bon rythme, sans jamais saturer ta boîte.',
        m: { h: 'Ton tout premier email', sub: '{c1} · {p1}, {r1}', body: 'Bonjour {f1}, j’ai vu que {c1} organise de plus en plus de séminaires d’entreprise. Nous aidons les traiteurs à remplir leur calendrier hors saison des mariages…', ok: 'Valider et envoyer', edit: 'Modifier', found: 'trouvé', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'Les réponses arrivent, Aaron répond', l: 'Une question sur le prix, une demande d’exemple, un « rappelez-moi en janvier » : Aaron lit chaque réponse et répond lui-même, comme toi. Les sans-réponse sont relancés au bon moment.', n: 'Tu es prévenu sur ton téléphone et sur ton ordinateur dès qu’un prospect répond.', y: 'Rien. Tu lis si tu veux.', a: 'Il répond, relance, et arrête net si on lui demande.',
        m: { h: '{reply} a répondu', q: 'Bonjour, pourquoi pas. Vous avez des exemples de restaurants qui l’ont fait ? Combien ça coûte ?', r: 'Bien sûr {reply}. Deux bistrots comparables au vôtre remplissent leurs mardis et mercredis depuis septembre…', notif: '{reply} a répondu · Aaron s’en occupe' } },
      { t: 'Le rendez-vous se prend tout seul', l: 'Aaron ne propose que tes créneaux libres. Quand le prospect dit « mardi 10h », le rendez-vous est confirmé : invitation d’agenda, email de confirmation, lien visio ou adresse.', n: 'Tu n’interviens que si le rendez-vous est dans moins de 24 heures. La veille à 20h, tu reçois ta journée de demain ; puis un rappel 30 min avant (1 h pour un rendez-vous sur place). Un imprévu ? « Je suis en retard » prévient le prospect en un clic.', y: 'Tu te présentes au rendez-vous, briefé.', a: 'Il cale, confirme, rappelle le prospect la veille et toi juste avant.',
        m: { h: 'Agenda', when: 'Mardi 11 · 10h00 · téléphone', who: '{p1}, {c1}', status: 'Confirmé', b1: 'Reporter', b2: 'Je suis en retard', notif: 'Rendez-vous confirmé · {p1}, mardi 10h. Invitation envoyée.' } },
      { t: 'Avant le rendez-vous, la fiche', l: 'Chaque contact a sa fiche : l’avis d’Aaron sur l’entreprise, le profil de la personne, son conseil pour toi, et toute la conversation. Tu arrives au rendez-vous en sachant à qui tu parles.', n: '', y: 'Tu lis deux minutes avant d’appeler.', a: 'Il a préparé le brief : besoin, personnalité, point de vigilance.',
        m: { h: '{p1}', tag: 'Opportunité', k1: 'Avis d’Aaron sur l’entreprise', v1: 'Cible idéale : traiteur de séminaires, 18 salariés, décision rapide par la gérante.', k2: 'Conseil', v2: 'Elle compare deux prestataires d’ici jeudi : envoyez le devis avant.', k3: 'Personnalité · dominante', v3: 'Réponses courtes, décide vite. Résultats et délais, pas de détails.' } },
      { t: 'Après le rendez-vous, deux clics', l: 'Aaron te demande comment ça s’est passé. Tu touches « bien » ou « compliqué », l’issue, un mot si tu veux. Il écrit l’email d’après rendez-vous : le brief de ce qu’il a compris, et le pas vers le devis.', n: 'Si c’était tendu, le prospect ne le saura jamais : les objections deviennent des engagements.', y: 'Deux chips et un mot.', a: 'Le bilan, l’email, la suite.',
        m: { h: 'Bilan du rendez-vous', q1: 'Comment ça s’est passé ?', c1: ['Bien', 'Mitigé', 'Difficile'], q2: 'Et ensuite ?', c2: ['Devis demandé', 'À continuer', 'Perdu'], mailT: 'Aaron envoie l’email d’après rendez-vous', mail: '« Merci pour cet échange… j’ai bien noté vos attentes, je reviens vers vous prochainement avec notre offre. »', btn: 'Enregistrer le bilan' } },
      { t: 'De prospect à client, sans ressaisie', l: 'Prospect, rendez-vous, opportunité, devis, client : chaque contact avance tout seul dans le parcours, à partir de ce qui se passe réellement dans les emails et tes bilans. Tu déposes ton devis, Aaron le vérifie, l’envoie, et te prévient à la seconde où le client l’ouvre : c’est le moment d’appeler, dans les 30 minutes.', n: 'Quand un client signe, Aaron s’arrête. Il revient une fois, trente jours plus tard, pour lui demander s’il connaît quelqu’un que ton service intéresserait.', y: 'Tu signes.', a: 'Il range, il suit, il demande une recommandation.',
        m: { h: 'Contacts', stats: [['4', 'contactés'], ['2', 'rendez-vous'], ['1', 'devis'], ['1', 'client']], rows: [['{p1} · {c1}', 'Devis demandé'], ['{client} · {clientCo}', 'Client'], ['{p3} · {c3}', 'Relance jeudi']], foot: 'Dans 30 jours : Aaron demande à {client} des contacts intéressés.', notif: 'Devis ouvert — {p1} est en train de lire ton devis. Appelle maintenant.' } },
      { t: 'Ce qui t’attend, et rien d’autre', l: 'Les actions qui ont besoin de toi apparaissent en haut de l’écran, comme des stories : ton tout premier email à valider, un rendez-vous dans moins de 24 h, un bilan à faire, une demande de devis.', n: 'Pas de story, rien à faire. C’est aussi simple que ça.', y: 'Tu traites les stories, quand tu as cinq minutes.', a: 'Il ne te dérange que quand il ne peut pas décider seul.',
        m: { stories: [['1', 'Email à valider'], ['1', 'Bilan à faire'], ['1', 'Devis demandé']], t1: '{p1} demande un devis', b1: 'Pour la saison des séminaires, avant jeudi.', a1: 'Ouvrir la fiche', a2: 'Plus tard', t2: 'Rendez-vous demain 6h45 · à valider', b2: '{early} propose un appel avant 7h. Dans moins de 24 h : à toi de confirmer.' } },
      { t: 'Mes documents : ce qu’Aaron a sous la main', l: 'Dépose ta plaquette, tes tarifs, un devis type, des exemples de réalisations. Aaron les lit et s’en sert pour répondre juste, et les joint quand un prospect les demande.', n: 'Tu choisis, document par document, ce qu’Aaron peut utiliser et pour qui : prospects, opportunités ou clients.', y: 'Tu déposes les fichiers que tu enverrais toi-même.', a: 'Il cite les bons chiffres et joint le bon document.',
        m: { h: 'Mes documents', rows: [['{doc1}', 'Pris en compte · Prospects'], ['{doc2}', 'Pris en compte · Opportunités'], ['{doc3}', 'Pris en compte · Opportunités']], foot: '« {reply} demande des exemples : je lui joins la plaquette. »' } },
      { t: 'Cinq endroits, c’est tout', l: 'Campagnes : ce qu’Aaron cherche pour toi. Contacts : chaque personne, sa fiche, sa conversation. Agenda : tes rendez-vous et tes disponibilités. Chat : une question, une idée, un doute, Aaron répond. Plus : résultats, documents, équipe, Mon compte et les préférences.', n: 'Dans les préférences, je te conseille d’y mettre ta signature et ton logo d’entreprise : Aaron écrit depuis ta boîte, autant que ce soit à ton image.', y: 'Tu changes un réglage dans Mon compte quand tu veux.', a: 'Il s’adapte à chaque changement, sans redémarrer.',
        m: { h: 'Chat avec Aaron', u1: 'Je préfère les rendez-vous en visio le matin seulement.', a1: 'C’est noté : je ne proposerai plus de visio l’après-midi. Tu peux aussi le régler dans Agenda → Disponibilités.', u2: 'Et pour les traiteurs, insiste plus sur les séminaires que sur les mariages.', a2: 'Compris, je l’applique dès le prochain email.' } },
      { t: 'Trois réglages, puis on lance', l: 'Aaron a besoin de ta boîte mail (il écrit depuis chez toi), de tes disponibilités (il ne propose que ces créneaux), et de l’autorisation de te prévenir. Deux minutes, puis ta première campagne part.', n: 'Ta fiche entreprise est déjà faite : c’est la conversation que tu viens d’avoir avec Aaron.', nInvited: 'Ta fiche entreprise est déjà faite par ton équipe.', y: '', a: '',
        m: { h: 'Avant de lancer', rows: ['Fiche entreprise · faite avec Aaron', 'Boîte mail · Gmail, Outlook ou autre', 'Disponibilités · lundi–vendredi 9h–17h par défaut', 'Notifications · sur ce téléphone', 'Signature et logo · dans les préférences (conseillé)'], btn: 'Lancer ma première campagne' } },
    ],
  },
  en: {
    prev: 'Back', next: 'Next', done: 'Let’s go', skip: 'Skip the tour', counter: 'Guided tour · {i} of {n}', you: 'You', aaron: 'Aaron',
    nav: ['Campaigns', 'Contacts', 'Calendar', 'Chat', 'More'],
    s: [
      { t: 'It all starts with a campaign', l: 'You tell Aaron who you want as clients and where. No file to buy, no list to prepare: he starts from your company profile and suggests a first campaign, already pre-filled.', n: 'We will launch it together at the end of this tour.', y: 'You adjust the area, the trades, the number of companies.', a: 'He finds the companies, the right person, and writes the first email.',
        m: { h: 'Campaigns', reco: 'Aaron recommends a campaign', line: '{zone} · {sector} · {n}', sizes: ['Micro', 'SME', 'Mid-size'], who: '{who}', whoSub: 'The person to contact', btn: 'Launch the campaign' } },
      { t: 'Aaron searches, reads, then writes', l: 'For each company he reads the website, identifies the right contact and writes a personalised first email, in the prospect’s language, from your mailbox.', n: 'Only the very first email of your account waits for your approval, so we check the tone together. All the following ones go out on their own. If you prefer to review every first email, the option is in your preferences.', y: 'You approve the very first email, once.', a: 'He sends all the others, at the right pace, without ever flooding your mailbox.',
        m: { h: 'Your very first email', sub: '{c1} · {p1}, {r1}', body: 'Hello {f1}, I noticed {c1} is catering more and more corporate events. We help caterers fill their calendar outside the wedding season…', ok: 'Approve and send', edit: 'Edit', found: 'found', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'Replies come in, Aaron answers', l: 'A question about price, a request for examples, a “call me back in January”: Aaron reads every reply and answers himself, as you would. Those who do not reply are followed up at the right time.', n: 'You are notified on your phone and your computer as soon as a prospect replies.', y: 'Nothing. You read if you want to.', a: 'He answers, follows up, and stops at once if asked.',
        m: { h: '{reply} replied', q: 'Hello, why not. Do you have examples of restaurants that did it? How much does it cost?', r: 'Of course {reply}. Two bistros comparable to yours have been filling their Tuesdays and Wednesdays since September…', notif: '{reply} replied · Aaron is on it' } },
      { t: 'The meeting books itself', l: 'Aaron only offers your free slots. When the prospect says “Tuesday 10am”, the meeting is confirmed: calendar invitation, confirmation email, video link or address.', n: 'You only step in if the meeting is less than 24 hours away. The evening before at 8pm you receive your day tomorrow; then a reminder 30 min before (1 hour for an in-person meeting). Something unexpected? “I am running late” tells the prospect in one tap.', y: 'You show up to the meeting, briefed.', a: 'He books, confirms, reminds the prospect the day before and you just before.',
        m: { h: 'Calendar', when: 'Tuesday 11 · 10:00 · phone', who: '{p1}, {c1}', status: 'Confirmed', b1: 'Reschedule', b2: 'I am running late', notif: 'Meeting confirmed · {p1}, Tuesday 10am. Invitation sent.' } },
      { t: 'Before the meeting, the card', l: 'Every contact has a card: Aaron’s view of the company, the person’s profile, his advice for you, and the whole conversation. You arrive knowing who you are talking to.', n: '', y: 'You read for two minutes before calling.', a: 'He prepared the brief: need, personality, point of attention.',
        m: { h: '{p1}', tag: 'Opportunity', k1: 'Aaron’s view of the company', v1: 'Ideal target: corporate-event caterer, 18 staff, quick decisions by the owner.', k2: 'Advice', v2: 'She is comparing two providers by Thursday: send the quote before.', k3: 'Personality · dominant', v3: 'Short answers, decides fast. Results and deadlines, no details.' } },
      { t: 'After the meeting, two taps', l: 'Aaron asks how it went. You tap “good” or “tricky”, the outcome, a word if you like. He writes the follow-up email: a brief of what he understood, and the step towards the quote.', n: 'If it was tense, the prospect will never know: objections become commitments.', y: 'Two chips and a word.', a: 'The debrief, the email, the next step.',
        m: { h: 'Meeting debrief', q1: 'How did it go?', c1: ['Good', 'Mixed', 'Difficult'], q2: 'What next?', c2: ['Quote requested', 'Keep going', 'Lost'], mailT: 'Aaron sends the follow-up email', mail: '“Thank you for our conversation… I have noted your expectations and will get back to you shortly with our offer.”', btn: 'Save the debrief' } },
      { t: 'From prospect to client, nothing to re-enter', l: 'Prospect, meeting, opportunity, quote, client: every contact moves along the journey on its own, based on what really happens in the emails and your debriefs. You upload your quote, Aaron checks it, sends it, and tells you the second the client opens it: that is the moment to call, within 30 minutes.', n: 'When a client signs, Aaron stops. He comes back once, thirty days later, to ask whether they know someone your service would interest.', y: 'You sign.', a: 'He files, follows up, and asks for a referral.',
        m: { h: 'Contacts', stats: [['4', 'contacted'], ['2', 'meetings'], ['1', 'quote'], ['1', 'client']], rows: [['{p1} · {c1}', 'Quote requested'], ['{client} · {clientCo}', 'Client'], ['{p3} · {c3}', 'Follow-up Thursday']], foot: 'In 30 days: Aaron asks {client} for interested contacts.', notif: 'Quote opened — {p1} is reading your quote. Call now.' } },
      { t: 'What needs you, and nothing else', l: 'The actions that need you appear at the top of the screen, like stories: your very first email to approve, a meeting less than 24 hours away, a debrief to do, a quote request.', n: 'No story, nothing to do. It is that simple.', y: 'You handle the stories when you have five minutes.', a: 'He only interrupts you when he cannot decide alone.',
        m: { stories: [['1', 'Email to approve'], ['1', 'Debrief to do'], ['1', 'Quote requested']], t1: '{p1} requests a quote', b1: 'For the corporate-event season, before Thursday.', a1: 'Open the card', a2: 'Later', t2: 'Meeting tomorrow 6:45 · to approve', b2: '{early} suggests a call before 7am. Less than 24 hours away: your call.' } },
      { t: 'My documents: what Aaron has at hand', l: 'Upload your brochure, your prices, a quote template, examples of your work. Aaron reads them and uses them to answer accurately, and attaches them when a prospect asks.', n: 'You choose, document by document, what Aaron may use and for whom: prospects, opportunities or clients.', y: 'You upload the files you would send yourself.', a: 'He quotes the right figures and attaches the right document.',
        m: { h: 'My documents', rows: [['{doc1}', 'In use · Prospects'], ['{doc2}', 'In use · Opportunities'], ['{doc3}', 'In use · Opportunities']], foot: '“{reply} asks for examples: I am attaching the brochure.”' } },
      { t: 'Five places, that is all', l: 'Campaigns: what Aaron is searching for you. Contacts: each person, their card, their conversation. Calendar: your meetings and your availability. Chat: a question, an idea, a doubt, Aaron answers. More: results, documents, team, My account and preferences.', n: 'In the preferences, I advise you to add your signature and your company logo: Aaron writes from your mailbox, so it should look like you.', y: 'You change a setting in My account whenever you want.', a: 'He adapts to every change, no restart.',
        m: { h: 'Chat with Aaron', u1: 'I prefer video meetings in the morning only.', a1: 'Noted: I will no longer offer video calls in the afternoon. You can also set it in Calendar → Availability.', u2: 'And for caterers, push corporate events more than weddings.', a2: 'Understood, I will apply it from the next email.' } },
      { t: 'Three settings, then we launch', l: 'Aaron needs your mailbox (he writes from your address), your availability (he only offers those slots), and permission to notify you. Two minutes, then your first campaign goes out.', n: 'Your company profile is already done: it is the conversation you just had with Aaron.', nInvited: 'Your company profile has already been done by your team.', y: '', a: '',
        m: { h: 'Before launching', rows: ['Company profile · done with Aaron', 'Mailbox · Gmail, Outlook or other', 'Availability · Monday–Friday 9am–5pm by default', 'Notifications · on this phone', 'Signature and logo · in preferences (recommended)'], btn: 'Launch my first campaign' } },
    ],
  },
  de: {
    prev: 'Zurück', next: 'Weiter', done: 'Los geht’s', skip: 'Tour überspringen', counter: 'Rundgang · {i} von {n}', you: 'Du', aaron: 'Aaron',
    nav: ['Kampagnen', 'Kontakte', 'Kalender', 'Chat', 'Mehr'],
    s: [
      { t: 'Alles beginnt mit einer Kampagne', l: 'Du sagst Aaron, wen du als Kunden willst und wo. Keine Datei zu kaufen, keine Liste vorzubereiten: Er geht von deinem Unternehmensprofil aus und schlägt dir eine erste, bereits vorausgefüllte Kampagne vor.', n: 'Wir starten sie gemeinsam am Ende dieses Rundgangs.', y: 'Du korrigierst Region, Branchen und Anzahl der Unternehmen.', a: 'Er sucht die Unternehmen, findet die richtige Person, schreibt die erste E-Mail.',
        m: { h: 'Kampagnen', reco: 'Aaron empfiehlt dir eine Kampagne', line: '{zone} · {sector} · {n}', sizes: ['Kleinst', 'KMU', 'Mittelstand'], who: '{who}', whoSub: 'Die Ansprechperson', btn: 'Kampagne starten' } },
      { t: 'Aaron sucht, liest, dann schreibt er', l: 'Für jedes Unternehmen liest er die Website, findet den Ansprechpartner und verfasst eine persönliche erste E-Mail, in der Sprache des Interessenten, aus deinem Postfach.', n: 'Nur die allererste E-Mail deines Kontos wartet auf deine Freigabe, damit wir den Ton gemeinsam prüfen. Alle weiteren gehen von selbst raus. Wenn du jede erste E-Mail lieber gegenliest, gibt es die Option in deinen Einstellungen.', y: 'Du gibst die allererste E-Mail frei, ein einziges Mal.', a: 'Er sendet alle anderen, im richtigen Rhythmus, ohne dein Postfach zu überlasten.',
        m: { h: 'Deine allererste E-Mail', sub: '{c1} · {p1}, {r1}', body: 'Guten Tag Frau Brandt, ich habe gesehen, dass {c1} immer mehr Firmenseminare ausrichtet. Wir helfen Caterern, ihren Kalender außerhalb der Hochzeitssaison zu füllen…', ok: 'Freigeben und senden', edit: 'Bearbeiten', found: 'gefunden', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'Antworten kommen, Aaron antwortet', l: 'Eine Preisfrage, der Wunsch nach Beispielen, ein „melden Sie sich im Januar“: Aaron liest jede Antwort und antwortet selbst, wie du es tun würdest. Wer nicht antwortet, wird zum richtigen Zeitpunkt erinnert.', n: 'Du wirst auf Handy und Computer benachrichtigt, sobald ein Interessent antwortet.', y: 'Nichts. Du liest mit, wenn du willst.', a: 'Er antwortet, erinnert, und hört sofort auf, wenn man ihn darum bittet.',
        m: { h: '{reply} hat geantwortet', q: 'Guten Tag, warum nicht. Haben Sie Beispiele von Restaurants, die das gemacht haben? Was kostet es?', r: 'Gern, Herr Keller. Zwei mit Ihrem vergleichbare Gasthäuser füllen seit September ihre Dienstage und Mittwoche…', notif: '{reply} hat geantwortet · Aaron kümmert sich' } },
      { t: 'Der Termin vereinbart sich von selbst', l: 'Aaron bietet nur deine freien Zeiten an. Sagt der Interessent „Dienstag 10 Uhr“, ist der Termin bestätigt: Kalendereinladung, Bestätigungs-E-Mail, Video-Link oder Adresse.', n: 'Du greifst nur ein, wenn der Termin in weniger als 24 Stunden liegt. Am Vorabend um 20 Uhr bekommst du deinen Tag morgen; dann eine Erinnerung 30 Min. vorher (1 Std. bei einem Termin vor Ort). Etwas dazwischengekommen? „Ich verspäte mich“ informiert den Interessenten mit einem Klick.', y: 'Du erscheinst zum Termin, vorbereitet.', a: 'Er plant, bestätigt, erinnert den Interessenten am Vortag und dich kurz davor.',
        m: { h: 'Kalender', when: 'Dienstag 11. · 10:00 · Telefon', who: '{p1}, {c1}', status: 'Bestätigt', b1: 'Verschieben', b2: 'Ich verspäte mich', notif: 'Termin bestätigt · {p1}, Dienstag 10 Uhr. Einladung gesendet.' } },
      { t: 'Vor dem Termin: die Karte', l: 'Jeder Kontakt hat seine Karte: Aarons Einschätzung des Unternehmens, das Profil der Person, sein Rat für dich und das gesamte Gespräch. Du kommst zum Termin und weißt, mit wem du sprichst.', n: '', y: 'Du liest zwei Minuten, bevor du anrufst.', a: 'Er hat das Briefing vorbereitet: Bedarf, Persönlichkeit, Achtungspunkt.',
        m: { h: '{p1}', tag: 'Chance', k1: 'Aarons Einschätzung des Unternehmens', v1: 'Idealer Zielkunde: Seminar-Caterer, 18 Mitarbeitende, schnelle Entscheidung durch die Geschäftsführerin.', k2: 'Rat', v2: 'Sie vergleicht bis Donnerstag zwei Anbieter: Angebot vorher senden.', k3: 'Persönlichkeit · dominant', v3: 'Kurze Antworten, entscheidet schnell. Ergebnisse und Fristen, keine Details.' } },
      { t: 'Nach dem Termin: zwei Klicks', l: 'Aaron fragt dich, wie es gelaufen ist. Du tippst „gut“ oder „schwierig“, das Ergebnis, ein Wort, wenn du willst. Er schreibt die E-Mail nach dem Termin: das Briefing dessen, was er verstanden hat, und der Schritt zum Angebot.', n: 'War es angespannt, erfährt der Interessent es nie: Einwände werden zu Zusagen.', y: 'Zwei Chips und ein Wort.', a: 'Die Bilanz, die E-Mail, der nächste Schritt.',
        m: { h: 'Terminbilanz', q1: 'Wie ist es gelaufen?', c1: ['Gut', 'Gemischt', 'Schwierig'], q2: 'Und jetzt?', c2: ['Angebot gewünscht', 'Weiter dran', 'Verloren'], mailT: 'Aaron sendet die E-Mail nach dem Termin', mail: '„Vielen Dank für das Gespräch… ich habe Ihre Erwartungen notiert und komme in Kürze mit unserem Angebot auf Sie zu.“', btn: 'Bilanz speichern' } },
      { t: 'Vom Interessenten zum Kunden, ohne Neueingabe', l: 'Interessent, Termin, Chance, Angebot, Kunde: Jeder Kontakt rückt von selbst vor, auf Basis dessen, was in den E-Mails und deinen Bilanzen wirklich passiert. Du lädst dein Angebot hoch, Aaron prüft es, sendet es und meldet dir sofort, wenn der Kunde es öffnet: dann anrufen, innerhalb von 30 Minuten.', n: 'Unterschreibt ein Kunde, hört Aaron auf. Er kommt einmal wieder, dreißig Tage später, und fragt, ob er jemanden kennt, den dein Angebot interessieren könnte.', y: 'Du unterschreibst.', a: 'Er sortiert, begleitet und bittet um eine Empfehlung.',
        m: { h: 'Kontakte', stats: [['4', 'kontaktiert'], ['2', 'Termine'], ['1', 'Angebot'], ['1', 'Kunde']], rows: [['{p1} · {c1}', 'Angebot gewünscht'], ['{client} · {clientCo}', 'Kunde'], ['{p3} · {c3}', 'Erinnerung Donnerstag']], foot: 'In 30 Tagen: Aaron fragt {client} nach interessierten Kontakten.', notif: 'Angebot geöffnet — {p1} liest gerade dein Angebot. Jetzt anrufen.' } },
      { t: 'Was auf dich wartet, und sonst nichts', l: 'Was dich braucht, erscheint oben am Bildschirm, wie Stories: deine allererste E-Mail zur Freigabe, ein Termin in weniger als 24 Std., eine Bilanz, eine Angebotsanfrage.', n: 'Keine Story, nichts zu tun. So einfach ist das.', y: 'Du bearbeitest die Stories, wenn du fünf Minuten hast.', a: 'Er stört dich nur, wenn er nicht allein entscheiden kann.',
        m: { stories: [['1', 'E-Mail freigeben'], ['1', 'Bilanz fällig'], ['1', 'Angebot gewünscht']], t1: '{p1} wünscht ein Angebot', b1: 'Für die Seminarsaison, vor Donnerstag.', a1: 'Karte öffnen', a2: 'Später', t2: 'Termin morgen 6:45 · freizugeben', b2: '{early} schlägt ein Telefonat vor 7 Uhr vor. Weniger als 24 Std.: du entscheidest.' } },
      { t: 'Meine Dokumente: was Aaron zur Hand hat', l: 'Lade deine Broschüre, deine Preise, eine Angebotsvorlage, Referenzen hoch. Aaron liest sie, antwortet damit präzise und hängt sie an, wenn ein Interessent danach fragt.', n: 'Du bestimmst Dokument für Dokument, was Aaron nutzen darf und für wen: Interessenten, Chancen oder Kunden.', y: 'Du lädst die Dateien hoch, die du selbst senden würdest.', a: 'Er nennt die richtigen Zahlen und hängt das richtige Dokument an.',
        m: { h: 'Meine Dokumente', rows: [['{doc1}', 'In Nutzung · Interessenten'], ['{doc2}', 'In Nutzung · Chancen'], ['{doc3}', 'In Nutzung · Chancen']], foot: '„{reply} bittet um Beispiele: ich hänge die Broschüre an.“' } },
      { t: 'Fünf Orte, das ist alles', l: 'Kampagnen: was Aaron für dich sucht. Kontakte: jede Person, ihre Karte, ihr Gespräch. Kalender: deine Termine und Verfügbarkeiten. Chat: eine Frage, eine Idee, ein Zweifel, Aaron antwortet. Mehr: Ergebnisse, Dokumente, Team, Mein Konto und Einstellungen.', n: 'In den Einstellungen rate ich dir, deine Signatur und dein Firmenlogo zu hinterlegen: Aaron schreibt aus deinem Postfach, da soll es nach dir aussehen.', y: 'Du änderst eine Einstellung in Mein Konto, wann du willst.', a: 'Er passt sich jeder Änderung an, ohne Neustart.',
        m: { h: 'Chat mit Aaron', u1: 'Ich bevorzuge Videotermine nur vormittags.', a1: 'Notiert: Ich biete nachmittags keine Videoanrufe mehr an. Du kannst es auch unter Kalender → Verfügbarkeit einstellen.', u2: 'Und bei Caterern mehr auf Seminare setzen als auf Hochzeiten.', a2: 'Verstanden, ab der nächsten E-Mail.' } },
      { t: 'Drei Einstellungen, dann starten wir', l: 'Aaron braucht dein Postfach (er schreibt von deiner Adresse), deine Verfügbarkeiten (er bietet nur diese Zeiten an) und die Erlaubnis, dich zu benachrichtigen. Zwei Minuten, dann geht deine erste Kampagne raus.', n: 'Dein Unternehmensprofil steht schon: Es ist das Gespräch, das du gerade mit Aaron geführt hast.', nInvited: 'Dein Unternehmensprofil wurde bereits von deinem Team erstellt.', y: '', a: '',
        m: { h: 'Vor dem Start', rows: ['Unternehmensprofil · mit Aaron erstellt', 'Postfach · Gmail, Outlook oder anderes', 'Verfügbarkeit · Montag–Freitag 9–17 Uhr standardmäßig', 'Benachrichtigungen · auf diesem Telefon', 'Signatur und Logo · in den Einstellungen (empfohlen)'], btn: 'Meine erste Kampagne starten' } },
    ],
  },
  it: {
    prev: 'Indietro', next: 'Avanti', done: 'Si parte', skip: 'Salta la visita', counter: 'Visita guidata · {i} di {n}', you: 'Tu', aaron: 'Aaron',
    nav: ['Campagne', 'Contatti', 'Agenda', 'Chat', 'Altro'],
    s: [
      { t: 'Tutto comincia con una campagna', l: 'Dici ad Aaron chi vuoi come clienti e dove. Nessun file da comprare, nessuna lista da preparare: parte dalla tua scheda azienda e ti propone una prima campagna già precompilata.', n: 'La lanceremo insieme alla fine di questa visita.', y: 'Correggi la zona, i mestieri, il numero di aziende.', a: 'Cerca le aziende, trova la persona giusta, scrive la prima email.',
        m: { h: 'Campagne', reco: 'Aaron ti consiglia una campagna', line: '{zone} · {sector} · {n}', sizes: ['Micro', 'PMI', 'Medie'], who: '{who}', whoSub: 'La persona da contattare', btn: 'Lancia la campagna' } },
      { t: 'Aaron cerca, legge, poi scrive', l: 'Per ogni azienda legge il sito, individua l’interlocutore e redige una prima email personalizzata, nella lingua del prospect, dalla tua casella di posta.', n: 'Solo la primissima email del tuo account attende la tua approvazione, per verificare insieme il tono. Tutte le seguenti partono da sole. Se preferisci rileggere ogni prima email, l’opzione è nelle tue preferenze.', y: 'Approvi la primissima email, una sola volta.', a: 'Invia tutte le altre, al ritmo giusto, senza mai saturare la tua casella.',
        m: { h: 'La tua primissima email', sub: '{c1} · {p1}, {r1}', body: 'Buongiorno {f1}, ho visto che {c1} organizza sempre più eventi aziendali. Aiutiamo i catering a riempire il calendario fuori dalla stagione dei matrimoni…', ok: 'Approva e invia', edit: 'Modifica', found: 'trovato', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'Arrivano le risposte, Aaron risponde', l: 'Una domanda sul prezzo, una richiesta di esempi, un «richiamatemi a gennaio»: Aaron legge ogni risposta e risponde lui stesso, come faresti tu. Chi non risponde viene ricontattato al momento giusto.', n: 'Sei avvisato sul telefono e sul computer appena un prospect risponde.', y: 'Niente. Leggi se vuoi.', a: 'Risponde, ricontatta, e si ferma subito se glielo chiedono.',
        m: { h: '{reply} ha risposto', q: 'Buongiorno, perché no. Avete esempi di ristoranti che l’hanno fatto? Quanto costa?', r: 'Certo {reply}. Due trattorie simili alla vostra riempiono i martedì e i mercoledì da settembre…', notif: '{reply} ha risposto · Aaron se ne occupa' } },
      { t: 'L’appuntamento si fissa da solo', l: 'Aaron propone solo i tuoi orari liberi. Quando il prospect dice «martedì alle 10», l’appuntamento è confermato: invito in agenda, email di conferma, link video o indirizzo.', n: 'Intervieni solo se l’appuntamento è a meno di 24 ore. La sera prima alle 20 ricevi la tua giornata di domani; poi un promemoria 30 min prima (1 ora per un appuntamento di persona). Un imprevisto? «Sono in ritardo» avvisa il prospect con un tocco.', y: 'Ti presenti all’appuntamento, preparato.', a: 'Fissa, conferma, ricorda al prospect il giorno prima e a te poco prima.',
        m: { h: 'Agenda', when: 'Martedì 11 · 10:00 · telefono', who: '{p1}, {c1}', status: 'Confermato', b1: 'Rinvia', b2: 'Sono in ritardo', notif: 'Appuntamento confermato · {p1}, martedì alle 10. Invito inviato.' } },
      { t: 'Prima dell’appuntamento, la scheda', l: 'Ogni contatto ha la sua scheda: il parere di Aaron sull’azienda, il profilo della persona, il suo consiglio per te e tutta la conversazione. Arrivi all’appuntamento sapendo con chi parli.', n: '', y: 'Leggi due minuti prima di chiamare.', a: 'Ha preparato il brief: bisogno, personalità, punto di attenzione.',
        m: { h: '{p1}', tag: 'Opportunità', k1: 'Parere di Aaron sull’azienda', v1: 'Target ideale: catering per eventi aziendali, 18 dipendenti, decisione rapida della titolare.', k2: 'Consiglio', v2: 'Confronta due fornitori entro giovedì: invia il preventivo prima.', k3: 'Personalità · dominante', v3: 'Risposte brevi, decide in fretta. Risultati e tempi, niente dettagli.' } },
      { t: 'Dopo l’appuntamento, due tocchi', l: 'Aaron ti chiede com’è andata. Tocchi «bene» o «difficile», l’esito, una parola se vuoi. Scrive l’email post-appuntamento: il brief di ciò che ha capito e il passo verso il preventivo.', n: 'Se è stato teso, il prospect non lo saprà mai: le obiezioni diventano impegni.', y: 'Due chip e una parola.', a: 'Il bilancio, l’email, il seguito.',
        m: { h: 'Bilancio dell’appuntamento', q1: 'Com’è andata?', c1: ['Bene', 'Così così', 'Difficile'], q2: 'E poi?', c2: ['Preventivo richiesto', 'Da continuare', 'Perso'], mailT: 'Aaron invia l’email post-appuntamento', mail: '«Grazie per lo scambio… ho preso nota delle vostre aspettative, tornerò da voi a breve con la nostra offerta.»', btn: 'Salva il bilancio' } },
      { t: 'Da prospect a cliente, senza reinserire nulla', l: 'Prospect, appuntamento, opportunità, preventivo, cliente: ogni contatto avanza da solo nel percorso, in base a ciò che accade davvero nelle email e nei tuoi bilanci. Carichi il tuo preventivo, Aaron lo verifica, lo invia e ti avvisa nell’istante in cui il cliente lo apre: è il momento di chiamare, entro 30 minuti.', n: 'Quando un cliente firma, Aaron si ferma. Torna una volta, trenta giorni dopo, per chiedergli se conosce qualcuno a cui il tuo servizio interesserebbe.', y: 'Tu firmi.', a: 'Lui archivia, segue, chiede una raccomandazione.',
        m: { h: 'Contatti', stats: [['4', 'contattati'], ['2', 'appuntamenti'], ['1', 'preventivo'], ['1', 'cliente']], rows: [['{p1} · {c1}', 'Preventivo richiesto'], ['{client} · {clientCo}', 'Cliente'], ['{p3} · {c3}', 'Follow-up giovedì']], foot: 'Tra 30 giorni: Aaron chiede a {client} contatti interessati.', notif: 'Preventivo aperto — {p1} sta leggendo il tuo preventivo. Chiama ora.' } },
      { t: 'Ciò che ti aspetta, e nient’altro', l: 'Le azioni che hanno bisogno di te appaiono in alto, come storie: la tua primissima email da approvare, un appuntamento a meno di 24 ore, un bilancio da fare, una richiesta di preventivo.', n: 'Nessuna storia, niente da fare. Semplice così.', y: 'Gestisci le storie quando hai cinque minuti.', a: 'Ti disturba solo quando non può decidere da solo.',
        m: { stories: [['1', 'Email da approvare'], ['1', 'Bilancio da fare'], ['1', 'Preventivo richiesto']], t1: '{p1} chiede un preventivo', b1: 'Per la stagione degli eventi aziendali, entro giovedì.', a1: 'Apri la scheda', a2: 'Più tardi', t2: 'Appuntamento domani 6:45 · da approvare', b2: '{early} propone una chiamata prima delle 7. Meno di 24 ore: decidi tu.' } },
      { t: 'I miei documenti: ciò che Aaron ha a portata di mano', l: 'Carica la tua brochure, i tuoi prezzi, un preventivo tipo, esempi di lavori. Aaron li legge e li usa per rispondere con precisione, e li allega quando un prospect li chiede.', n: 'Scegli, documento per documento, cosa Aaron può usare e per chi: prospect, opportunità o clienti.', y: 'Carichi i file che invieresti tu stesso.', a: 'Cita le cifre giuste e allega il documento giusto.',
        m: { h: 'I miei documenti', rows: [['{doc1}', 'In uso · Prospect'], ['{doc2}', 'In uso · Opportunità'], ['{doc3}', 'In uso · Opportunità']], foot: '«{reply} chiede esempi: allego la brochure.»' } },
      { t: 'Cinque posti, tutto qui', l: 'Campagne: ciò che Aaron cerca per te. Contatti: ogni persona, la sua scheda, la sua conversazione. Agenda: i tuoi appuntamenti e le tue disponibilità. Chat: una domanda, un’idea, un dubbio, Aaron risponde. Altro: risultati, documenti, team, Il mio account e le preferenze.', n: 'Nelle preferenze ti consiglio di inserire la tua firma e il logo dell’azienda: Aaron scrive dalla tua casella, meglio che sia a tua immagine.', y: 'Cambi un’impostazione in Il mio account quando vuoi.', a: 'Si adatta a ogni cambiamento, senza riavviare.',
        m: { h: 'Chat con Aaron', u1: 'Preferisco le videochiamate solo la mattina.', a1: 'Annotato: non proporrò più videochiamate al pomeriggio. Puoi impostarlo anche in Agenda → Disponibilità.', u2: 'E per i catering, insisti più sugli eventi aziendali che sui matrimoni.', a2: 'Capito, lo applico dalla prossima email.' } },
      { t: 'Tre impostazioni, poi si parte', l: 'Aaron ha bisogno della tua casella di posta (scrive dal tuo indirizzo), delle tue disponibilità (propone solo quegli orari) e dell’autorizzazione ad avvisarti. Due minuti, poi la tua prima campagna parte.', n: 'La tua scheda azienda è già fatta: è la conversazione che hai appena avuto con Aaron.', nInvited: 'La tua scheda azienda è già stata fatta dal tuo team.', y: '', a: '',
        m: { h: 'Prima di lanciare', rows: ['Scheda azienda · fatta con Aaron', 'Casella di posta · Gmail, Outlook o altro', 'Disponibilità · lunedì–venerdì 9–17 per impostazione predefinita', 'Notifiche · su questo telefono', 'Firma e logo · nelle preferenze (consigliato)'], btn: 'Lancia la mia prima campagna' } },
    ],
  },
  es: {
    prev: 'Anterior', next: 'Siguiente', done: 'Vamos', skip: 'Saltar la visita', counter: 'Visita guiada · {i} de {n}', you: 'Tú', aaron: 'Aaron',
    nav: ['Campañas', 'Contactos', 'Agenda', 'Chat', 'Más'],
    s: [
      { t: 'Todo empieza con una campaña', l: 'Le dices a Aaron a quién quieres como clientes y dónde. Sin archivos que comprar ni listas que preparar: parte de tu ficha de empresa y te propone una primera campaña ya rellenada.', n: 'La lanzaremos juntos al final de esta visita.', y: 'Corriges la zona, los oficios, el número de empresas.', a: 'Busca las empresas, encuentra a la persona adecuada, escribe el primer correo.',
        m: { h: 'Campañas', reco: 'Aaron te recomienda una campaña', line: '{zone} · {sector} · {n}', sizes: ['Micro', 'PYME', 'Mediana'], who: '{who}', whoSub: 'La persona a contactar', btn: 'Lanzar la campaña' } },
      { t: 'Aaron busca, lee y luego escribe', l: 'Para cada empresa lee la web, identifica al interlocutor y redacta un primer correo personalizado, en el idioma del prospecto, desde tu buzón.', n: 'Solo el primerísimo correo de tu cuenta espera tu validación, para comprobar juntos el tono. Todos los siguientes salen solos. Si prefieres releer cada primer correo, la opción está en tus preferencias.', y: 'Validas el primerísimo correo, una sola vez.', a: 'Envía todos los demás, al ritmo adecuado, sin saturar nunca tu buzón.',
        m: { h: 'Tu primerísimo correo', sub: '{c1} · {p1}, {r1}', body: 'Hola {f1}, he visto que {c1} organiza cada vez más eventos de empresa. Ayudamos a los caterings a llenar su calendario fuera de la temporada de bodas…', ok: 'Validar y enviar', edit: 'Editar', found: 'encontrado', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'Llegan las respuestas, Aaron responde', l: 'Una pregunta sobre el precio, una petición de ejemplos, un «llámeme en enero»: Aaron lee cada respuesta y responde él mismo, como tú. A los que no responden se les hace seguimiento en el momento adecuado.', n: 'Te avisamos en el teléfono y en el ordenador en cuanto un prospecto responde.', y: 'Nada. Lees si quieres.', a: 'Responde, hace seguimiento y se detiene en seco si se lo piden.',
        m: { h: '{reply} ha respondido', q: 'Hola, por qué no. ¿Tienen ejemplos de restaurantes que lo hayan hecho? ¿Cuánto cuesta?', r: 'Claro {reply}. Dos bistrós comparables al suyo llenan sus martes y miércoles desde septiembre…', notif: '{reply} ha respondido · Aaron se ocupa' } },
      { t: 'La reunión se concierta sola', l: 'Aaron solo propone tus huecos libres. Cuando el prospecto dice «martes a las 10», la reunión queda confirmada: invitación de agenda, correo de confirmación, enlace de vídeo o dirección.', n: 'Solo intervienes si la reunión es en menos de 24 horas. La víspera a las 20 h recibes tu día de mañana; después un recordatorio 30 min antes (1 h para una reunión presencial). ¿Un imprevisto? «Voy con retraso» avisa al prospecto con un toque.', y: 'Te presentas a la reunión, con el brief leído.', a: 'Concierta, confirma, recuerda al prospecto la víspera y a ti justo antes.',
        m: { h: 'Agenda', when: 'Martes 11 · 10:00 · teléfono', who: '{p1}, {c1}', status: 'Confirmada', b1: 'Aplazar', b2: 'Voy con retraso', notif: 'Reunión confirmada · {p1}, martes a las 10. Invitación enviada.' } },
      { t: 'Antes de la reunión, la ficha', l: 'Cada contacto tiene su ficha: la opinión de Aaron sobre la empresa, el perfil de la persona, su consejo para ti y toda la conversación. Llegas a la reunión sabiendo con quién hablas.', n: '', y: 'Lees dos minutos antes de llamar.', a: 'Ha preparado el brief: necesidad, personalidad, punto de atención.',
        m: { h: '{p1}', tag: 'Oportunidad', k1: 'Opinión de Aaron sobre la empresa', v1: 'Objetivo ideal: catering de eventos de empresa, 18 empleados, decisión rápida de la gerente.', k2: 'Consejo', v2: 'Compara dos proveedores antes del jueves: envía el presupuesto antes.', k3: 'Personalidad · dominante', v3: 'Respuestas cortas, decide rápido. Resultados y plazos, sin detalles.' } },
      { t: 'Después de la reunión, dos toques', l: 'Aaron te pregunta cómo ha ido. Tocas «bien» o «complicado», el resultado, una palabra si quieres. Él escribe el correo posterior: el resumen de lo que ha entendido y el paso hacia el presupuesto.', n: 'Si fue tenso, el prospecto nunca lo sabrá: las objeciones se convierten en compromisos.', y: 'Dos chips y una palabra.', a: 'El balance, el correo, el siguiente paso.',
        m: { h: 'Balance de la reunión', q1: '¿Cómo ha ido?', c1: ['Bien', 'Regular', 'Difícil'], q2: '¿Y ahora?', c2: ['Presupuesto solicitado', 'Seguir', 'Perdido'], mailT: 'Aaron envía el correo posterior a la reunión', mail: '«Gracias por la conversación… he tomado nota de sus expectativas y volveré a contactarle próximamente con nuestra oferta.»', btn: 'Guardar el balance' } },
      { t: 'De prospecto a cliente, sin volver a teclear', l: 'Prospecto, reunión, oportunidad, presupuesto, cliente: cada contacto avanza solo en el recorrido, según lo que pasa realmente en los correos y en tus balances. Subes tu presupuesto, Aaron lo comprueba, lo envía y te avisa en el segundo en que el cliente lo abre: es el momento de llamar, en los 30 minutos siguientes.', n: 'Cuando un cliente firma, Aaron se detiene. Vuelve una vez, treinta días después, para preguntarle si conoce a alguien a quien le interese tu servicio.', y: 'Tú firmas.', a: 'Él ordena, hace seguimiento y pide una recomendación.',
        m: { h: 'Contactos', stats: [['4', 'contactados'], ['2', 'reuniones'], ['1', 'presupuesto'], ['1', 'cliente']], rows: [['{p1} · {c1}', 'Presupuesto solicitado'], ['{client} · {clientCo}', 'Cliente'], ['{p3} · {c3}', 'Seguimiento jueves']], foot: 'En 30 días: Aaron pide a {client} contactos interesados.', notif: 'Presupuesto abierto — {p1} está leyendo tu presupuesto. Llama ahora.' } },
      { t: 'Lo que te espera, y nada más', l: 'Las acciones que te necesitan aparecen arriba, como historias: tu primerísimo correo por validar, una reunión en menos de 24 h, un balance pendiente, una solicitud de presupuesto.', n: 'Sin historia, nada que hacer. Así de simple.', y: 'Atiendes las historias cuando tienes cinco minutos.', a: 'Solo te molesta cuando no puede decidir solo.',
        m: { stories: [['1', 'Correo por validar'], ['1', 'Balance pendiente'], ['1', 'Presupuesto solicitado']], t1: '{p1} solicita un presupuesto', b1: 'Para la temporada de eventos, antes del jueves.', a1: 'Abrir la ficha', a2: 'Más tarde', t2: 'Reunión mañana 6:45 · por validar', b2: '{early} propone una llamada antes de las 7. Menos de 24 h: tú decides.' } },
      { t: 'Mis documentos: lo que Aaron tiene a mano', l: 'Sube tu folleto, tus tarifas, un presupuesto tipo, ejemplos de trabajos. Aaron los lee y los usa para responder con precisión, y los adjunta cuando un prospecto los pide.', n: 'Eliges, documento por documento, qué puede usar Aaron y para quién: prospectos, oportunidades o clientes.', y: 'Subes los archivos que enviarías tú mismo.', a: 'Cita las cifras correctas y adjunta el documento adecuado.',
        m: { h: 'Mis documentos', rows: [['{doc1}', 'En uso · Prospectos'], ['{doc2}', 'En uso · Oportunidades'], ['{doc3}', 'En uso · Oportunidades']], foot: '«{reply} pide ejemplos: le adjunto el folleto.»' } },
      { t: 'Cinco sitios, nada más', l: 'Campañas: lo que Aaron busca para ti. Contactos: cada persona, su ficha, su conversación. Agenda: tus reuniones y tu disponibilidad. Chat: una pregunta, una idea, una duda, Aaron responde. Más: resultados, documentos, equipo, Mi cuenta y las preferencias.', n: 'En las preferencias te aconsejo poner tu firma y el logo de tu empresa: Aaron escribe desde tu buzón, mejor que sea a tu imagen.', y: 'Cambias un ajuste en Mi cuenta cuando quieras.', a: 'Se adapta a cada cambio, sin reiniciar.',
        m: { h: 'Chat con Aaron', u1: 'Prefiero las videollamadas solo por la mañana.', a1: 'Anotado: ya no propondré videollamadas por la tarde. También puedes ajustarlo en Agenda → Disponibilidad.', u2: 'Y con los caterings, insiste más en los eventos de empresa que en las bodas.', a2: 'Entendido, lo aplico desde el próximo correo.' } },
      { t: 'Tres ajustes y lanzamos', l: 'Aaron necesita tu buzón (escribe desde tu dirección), tu disponibilidad (solo propone esos huecos) y permiso para avisarte. Dos minutos, y tu primera campaña sale.', n: 'Tu ficha de empresa ya está hecha: es la conversación que acabas de tener con Aaron.', nInvited: 'Tu ficha de empresa ya la ha hecho tu equipo.', y: '', a: '',
        m: { h: 'Antes de lanzar', rows: ['Ficha de empresa · hecha con Aaron', 'Buzón · Gmail, Outlook u otro', 'Disponibilidad · lunes–viernes 9–17 h por defecto', 'Notificaciones · en este teléfono', 'Firma y logo · en las preferencias (recomendado)'], btn: 'Lanzar mi primera campaña' } },
    ],
  },
  pt: {
    prev: 'Anterior', next: 'Seguinte', done: 'Vamos', skip: 'Saltar a visita', counter: 'Visita guiada · {i} de {n}', you: 'Tu', aaron: 'Aaron',
    nav: ['Campanhas', 'Contactos', 'Agenda', 'Chat', 'Mais'],
    s: [
      { t: 'Tudo começa com uma campanha', l: 'Dizes ao Aaron quem queres como clientes e onde. Nenhum ficheiro a comprar, nenhuma lista a preparar: ele parte da tua ficha de empresa e propõe-te uma primeira campanha já preenchida.', n: 'Vamos lançá-la juntos no fim desta visita.', y: 'Corriges a zona, as profissões, o número de empresas.', a: 'Ele procura as empresas, encontra a pessoa certa, escreve o primeiro email.',
        m: { h: 'Campanhas', reco: 'O Aaron recomenda-te uma campanha', line: '{zone} · {sector} · {n}', sizes: ['Micro', 'PME', 'Média'], who: '{who}', whoSub: 'A pessoa a contactar', btn: 'Lançar a campanha' } },
      { t: 'O Aaron procura, lê e depois escreve', l: 'Para cada empresa, lê o site, identifica o interlocutor e redige um primeiro email personalizado, na língua do prospeto, a partir da tua caixa de correio.', n: 'Só o primeiríssimo email da tua conta espera pela tua validação, para verificarmos o tom juntos. Todos os seguintes partem sozinhos. Se preferires reler cada primeiro email, a opção está nas tuas preferências.', y: 'Validas o primeiríssimo email, uma só vez.', a: 'Ele envia todos os outros, ao ritmo certo, sem nunca saturar a tua caixa.',
        m: { h: 'O teu primeiríssimo email', sub: '{c1} · {p1}, {r1}', body: 'Olá {f1}, vi que a {c1} organiza cada vez mais eventos de empresa. Ajudamos os caterings a preencher o calendário fora da época dos casamentos…', ok: 'Validar e enviar', edit: 'Editar', found: 'encontrado', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'As respostas chegam, o Aaron responde', l: 'Uma pergunta sobre o preço, um pedido de exemplos, um «ligue-me em janeiro»: o Aaron lê cada resposta e responde ele próprio, como tu. Quem não responde é relembrado no momento certo.', n: 'És avisado no telemóvel e no computador assim que um prospeto responde.', y: 'Nada. Lês se quiseres.', a: 'Responde, insiste, e para de imediato se lhe pedirem.',
        m: { h: '{reply} respondeu', q: 'Olá, porque não. Têm exemplos de restaurantes que o fizeram? Quanto custa?', r: 'Claro {reply}. Duas tascas comparáveis à vossa enchem as terças e quartas desde setembro…', notif: '{reply} respondeu · O Aaron trata disso' } },
      { t: 'A reunião marca-se sozinha', l: 'O Aaron só propõe os teus horários livres. Quando o prospeto diz «terça às 10», a reunião fica confirmada: convite de agenda, email de confirmação, link de vídeo ou morada.', n: 'Só intervéns se a reunião for daqui a menos de 24 horas. Na véspera às 20h recebes o teu dia de amanhã; depois um lembrete 30 min antes (1 h para uma reunião presencial). Um imprevisto? «Estou atrasado» avisa o prospeto com um toque.', y: 'Apareces na reunião, preparado.', a: 'Marca, confirma, lembra o prospeto na véspera e a ti mesmo antes.',
        m: { h: 'Agenda', when: 'Terça 11 · 10:00 · telefone', who: '{p1}, {c1}', status: 'Confirmada', b1: 'Adiar', b2: 'Estou atrasado', notif: 'Reunião confirmada · {p1}, terça às 10. Convite enviado.' } },
      { t: 'Antes da reunião, a ficha', l: 'Cada contacto tem a sua ficha: a opinião do Aaron sobre a empresa, o perfil da pessoa, o seu conselho para ti e toda a conversa. Chegas à reunião a saber com quem falas.', n: '', y: 'Lês dois minutos antes de ligar.', a: 'Preparou o brief: necessidade, personalidade, ponto de atenção.',
        m: { h: '{p1}', tag: 'Oportunidade', k1: 'Opinião do Aaron sobre a empresa', v1: 'Alvo ideal: catering de eventos de empresa, 18 colaboradores, decisão rápida pela gerente.', k2: 'Conselho', v2: 'Compara dois fornecedores até quinta: envia o orçamento antes.', k3: 'Personalidade · dominante', v3: 'Respostas curtas, decide depressa. Resultados e prazos, sem detalhes.' } },
      { t: 'Depois da reunião, dois toques', l: 'O Aaron pergunta-te como correu. Tocas em «bem» ou «complicado», o resultado, uma palavra se quiseres. Ele escreve o email pós-reunião: o resumo do que percebeu e o passo para o orçamento.', n: 'Se foi tenso, o prospeto nunca saberá: as objeções tornam-se compromissos.', y: 'Dois chips e uma palavra.', a: 'O balanço, o email, o que vem a seguir.',
        m: { h: 'Balanço da reunião', q1: 'Como correu?', c1: ['Bem', 'Assim-assim', 'Difícil'], q2: 'E a seguir?', c2: ['Orçamento pedido', 'Continuar', 'Perdido'], mailT: 'O Aaron envia o email pós-reunião', mail: '«Obrigado pela conversa… tomei nota das suas expectativas e volto a contactá-lo brevemente com a nossa oferta.»', btn: 'Guardar o balanço' } },
      { t: 'De prospeto a cliente, sem voltar a escrever', l: 'Prospeto, reunião, oportunidade, orçamento, cliente: cada contacto avança sozinho no percurso, a partir do que acontece realmente nos emails e nos teus balanços. Carregas o teu orçamento, o Aaron verifica-o, envia-o e avisa-te no segundo em que o cliente o abre: é o momento de ligar, nos 30 minutos seguintes.', n: 'Quando um cliente assina, o Aaron para. Volta uma vez, trinta dias depois, para lhe perguntar se conhece alguém a quem o teu serviço interesse.', y: 'Tu assinas.', a: 'Ele arruma, acompanha, pede uma recomendação.',
        m: { h: 'Contactos', stats: [['4', 'contactados'], ['2', 'reuniões'], ['1', 'orçamento'], ['1', 'cliente']], rows: [['{p1} · {c1}', 'Orçamento pedido'], ['{client} · {clientCo}', 'Cliente'], ['{p3} · {c3}', 'Lembrete quinta']], foot: 'Daqui a 30 dias: o Aaron pede a {client} contactos interessados.', notif: 'Orçamento aberto — {p1} está a ler o teu orçamento. Liga agora.' } },
      { t: 'O que te espera, e nada mais', l: 'As ações que precisam de ti aparecem no topo do ecrã, como stories: o teu primeiríssimo email a validar, uma reunião daqui a menos de 24 h, um balanço por fazer, um pedido de orçamento.', n: 'Sem story, nada a fazer. É simples assim.', y: 'Tratas das stories quando tens cinco minutos.', a: 'Só te incomoda quando não pode decidir sozinho.',
        m: { stories: [['1', 'Email a validar'], ['1', 'Balanço por fazer'], ['1', 'Orçamento pedido']], t1: '{p1} pede um orçamento', b1: 'Para a época dos eventos, antes de quinta.', a1: 'Abrir a ficha', a2: 'Mais tarde', t2: 'Reunião amanhã 6:45 · a validar', b2: '{early} propõe uma chamada antes das 7. Menos de 24 h: decides tu.' } },
      { t: 'Os meus documentos: o que o Aaron tem à mão', l: 'Carrega a tua brochura, os teus preços, um orçamento tipo, exemplos de trabalhos. O Aaron lê-os e usa-os para responder com precisão, e anexa-os quando um prospeto os pede.', n: 'Escolhes, documento a documento, o que o Aaron pode usar e para quem: prospetos, oportunidades ou clientes.', y: 'Carregas os ficheiros que enviarias tu próprio.', a: 'Cita os números certos e anexa o documento certo.',
        m: { h: 'Os meus documentos', rows: [['{doc1}', 'Em uso · Prospetos'], ['{doc2}', 'Em uso · Oportunidades'], ['{doc3}', 'Em uso · Oportunidades']], foot: '«{reply} pede exemplos: anexo a brochura.»' } },
      { t: 'Cinco sítios, e mais nada', l: 'Campanhas: o que o Aaron procura para ti. Contactos: cada pessoa, a sua ficha, a sua conversa. Agenda: as tuas reuniões e disponibilidades. Chat: uma pergunta, uma ideia, uma dúvida, o Aaron responde. Mais: resultados, documentos, equipa, A minha conta e as preferências.', n: 'Nas preferências, aconselho-te a pôr a tua assinatura e o logótipo da empresa: o Aaron escreve a partir da tua caixa, mais vale que seja à tua imagem.', y: 'Mudas uma definição em A minha conta quando quiseres.', a: 'Adapta-se a cada mudança, sem reiniciar.',
        m: { h: 'Chat com o Aaron', u1: 'Prefiro as videochamadas só de manhã.', a1: 'Anotado: deixo de propor videochamadas à tarde. Também podes definir em Agenda → Disponibilidades.', u2: 'E para os caterings, insiste mais nos eventos de empresa do que nos casamentos.', a2: 'Entendido, aplico a partir do próximo email.' } },
      { t: 'Três definições, e lançamos', l: 'O Aaron precisa da tua caixa de correio (escreve a partir do teu endereço), das tuas disponibilidades (só propõe esses horários) e da autorização para te avisar. Dois minutos, e a tua primeira campanha parte.', n: 'A tua ficha de empresa já está feita: é a conversa que acabaste de ter com o Aaron.', nInvited: 'A tua ficha de empresa já foi feita pela tua equipa.', y: '', a: '',
        m: { h: 'Antes de lançar', rows: ['Ficha de empresa · feita com o Aaron', 'Caixa de correio · Gmail, Outlook ou outra', 'Disponibilidades · segunda–sexta 9h–17h por defeito', 'Notificações · neste telemóvel', 'Assinatura e logótipo · nas preferências (aconselhado)'], btn: 'Lançar a minha primeira campanha' } },
    ],
  },
  nl: {
    prev: 'Vorige', next: 'Volgende', done: 'Aan de slag', skip: 'Rondleiding overslaan', counter: 'Rondleiding · {i} van {n}', you: 'Jij', aaron: 'Aaron',
    nav: ['Campagnes', 'Contacten', 'Agenda', 'Chat', 'Meer'],
    s: [
      { t: 'Alles begint met een campagne', l: 'Je vertelt Aaron wie je als klant wilt en waar. Geen bestand te kopen, geen lijst voor te bereiden: hij vertrekt van je bedrijfsprofiel en stelt een eerste, al ingevulde campagne voor.', n: 'Die lanceren we samen aan het einde van deze rondleiding.', y: 'Jij past de regio, de beroepen en het aantal bedrijven aan.', a: 'Hij zoekt de bedrijven, vindt de juiste persoon en schrijft de eerste e-mail.',
        m: { h: 'Campagnes', reco: 'Aaron beveelt je een campagne aan', line: '{zone} · {sector} · {n}', sizes: ['Micro', 'MKB', 'Middelgroot'], who: '{who}', whoSub: 'De persoon om te benaderen', btn: 'Campagne starten' } },
      { t: 'Aaron zoekt, leest en schrijft dan', l: 'Voor elk bedrijf leest hij de website, vindt de juiste contactpersoon en schrijft een persoonlijke eerste e-mail, in de taal van de prospect, vanuit jouw mailbox.', n: 'Alleen de allereerste e-mail van je account wacht op jouw goedkeuring, zodat we de toon samen controleren. Alle volgende gaan vanzelf. Wil je liever elke eerste e-mail nalezen, dan staat die optie in je voorkeuren.', y: 'Jij keurt de allereerste e-mail goed, één keer.', a: 'Hij verstuurt alle andere, in het juiste tempo, zonder je mailbox ooit te overbelasten.',
        m: { h: 'Je allereerste e-mail', sub: '{c1} · {p1}, {r1}', body: 'Hallo {f1}, ik zag dat {c1} steeds meer bedrijfsevenementen verzorgt. Wij helpen cateraars hun agenda te vullen buiten het bruiloftseizoen…', ok: 'Goedkeuren en versturen', edit: 'Bewerken', found: 'gevonden', rows: [['{c2}', '{r2}'], ['{c3}', '{r3}']] } },
      { t: 'De antwoorden komen, Aaron antwoordt', l: 'Een vraag over de prijs, een verzoek om voorbeelden, een „bel me in januari”: Aaron leest elk antwoord en antwoordt zelf, zoals jij zou doen. Wie niet reageert, krijgt op het juiste moment een herinnering.', n: 'Je krijgt een melding op je telefoon en computer zodra een prospect antwoordt.', y: 'Niets. Je leest mee als je wilt.', a: 'Hij antwoordt, herinnert, en stopt meteen als men dat vraagt.',
        m: { h: '{reply} heeft geantwoord', q: 'Hallo, waarom niet. Hebben jullie voorbeelden van restaurants die het gedaan hebben? Wat kost het?', r: 'Zeker {reply}. Twee bistro’s vergelijkbaar met de uwe vullen sinds september hun dinsdagen en woensdagen…', notif: '{reply} heeft geantwoord · Aaron regelt het' } },
      { t: 'De afspraak maakt zichzelf', l: 'Aaron biedt alleen jouw vrije momenten aan. Zegt de prospect „dinsdag 10 uur”, dan is de afspraak bevestigd: agenda-uitnodiging, bevestigingsmail, videolink of adres.', n: 'Je komt alleen tussenbeide als de afspraak binnen 24 uur valt. De avond ervoor om 20 uur krijg je je dag van morgen; dan een herinnering 30 min vooraf (1 uur voor een afspraak ter plaatse). Iets onverwachts? „Ik ben verlaat” waarschuwt de prospect met één tik.', y: 'Jij verschijnt op de afspraak, goed voorbereid.', a: 'Hij plant, bevestigt, herinnert de prospect de dag ervoor en jou vlak voordien.',
        m: { h: 'Agenda', when: 'Dinsdag 11 · 10:00 · telefoon', who: '{p1}, {c1}', status: 'Bevestigd', b1: 'Verzetten', b2: 'Ik ben verlaat', notif: 'Afspraak bevestigd · {p1}, dinsdag 10 uur. Uitnodiging verstuurd.' } },
      { t: 'Vóór de afspraak: de kaart', l: 'Elk contact heeft zijn kaart: Aarons kijk op het bedrijf, het profiel van de persoon, zijn advies voor jou en het hele gesprek. Je komt op de afspraak en weet met wie je praat.', n: '', y: 'Je leest twee minuten voordat je belt.', a: 'Hij heeft de briefing klaar: behoefte, persoonlijkheid, aandachtspunt.',
        m: { h: '{p1}', tag: 'Kans', k1: 'Aarons kijk op het bedrijf', v1: 'Ideaal doelwit: cateraar voor bedrijfsevenementen, 18 medewerkers, snelle beslissing door de eigenaar.', k2: 'Advies', v2: 'Ze vergelijkt twee aanbieders tegen donderdag: stuur de offerte eerder.', k3: 'Persoonlijkheid · dominant', v3: 'Korte antwoorden, beslist snel. Resultaten en termijnen, geen details.' } },
      { t: 'Na de afspraak: twee tikken', l: 'Aaron vraagt hoe het ging. Je tikt „goed” of „moeilijk”, de uitkomst, een woord als je wilt. Hij schrijft de e-mail na de afspraak: de samenvatting van wat hij begrepen heeft, en de stap naar de offerte.', n: 'Was het gespannen, dan komt de prospect dat nooit te weten: bezwaren worden toezeggingen.', y: 'Twee chips en een woord.', a: 'De balans, de e-mail, het vervolg.',
        m: { h: 'Balans van de afspraak', q1: 'Hoe ging het?', c1: ['Goed', 'Gemengd', 'Moeilijk'], q2: 'En dan?', c2: ['Offerte gevraagd', 'Doorgaan', 'Verloren'], mailT: 'Aaron verstuurt de e-mail na de afspraak', mail: '„Bedankt voor het gesprek… ik heb uw verwachtingen genoteerd en kom binnenkort bij u terug met ons aanbod.”', btn: 'Balans opslaan' } },
      { t: 'Van prospect naar klant, zonder overtypen', l: 'Prospect, afspraak, kans, offerte, klant: elk contact schuift vanzelf op in het traject, op basis van wat er echt gebeurt in de e-mails en jouw balansen. Jij laadt je offerte op, Aaron controleert ze, verstuurt ze en waarschuwt je op de seconde dat de klant ze opent: hét moment om te bellen, binnen 30 minuten.', n: 'Tekent een klant, dan stopt Aaron. Hij komt één keer terug, dertig dagen later, om te vragen of hij iemand kent voor wie jouw dienst interessant is.', y: 'Jij tekent.', a: 'Hij ordent, volgt op en vraagt om een aanbeveling.',
        m: { h: 'Contacten', stats: [['4', 'benaderd'], ['2', 'afspraken'], ['1', 'offerte'], ['1', 'klant']], rows: [['{p1} · {c1}', 'Offerte gevraagd'], ['{client} · {clientCo}', 'Klant'], ['{p3} · {c3}', 'Herinnering donderdag']], foot: 'Over 30 dagen: Aaron vraagt {client} naar geïnteresseerde contacten.', notif: 'Offerte geopend — {p1} leest je offerte. Bel nu.' } },
      { t: 'Wat op je wacht, en niets anders', l: 'De acties die jou nodig hebben verschijnen bovenaan het scherm, als stories: je allereerste e-mail om goed te keuren, een afspraak binnen 24 uur, een balans die nog moet, een offerteaanvraag.', n: 'Geen story, niets te doen. Zo simpel is het.', y: 'Jij handelt de stories af als je vijf minuten hebt.', a: 'Hij stoort je alleen als hij niet alleen kan beslissen.',
        m: { stories: [['1', 'E-mail goedkeuren'], ['1', 'Balans te doen'], ['1', 'Offerte gevraagd']], t1: '{p1} vraagt een offerte', b1: 'Voor het evenementenseizoen, vóór donderdag.', a1: 'Kaart openen', a2: 'Later', t2: 'Afspraak morgen 6:45 · goed te keuren', b2: '{early} stelt een gesprek voor 7 uur voor. Binnen 24 uur: jij beslist.' } },
      { t: 'Mijn documenten: wat Aaron bij de hand heeft', l: 'Laad je brochure, je tarieven, een offertesjabloon, voorbeelden van je werk op. Aaron leest ze, gebruikt ze om precies te antwoorden en voegt ze toe als een prospect erom vraagt.', n: 'Jij kiest, document per document, wat Aaron mag gebruiken en voor wie: prospects, kansen of klanten.', y: 'Jij laadt de bestanden op die je zelf zou sturen.', a: 'Hij noemt de juiste cijfers en voegt het juiste document toe.',
        m: { h: 'Mijn documenten', rows: [['{doc1}', 'In gebruik · Prospects'], ['{doc2}', 'In gebruik · Kansen'], ['{doc3}', 'In gebruik · Kansen']], foot: '„{reply} vraagt voorbeelden: ik voeg de brochure toe.”' } },
      { t: 'Vijf plekken, meer niet', l: 'Campagnes: wat Aaron voor je zoekt. Contacten: elke persoon, zijn kaart, zijn gesprek. Agenda: je afspraken en beschikbaarheid. Chat: een vraag, een idee, een twijfel, Aaron antwoordt. Meer: resultaten, documenten, team, Mijn account en de voorkeuren.', n: 'In de voorkeuren raad ik je aan je handtekening en bedrijfslogo toe te voegen: Aaron schrijft vanuit jouw mailbox, dus laat het op jou lijken.', y: 'Jij wijzigt een instelling in Mijn account wanneer je wilt.', a: 'Hij past zich aan elke wijziging aan, zonder herstart.',
        m: { h: 'Chat met Aaron', u1: 'Ik heb liever alleen ’s ochtends videogesprekken.', a1: 'Genoteerd: ik bied ’s middags geen videogesprekken meer aan. Je kunt het ook instellen bij Agenda → Beschikbaarheid.', u2: 'En bij cateraars: leg meer nadruk op bedrijfsevenementen dan op bruiloften.', a2: 'Begrepen, ik pas het toe vanaf de volgende e-mail.' } },
      { t: 'Drie instellingen, dan lanceren we', l: 'Aaron heeft je mailbox nodig (hij schrijft vanuit jouw adres), je beschikbaarheid (hij biedt alleen die momenten aan) en toestemming om je te waarschuwen. Twee minuten, en je eerste campagne vertrekt.', n: 'Je bedrijfsprofiel is al klaar: dat is het gesprek dat je net met Aaron had.', nInvited: 'Je bedrijfsprofiel is al door je team gemaakt.', y: '', a: '',
        m: { h: 'Vóór de start', rows: ['Bedrijfsprofiel · gemaakt met Aaron', 'Mailbox · Gmail, Outlook of andere', 'Beschikbaarheid · maandag–vrijdag 9–17 uur standaard', 'Meldingen · op deze telefoon', 'Handtekening en logo · in de voorkeuren (aanbevolen)'], btn: 'Mijn eerste campagne starten' } },
    ],
  },
};

export const GUIDED_TOUR_SLIDE_COUNT = T.fr.s.length;

function fill(str, ex) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (ex[k] != null ? ex[k] : m));
}
function deepFill(v, ex) {
  if (Array.isArray(v)) return v.map((x) => deepFill(x, ex));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepFill(x, ex)]));
  return fill(v, ex);
}

const NAV_ICONS = [Megaphone, Users, CalendarDays, MessageCircle, MoreHorizontal];

function Phone({ children, nav, active }) {
  return (
    <div className="gt-phone" aria-hidden="true">
      <div className="gt-screen">{children}</div>
      {nav && (
        <div className="gt-nav">
          {nav.map((label, i) => {
            const Icon = NAV_ICONS[i];
            return <span key={label} className={i === active ? 'on' : ''}><Icon size={14} strokeWidth={2} />{label}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function Notif({ text }) {
  return <div className="gt-notif"><span className="gt-a">A</span><span><b>Meet Aaron</b><br />{text}</span></div>;
}

function Mock({ index, m, nav }) {
  switch (index) {
    case 0: return (
      <Phone nav={nav} active={0}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-card">
          <div className="gt-k">{m.reco}</div>
          <div className="gt-strong">{m.line}</div>
          <div className="gt-chips">{m.sizes.map((s, i) => <span key={s} className={i === 1 ? 'on' : ''}>{s}</span>)}</div>
          <div className="gt-strong" style={{ marginTop: 8 }}>{m.who}</div>
          <div className="gt-sub">{m.whoSub}</div>
          <div className="gt-btn">{m.btn}</div>
        </div>
      </Phone>
    );
    case 1: return (
      <Phone nav={nav} active={1}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-card">
          <div className="gt-k">{m.sub}</div>
          <p className="gt-p">{m.body}</p>
          <div className="gt-row2"><span className="gt-btn">{m.ok}</span><span className="gt-btn ghost">{m.edit}</span></div>
        </div>
        {m.rows.map(([c, r]) => <div key={c} className="gt-line"><b>{c}</b><span className="gt-sub">{m.found} · {r}</span></div>)}
      </Phone>
    );
    case 2: return (
      <Phone nav={nav} active={1}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-bubble them">{m.q}</div>
        <div className="gt-bubble me">{m.r}</div>
        <Notif text={m.notif} />
      </Phone>
    );
    case 3: return (
      <Phone nav={nav} active={2}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-cal">{Array.from({ length: 14 }, (_, i) => <span key={i} className={i === 1 ? 'on' : ''}>{10 + i}</span>)}</div>
        <div className="gt-card">
          <div className="gt-k">{m.when}</div>
          <div className="gt-strong">{m.who}</div>
          <div className="gt-chips"><span className="ok">{m.status}</span><span>{m.b1}</span><span>{m.b2}</span></div>
        </div>
        <Notif text={m.notif} />
      </Phone>
    );
    case 4: return (
      <Phone nav={nav} active={1}>
        <div className="gt-h">{m.h} <span className="gt-tag">{m.tag}</span></div>
        <div className="gt-card"><div className="gt-k">{m.k1}</div><p className="gt-p">{m.v1}</p></div>
        <div className="gt-card"><div className="gt-k">{m.k2}</div><p className="gt-p">{m.v2}</p></div>
        <div className="gt-card"><div className="gt-k">{m.k3}</div><p className="gt-p">{m.v3}</p></div>
      </Phone>
    );
    case 5: return (
      <Phone>
        <div className="gt-h">{m.h}</div>
        <div className="gt-k">{m.q1}</div>
        <div className="gt-chips">{m.c1.map((c, i) => <span key={c} className={i === 0 ? 'on' : ''}>{c}</span>)}</div>
        <div className="gt-k" style={{ marginTop: 8 }}>{m.q2}</div>
        <div className="gt-chips">{m.c2.map((c, i) => <span key={c} className={i === 0 ? 'on' : ''}>{c}</span>)}</div>
        <div className="gt-card" style={{ marginTop: 8 }}><div className="gt-k">{m.mailT}</div><p className="gt-p">{m.mail}</p></div>
        <div className="gt-btn">{m.btn}</div>
      </Phone>
    );
    case 6: return (
      <Phone nav={nav} active={1}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-stats">{m.stats.map(([n, l]) => <span key={l}><b>{n}</b>{l}</span>)}</div>
        {m.rows.map(([a, b]) => <div key={a} className="gt-line"><b>{a}</b><span className="gt-pill">{b}</span></div>)}
        <p className="gt-sub">{m.foot}</p>
        <Notif text={m.notif} />
      </Phone>
    );
    case 7: return (
      <Phone nav={nav} active={0}>
        <div className="gt-stories">{m.stories.map(([n, l]) => <span key={l}><i>{n}</i>{l}</span>)}</div>
        <div className="gt-card"><div className="gt-strong">{m.t1}</div><p className="gt-p">{m.b1}</p><div className="gt-row2"><span className="gt-btn">{m.a1}</span><span className="gt-btn ghost">{m.a2}</span></div></div>
        <div className="gt-card"><div className="gt-strong">{m.t2}</div><p className="gt-p">{m.b2}</p></div>
      </Phone>
    );
    case 8: return (
      <Phone nav={nav} active={4}>
        <div className="gt-h">{m.h}</div>
        {m.rows.map(([a, b]) => <div key={a} className="gt-line"><b><FileText size={12} strokeWidth={2} /> {a}</b><span className="gt-sub">{b}</span></div>)}
        <div className="gt-bubble me">{m.foot}</div>
      </Phone>
    );
    case 9: return (
      <Phone nav={nav} active={3}>
        <div className="gt-h">{m.h}</div>
        <div className="gt-bubble them">{m.u1}</div>
        <div className="gt-bubble me">{m.a1}</div>
        <div className="gt-bubble them">{m.u2}</div>
        <div className="gt-bubble me">{m.a2}</div>
      </Phone>
    );
    default: return (
      <Phone nav={nav} active={0}>
        <div className="gt-h">{m.h}</div>
        {m.rows.map((r, i) => <div key={r} className="gt-line"><b><span className={`gt-check${i === 0 ? ' done' : ''}`}><Check size={10} strokeWidth={3} /></span> {r}</b></div>)}
        <div className="gt-btn">{m.btn}</div>
      </Phone>
    );
  }
}

// Props : locale ; invited (fiche entreprise faite par l'équipe) ; onDone ;
// onSkip (facultatif, sinon = onDone) ; doneLabel (facultatif).
export default function GuidedTour({ locale = 'fr', invited = false, onDone, onSkip, doneLabel }) {
  const L = T[locale] || T.fr;
  const ex = EX[locale] || EX.fr;
  const [i, setI] = useState(0);
  const n = L.s.length;
  const slide = deepFill(L.s[i], ex);
  const last = i === n - 1;

  useEffect(() => {
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  }, [i]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight' && !last) setI((v) => Math.min(n - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, n]);

  return (
    <div className="gt">
      <div className="gt-top">
        <span className="gt-counter">{L.counter.replace('{i}', String(i + 1)).replace('{n}', String(n))}</span>
        <div className="gt-dots" aria-hidden="true">{L.s.map((_, k) => <button key={k} type="button" className={k === i ? 'on' : k < i ? 'seen' : ''} onClick={() => setI(k)} tabIndex={-1} />)}</div>
        <button type="button" className="gt-skip" onClick={onSkip || onDone}>{L.skip}</button>
      </div>

      <div className="gt-body">
        <div className="gt-text">
          <h1>{slide.t}</h1>
          <p className="gt-lead">{slide.l}</p>
          {(invited && slide.nInvited ? slide.nInvited : slide.n) && <p className="gt-note">{invited && slide.nInvited ? slide.nInvited : slide.n}</p>}
          {(slide.y || slide.a) && (
            <div className="gt-split">
              {slide.y && <div><span className="gt-who">{L.you}</span><p>{slide.y}</p></div>}
              {slide.a && <div className="aaron"><span className="gt-who">{L.aaron}</span><p>{slide.a}</p></div>}
            </div>
          )}
        </div>
        <div className="gt-mock">
          <Mock index={i} m={slide.m} nav={L.nav} />
        </div>
      </div>

      <div className="gt-foot">
        <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => setI(i - 1)}><ArrowLeft size={15} aria-hidden="true" /> {L.prev}</button>
        {last
          ? <button type="button" className="btn-primary" onClick={onDone}>{doneLabel || L.done} <ArrowRight size={15} aria-hidden="true" /></button>
          : <button type="button" className="btn-primary" onClick={() => setI(i + 1)}>{L.next} <ArrowRight size={15} aria-hidden="true" /></button>}
      </div>

      <style jsx>{`
        .gt { display: flex; flex-direction: column; gap: 1rem; }
        .gt-top { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .gt-counter { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
        .gt-dots { display: flex; gap: 4px; flex: 1; min-width: 120px; }
        .gt-dots button { flex: 1; height: 4px; border: 0; border-radius: 999px; background: var(--border); padding: 0; cursor: pointer; }
        .gt-dots button.seen { background: color-mix(in srgb, var(--accent) 45%, var(--border)); }
        .gt-dots button.on { background: var(--accent); }
        .gt-skip { margin-left: auto; background: none; border: 0; color: var(--muted); font-size: 0.8rem; cursor: pointer; font-family: inherit; text-decoration: underline; }
        .gt-body { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 1.5rem; align-items: start; }
        @media (max-width: 720px) { .gt-body { grid-template-columns: 1fr; } }
        h1 { font-family: var(--font-display); font-size: 1.5rem; line-height: 1.25; margin: 0.2rem 0 0.5rem; }
        .gt-lead { color: var(--text); font-size: 0.95rem; line-height: 1.55; margin: 0 0 0.8rem; }
        .gt-note { color: var(--muted); font-size: 0.88rem; line-height: 1.5; margin: 0 0 1rem; padding-left: 0.75rem; border-left: 3px solid var(--accent); }
        .gt-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
        .gt-split > div { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0.7rem 0.8rem; }
        .gt-split > div.aaron { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
        .gt-who { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; margin-bottom: 0.25rem; }
        .gt-split p { margin: 0; font-size: 0.86rem; line-height: 1.45; }
        .gt-mock { display: flex; justify-content: center; }
        .gt-phone { width: 100%; max-width: 300px; border: 1px solid var(--border); border-radius: 22px; background: var(--bg); overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
        .gt-screen { padding: 0.85rem 0.8rem; display: flex; flex-direction: column; gap: 0.5rem; min-height: 300px; font-size: 0.74rem; line-height: 1.4; }
        .gt-nav { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--border); padding: 0.4rem 0.2rem; background: var(--surface); }
        .gt-nav span { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 0.56rem; color: var(--muted); }
        .gt-nav span.on { color: var(--accent); font-weight: 700; }
        .gt-h { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .gt-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0.6rem 0.65rem; display: flex; flex-direction: column; gap: 0.3rem; }
        .gt-k { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
        .gt-strong { font-weight: 600; }
        .gt-sub { color: var(--muted); font-size: 0.68rem; }
        .gt-p { margin: 0; color: var(--text); }
        .gt-chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
        .gt-chips span { border: 1px solid var(--border); border-radius: 999px; padding: 0.15rem 0.5rem; font-size: 0.66rem; color: var(--muted); }
        .gt-chips span.on { background: var(--accent); color: #fff; border-color: var(--accent); }
        .gt-chips span.ok { color: var(--accent); border-color: var(--accent); font-weight: 600; }
        .gt-btn { display: inline-block; background: var(--accent); color: #fff; border-radius: 8px; padding: 0.35rem 0.6rem; font-weight: 600; font-size: 0.7rem; text-align: center; margin-top: 0.3rem; }
        .gt-btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
        .gt-row2 { display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .gt-line { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.4rem 0.2rem; border-bottom: 1px solid var(--border); }
        .gt-line b { font-weight: 600; display: inline-flex; align-items: center; gap: 0.3rem; }
        .gt-pill { border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.45rem; font-size: 0.62rem; color: var(--muted); white-space: nowrap; }
        .gt-bubble { max-width: 92%; border-radius: 14px; padding: 0.5rem 0.65rem; }
        .gt-bubble.them { background: var(--surface); border: 1px solid var(--border); align-self: flex-start; }
        .gt-bubble.me { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); align-self: flex-end; }
        .gt-notif { margin-top: auto; display: flex; gap: 0.5rem; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0.45rem 0.55rem; font-size: 0.68rem; box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
        .gt-a { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
        .gt-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .gt-cal span { text-align: center; padding: 0.2rem 0; border-radius: 6px; font-size: 0.66rem; color: var(--muted); }
        .gt-cal span.on { background: var(--accent); color: #fff; font-weight: 700; }
        .gt-tag { font-size: 0.6rem; border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; padding: 0.05rem 0.4rem; font-family: var(--font-body, inherit); font-weight: 600; }
        .gt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.3rem; }
        .gt-stats span { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.35rem 0.2rem; display: flex; flex-direction: column; align-items: center; font-size: 0.58rem; color: var(--muted); }
        .gt-stats b { font-size: 0.95rem; color: var(--text); }
        .gt-stories { display: flex; gap: 0.5rem; }
        .gt-stories span { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; font-size: 0.58rem; color: var(--muted); text-align: center; width: 64px; }
        .gt-stories i { width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--accent); display: inline-flex; align-items: center; justify-content: center; font-style: normal; font-weight: 700; color: var(--text); background: var(--surface); }
        .gt-check { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--border); display: inline-flex; align-items: center; justify-content: center; color: transparent; flex-shrink: 0; }
        .gt-check.done { background: var(--accent); border-color: var(--accent); color: #fff; }
        .gt-foot { display: flex; justify-content: space-between; gap: 0.75rem; padding-top: 0.5rem; }
        .btn-primary, .btn-secondary { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 10px; padding: 0.6rem 1rem; font-weight: 600; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
        .btn-primary { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
        .btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
        .btn-secondary:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </div>
  );
}
