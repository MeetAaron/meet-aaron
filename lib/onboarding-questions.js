// lib/onboarding-questions.js
// Les 12 questions de découverte de l'entreprise et leurs réponses suggérées
// (puces), partagées entre le chat (app/app/chat) et le parcours de première
// connexion (app/app/bienvenue, 22/10/2026). Déplacées telles quelles depuis
// app/app/chat/page.jsx : une seule source, pour que les deux écrans posent
// exactement les mêmes questions avec les mêmes puces.

import { t } from './i18n';

// Questions de découverte posées par Aaron une par une lors du premier accueil,
// pour construire un vrai profil commercial "clé en main" plutôt qu'un simple
// pavé de texte libre. Les réponses alimentent /api/business-summary.
export const ONBOARDING_QUESTION_KEYS = [
  'chat.onboardingQ1',
  // Q1b (2026-08-27, demande Alex, docx "Modifs Aaron") : la Q1 posait 2
  // questions en une (secteur d'activité ET taille d'entreprise) — scindée
  // en 2 questions distinctes, celle-ci juste après pour ne pas décaler le
  // sens des questions suivantes.
  'chat.onboardingQ1b',
  'chat.onboardingQ2',
  'chat.onboardingQ3',
  'chat.onboardingQ4',
  'chat.onboardingQ5',
  'chat.onboardingQ6',
  'chat.onboardingQ7',
  // Q_Differentiation / Q_SocialProof / Q_Trigger (2026-08-26, demande Alex :
  // "la création du profil business gagnerait à être plus complet") — trois
  // questions à plus fort levier ajoutées AVANT Q8 (pas après) pour ne pas
  // avoir à retraduire Q8 dans les 7 langues, son texte étant explicitement
  // formulé comme "Dernière question" — Q8 reste donc bien la dernière
  // affichée. Ces 3 nouveaux textes suivent le pattern pragmatique déjà en
  // place cette session (clés FR uniquement, t() retombe sur le français pour
  // les autres langues, voir documents.summaryModalTitle/prospects.aiManagedOn
  // par exemple) plutôt que d'être traduits dans les 7 locales.
  'chat.onboardingQDifferentiation',
  'chat.onboardingQSocialProof',
  'chat.onboardingQTrigger',
  // Q8 (2026-08-25, demande Alex) : éléments d'autorité/légitimité (expérience,
  // certifications, chiffres, références) — sans ça le résumé business ne
  // contient rien que le premier email à un prospect puisse utiliser pour
  // établir une vraie posture d'expert (principe d'autorité de Cialdini),
  // voir app/api/business-summary/route.ts et lib/aaron_system_prompt.md.
  'chat.onboardingQ8',
];

export function getOnboardingQuestions(locale) {
  return ONBOARDING_QUESTION_KEYS.map((key) => t(key, locale));
}

// Suggestions cliquables par question du questionnaire de découverte
// (demande Alex, 27/08/2026, docx "Modifs Aaron" : "quand tu poses tes
// questions, guide un peu l'utilisateur [...] à chaque question au moins
// 4-5 propositions déjà faites. Quand l'utilisateur clique dessus ça écrit
// le texte" — exemple donné : clic sur "TPE" → Aaron écrit "mes clients
// sont généralement des TPE"). Cliquer remplace le contenu du champ de
// saisie par la phrase toute faite ; le commercial reste libre de la
// modifier avant d'envoyer.
//
// Traduites dans les 7 langues du site (2026-08-27, demande explicite Alex :
// "bah fais le pour les autres langues du site mdr" — override de la
// décision initiale FR-only). Objet imbriqué {locale: {questionKey: [...]}}.
// Les tailles d'entreprise françaises TPE/PME/ETI n'ont pas d'équivalent
// littéral dans les autres langues : adaptées au vocabulaire local usuel
// (micro-business/SMB en EN, KMU en DE, PMI en IT, pymes en ES, PME en PT,
// mkb en NL) plutôt que traduites mot à mot.
export const ONBOARDING_QUESTION_SUGGESTIONS = {
  fr: {
    'chat.onboardingQ1': [
      { label: 'BTP / Artisanat', text: 'Je travaille principalement dans le secteur du BTP et de l\'artisanat.' },
      { label: 'Services aux entreprises', text: 'Je travaille dans les services aux entreprises (B2B).' },
      { label: 'Commerce / Distribution', text: 'Je travaille dans le commerce et la distribution.' },
      { label: 'Tech / Logiciel', text: 'Je travaille dans la tech, sur des solutions logicielles (SaaS).' },
      { label: 'Santé / Bien-être', text: 'Je travaille dans le secteur de la santé et du bien-être.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'TPE', text: 'Mes clients sont généralement des TPE.' },
      { label: 'PME', text: 'Mes clients sont généralement des PME.' },
      { label: 'ETI / Grand groupe', text: 'Mes clients sont généralement des ETI ou des grands groupes.' },
      { label: 'Particuliers', text: 'Je travaille surtout avec des particuliers, pas des entreprises.' },
      { label: 'Tous types', text: 'Je travaille avec des entreprises de toutes tailles.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Un seul profil homogène', text: 'J\'ai une seule famille de clients, assez homogène.' },
      { label: 'Plusieurs profils distincts', text: 'J\'ai plusieurs profils de clients bien distincts.' },
      { label: 'Ça dépend des offres', text: 'Ça dépend des offres ou des périodes.' },
    ],
    'chat.onboardingQ3': [
      { label: 'Pressés', text: 'Mes clients sont généralement pressés, ils veulent aller droit au but.' },
      { label: 'Méfiants', text: 'Mes clients sont plutôt méfiants au premier contact.' },
      { label: 'Bavards', text: 'Mes clients aiment discuter, ils sont plutôt bavards.' },
      { label: 'Factuels', text: 'Mes clients sont factuels, ils veulent des chiffres et des preuves.' },
      { label: 'Exigeants', text: 'Mes clients sont exigeants sur la qualité.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Un produit', text: 'Mon produit phare est : ' },
      { label: 'Un service', text: 'Mon service phare est : ' },
      { label: 'Un abonnement (SaaS)', text: 'Mon offre phare est un abonnement (SaaS) : ' },
      { label: 'Une prestation sur-mesure', text: 'Mon offre phare est une prestation sur-mesure : ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Rapport qualité-prix', text: 'L\'argument qui fait le plus mouche, c\'est le rapport qualité-prix.' },
      { label: 'Gain de temps', text: 'L\'argument qui fait le plus mouche, c\'est le gain de temps que j\'apporte.' },
      { label: 'Qualité / savoir-faire', text: 'L\'argument qui fait le plus mouche, c\'est la qualité du travail et le savoir-faire.' },
      { label: 'Réactivité / proximité', text: 'L\'argument qui fait le plus mouche, c\'est ma réactivité et ma proximité.' },
    ],
    'chat.onboardingQ6': [
      { label: 'Le prix', text: 'L\'objection la plus fréquente, c\'est le prix.' },
      { label: 'Le manque de temps', text: 'L\'objection la plus fréquente, c\'est le manque de temps du prospect.' },
      { label: 'La confiance', text: 'L\'objection la plus fréquente, c\'est la confiance envers un nouveau prestataire.' },
      { label: 'Déjà un prestataire', text: 'L\'objection la plus fréquente, c\'est qu\'ils travaillent déjà avec quelqu\'un d\'autre.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Obtenir un rendez-vous', text: 'L\'idéal après un premier contact, c\'est d\'obtenir un rendez-vous.' },
      { label: 'Envoyer un devis', text: 'L\'idéal après un premier contact, c\'est d\'envoyer un devis.' },
      { label: 'Proposer un essai gratuit', text: 'L\'idéal après un premier contact, c\'est de proposer un essai gratuit.' },
      { label: 'Envoyer de la documentation', text: 'L\'idéal après un premier contact, c\'est d\'envoyer de la documentation.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Savoir-faire / expertise', text: 'Ce qui me différencie, c\'est mon savoir-faire et mon expertise.' },
      { label: 'Réactivité', text: 'Ce qui me différencie, c\'est ma réactivité.' },
      { label: 'Positionnement prix', text: 'Ce qui me différencie, c\'est mon positionnement prix.' },
      { label: 'Accompagnement / suivi', text: 'Ce qui me différencie, c\'est l\'accompagnement et le suivi que j\'offre.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Oui, avec des chiffres', text: 'Oui, j\'ai un exemple concret avec un résultat chiffré : ' },
      { label: 'Oui, sans chiffres précis', text: 'Oui, j\'ai un exemple concret, sans chiffres précis : ' },
      { label: 'Pas d\'exemple pour l\'instant', text: 'Je n\'ai pas d\'exemple précis à donner pour l\'instant.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Un événement précis', text: 'Ce qui pousse généralement un prospect à se décider, c\'est un événement précis (déménagement, recrutement, panne...).' },
      { label: 'Une période de l\'année', text: 'Ce qui pousse généralement un prospect à se décider, c\'est une période de l\'année particulière.' },
      { label: 'Fin de contrat concurrent', text: 'Ce qui pousse généralement un prospect à se décider, c\'est la fin d\'un contrat avec un concurrent.' },
      { label: 'Difficile à dire', text: 'C\'est difficile à dire, ça varie beaucoup selon les prospects.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Années d\'expérience', text: 'J\'ai plusieurs années d\'expérience dans ce domaine.' },
      { label: 'Certifications / labels', text: 'J\'ai des certifications ou labels reconnus dans mon secteur.' },
      { label: 'Nombre de clients/chantiers', text: 'J\'ai déjà réalisé de nombreux clients/chantiers dans ce domaine.' },
      { label: 'Références notables', text: 'J\'ai des références notables que je peux citer.' },
      { label: 'Rien de précis pour l\'instant', text: 'Je n\'ai pas d\'élément précis à mettre en avant pour l\'instant.' },
    ],
  },
  en: {
    'chat.onboardingQ1': [
      { label: 'Construction / Trades', text: 'I mainly work in construction and skilled trades.' },
      { label: 'Business services', text: 'I work in business services (B2B).' },
      { label: 'Retail / Distribution', text: 'I work in retail and distribution.' },
      { label: 'Tech / Software', text: 'I work in tech, on software solutions (SaaS).' },
      { label: 'Health / Wellness', text: 'I work in the health and wellness sector.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Small businesses', text: 'My clients are usually small businesses.' },
      { label: 'Mid-sized companies', text: 'My clients are usually mid-sized companies.' },
      { label: 'Large enterprises', text: 'My clients are usually large enterprises or corporations.' },
      { label: 'Individuals', text: 'I mostly work with individuals, not companies.' },
      { label: 'All sizes', text: 'I work with companies of all sizes.' },
    ],
    'chat.onboardingQ2': [
      { label: 'One homogeneous profile', text: 'I have a single, fairly homogeneous client base.' },
      { label: 'Several distinct profiles', text: 'I have several distinct client profiles.' },
      { label: 'It depends on the offer', text: 'It depends on the offer or the time of year.' },
    ],
    'chat.onboardingQ3': [
      { label: 'In a hurry', text: 'My clients are usually in a hurry, they want to get straight to the point.' },
      { label: 'Wary', text: 'My clients tend to be wary on first contact.' },
      { label: 'Chatty', text: 'My clients like to chat, they tend to be talkative.' },
      { label: 'Factual', text: 'My clients are factual, they want numbers and proof.' },
      { label: 'Demanding', text: 'My clients are demanding when it comes to quality.' },
    ],
    'chat.onboardingQ4': [
      { label: 'A product', text: 'My flagship product is: ' },
      { label: 'A service', text: 'My flagship service is: ' },
      { label: 'A subscription (SaaS)', text: 'My flagship offer is a subscription (SaaS): ' },
      { label: 'A custom service', text: 'My flagship offer is a custom, tailor-made service: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Value for money', text: 'The argument that lands best is value for money.' },
      { label: 'Time savings', text: 'The argument that lands best is the time it saves them.' },
      { label: 'Quality / expertise', text: 'The argument that lands best is the quality of the work and my expertise.' },
      { label: 'Responsiveness / closeness', text: 'The argument that lands best is my responsiveness and closeness to clients.' },
    ],
    'chat.onboardingQ6': [
      { label: 'Price', text: 'The most common objection is the price.' },
      { label: 'Lack of time', text: 'The most common objection is the prospect\'s lack of time.' },
      { label: 'Trust', text: 'The most common objection is trust in a new provider.' },
      { label: 'Already have a provider', text: 'The most common objection is that they already work with someone else.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Book a meeting', text: 'Ideally, after a first contact, I book a meeting.' },
      { label: 'Send a quote', text: 'Ideally, after a first contact, I send a quote.' },
      { label: 'Offer a free trial', text: 'Ideally, after a first contact, I offer a free trial.' },
      { label: 'Send documentation', text: 'Ideally, after a first contact, I send some documentation.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Expertise / know-how', text: 'What sets me apart is my expertise and know-how.' },
      { label: 'Responsiveness', text: 'What sets me apart is my responsiveness.' },
      { label: 'Pricing', text: 'What sets me apart is my pricing.' },
      { label: 'Support / follow-up', text: 'What sets me apart is the support and follow-up I offer.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Yes, with numbers', text: 'Yes, I have a concrete example with a measurable result: ' },
      { label: 'Yes, without exact numbers', text: 'Yes, I have a concrete example, without exact numbers: ' },
      { label: 'No example for now', text: 'I don\'t have a specific example to give right now.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'A specific event', text: 'What usually drives a prospect to decide is a specific event (moving, hiring, a breakdown...).' },
      { label: 'A time of year', text: 'What usually drives a prospect to decide is a particular time of year.' },
      { label: 'End of a competitor\'s contract', text: 'What usually drives a prospect to decide is the end of a contract with a competitor.' },
      { label: 'Hard to say', text: 'It\'s hard to say, it varies a lot from prospect to prospect.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Years of experience', text: 'I have several years of experience in this field.' },
      { label: 'Certifications / labels', text: 'I have recognized certifications or labels in my sector.' },
      { label: 'Number of clients/projects', text: 'I\'ve already completed many clients/projects in this field.' },
      { label: 'Notable references', text: 'I have notable references I can cite.' },
      { label: 'Nothing specific for now', text: 'I don\'t have anything specific to highlight right now.' },
    ],
  },
  de: {
    'chat.onboardingQ1': [
      { label: 'Bau / Handwerk', text: 'Ich arbeite hauptsächlich im Bau- und Handwerksbereich.' },
      { label: 'Unternehmensdienstleistungen', text: 'Ich arbeite im Bereich Unternehmensdienstleistungen (B2B).' },
      { label: 'Handel / Vertrieb', text: 'Ich arbeite im Handel und Vertrieb.' },
      { label: 'Tech / Software', text: 'Ich arbeite in der Tech-Branche, an Softwarelösungen (SaaS).' },
      { label: 'Gesundheit / Wellness', text: 'Ich arbeite im Gesundheits- und Wellnessbereich.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Kleinstunternehmen', text: 'Meine Kunden sind in der Regel Kleinstunternehmen.' },
      { label: 'KMU', text: 'Meine Kunden sind in der Regel KMU.' },
      { label: 'Großunternehmen', text: 'Meine Kunden sind in der Regel Großunternehmen oder Konzerne.' },
      { label: 'Privatpersonen', text: 'Ich arbeite hauptsächlich mit Privatpersonen, nicht mit Unternehmen.' },
      { label: 'Alle Größen', text: 'Ich arbeite mit Unternehmen jeder Größe.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Ein einheitliches Profil', text: 'Ich habe eine einzige, recht einheitliche Kundengruppe.' },
      { label: 'Mehrere klar unterschiedene Profile', text: 'Ich habe mehrere klar unterschiedene Kundenprofile.' },
      { label: 'Kommt auf das Angebot an', text: 'Das hängt vom Angebot oder von der Jahreszeit ab.' },
    ],
    'chat.onboardingQ3': [
      { label: 'In Eile', text: 'Meine Kunden haben es meist eilig, sie wollen direkt zum Punkt kommen.' },
      { label: 'Misstrauisch', text: 'Meine Kunden sind beim Erstkontakt eher misstrauisch.' },
      { label: 'Gesprächig', text: 'Meine Kunden reden gerne, sie sind eher gesprächig.' },
      { label: 'Sachlich', text: 'Meine Kunden sind sachlich, sie wollen Zahlen und Beweise.' },
      { label: 'Anspruchsvoll', text: 'Meine Kunden sind bei der Qualität anspruchsvoll.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Ein Produkt', text: 'Mein Hauptprodukt ist: ' },
      { label: 'Eine Dienstleistung', text: 'Meine Hauptdienstleistung ist: ' },
      { label: 'Ein Abonnement (SaaS)', text: 'Mein Hauptangebot ist ein Abonnement (SaaS): ' },
      { label: 'Eine Sonderanfertigung', text: 'Mein Hauptangebot ist eine maßgeschneiderte Leistung: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Preis-Leistungs-Verhältnis', text: 'Das Argument, das am besten zieht, ist das Preis-Leistungs-Verhältnis.' },
      { label: 'Zeitersparnis', text: 'Das Argument, das am besten zieht, ist die Zeitersparnis, die ich biete.' },
      { label: 'Qualität / Know-how', text: 'Das Argument, das am besten zieht, ist die Qualität der Arbeit und mein Know-how.' },
      { label: 'Reaktionsschnelligkeit / Nähe', text: 'Das Argument, das am besten zieht, ist meine Reaktionsschnelligkeit und Kundennähe.' },
    ],
    'chat.onboardingQ6': [
      { label: 'Der Preis', text: 'Der häufigste Einwand ist der Preis.' },
      { label: 'Zeitmangel', text: 'Der häufigste Einwand ist der Zeitmangel des Interessenten.' },
      { label: 'Vertrauen', text: 'Der häufigste Einwand ist das Vertrauen gegenüber einem neuen Anbieter.' },
      { label: 'Schon ein Anbieter', text: 'Der häufigste Einwand ist, dass sie bereits mit jemand anderem arbeiten.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Einen Termin vereinbaren', text: 'Im Idealfall vereinbare ich nach dem Erstkontakt einen Termin.' },
      { label: 'Ein Angebot senden', text: 'Im Idealfall sende ich nach dem Erstkontakt ein Angebot.' },
      { label: 'Eine kostenlose Testphase anbieten', text: 'Im Idealfall biete ich nach dem Erstkontakt eine kostenlose Testphase an.' },
      { label: 'Unterlagen senden', text: 'Im Idealfall sende ich nach dem Erstkontakt Unterlagen.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Know-how / Expertise', text: 'Was mich auszeichnet, ist mein Know-how und meine Expertise.' },
      { label: 'Reaktionsschnelligkeit', text: 'Was mich auszeichnet, ist meine Reaktionsschnelligkeit.' },
      { label: 'Preispositionierung', text: 'Was mich auszeichnet, ist meine Preispositionierung.' },
      { label: 'Betreuung / Nachverfolgung', text: 'Was mich auszeichnet, ist die Betreuung und Nachverfolgung, die ich biete.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Ja, mit Zahlen', text: 'Ja, ich habe ein konkretes Beispiel mit einem messbaren Ergebnis: ' },
      { label: 'Ja, ohne genaue Zahlen', text: 'Ja, ich habe ein konkretes Beispiel, ohne genaue Zahlen: ' },
      { label: 'Aktuell kein Beispiel', text: 'Ich habe aktuell kein konkretes Beispiel zu nennen.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Ein bestimmtes Ereignis', text: 'Was einen Interessenten meist zur Entscheidung bewegt, ist ein bestimmtes Ereignis (Umzug, Neueinstellung, Ausfall...).' },
      { label: 'Eine bestimmte Jahreszeit', text: 'Was einen Interessenten meist zur Entscheidung bewegt, ist eine bestimmte Jahreszeit.' },
      { label: 'Ende eines Konkurrenzvertrags', text: 'Was einen Interessenten meist zur Entscheidung bewegt, ist das Ende eines Vertrags mit einem Wettbewerber.' },
      { label: 'Schwer zu sagen', text: 'Das ist schwer zu sagen, das variiert stark von Interessent zu Interessent.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Jahre an Erfahrung', text: 'Ich habe mehrere Jahre Erfahrung auf diesem Gebiet.' },
      { label: 'Zertifizierungen / Gütesiegel', text: 'Ich habe anerkannte Zertifizierungen oder Gütesiegel in meiner Branche.' },
      { label: 'Anzahl Kunden/Projekte', text: 'Ich habe bereits zahlreiche Kunden/Projekte in diesem Bereich umgesetzt.' },
      { label: 'Namhafte Referenzen', text: 'Ich habe namhafte Referenzen, die ich anführen kann.' },
      { label: 'Aktuell nichts Konkretes', text: 'Ich habe aktuell nichts Konkretes hervorzuheben.' },
    ],
  },
  it: {
    'chat.onboardingQ1': [
      { label: 'Edilizia / Artigianato', text: 'Lavoro principalmente nel settore dell\'edilizia e dell\'artigianato.' },
      { label: 'Servizi alle imprese', text: 'Lavoro nei servizi alle imprese (B2B).' },
      { label: 'Commercio / Distribuzione', text: 'Lavoro nel commercio e nella distribuzione.' },
      { label: 'Tech / Software', text: 'Lavoro nel settore tech, su soluzioni software (SaaS).' },
      { label: 'Salute / Benessere', text: 'Lavoro nel settore della salute e del benessere.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Microimprese', text: 'I miei clienti sono generalmente microimprese.' },
      { label: 'PMI', text: 'I miei clienti sono generalmente PMI.' },
      { label: 'Grandi aziende', text: 'I miei clienti sono generalmente grandi aziende o gruppi.' },
      { label: 'Privati', text: 'Lavoro soprattutto con privati, non con aziende.' },
      { label: 'Tutte le dimensioni', text: 'Lavoro con aziende di tutte le dimensioni.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Un profilo unico e omogeneo', text: 'Ho un\'unica tipologia di clienti, abbastanza omogenea.' },
      { label: 'Più profili distinti', text: 'Ho più profili di clienti ben distinti.' },
      { label: 'Dipende dalle offerte', text: 'Dipende dalle offerte o dai periodi.' },
    ],
    'chat.onboardingQ3': [
      { label: 'Frettolosi', text: 'I miei clienti sono generalmente di fretta, vogliono andare dritti al punto.' },
      { label: 'Diffidenti', text: 'I miei clienti sono piuttosto diffidenti al primo contatto.' },
      { label: 'Chiacchieroni', text: 'Ai miei clienti piace parlare, sono piuttosto chiacchieroni.' },
      { label: 'Concreti', text: 'I miei clienti sono concreti, vogliono numeri e prove.' },
      { label: 'Esigenti', text: 'I miei clienti sono esigenti sulla qualità.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Un prodotto', text: 'Il mio prodotto di punta è: ' },
      { label: 'Un servizio', text: 'Il mio servizio di punta è: ' },
      { label: 'Un abbonamento (SaaS)', text: 'La mia offerta di punta è un abbonamento (SaaS): ' },
      { label: 'Una prestazione su misura', text: 'La mia offerta di punta è una prestazione su misura: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Rapporto qualità-prezzo', text: 'L\'argomento che funziona meglio è il rapporto qualità-prezzo.' },
      { label: 'Risparmio di tempo', text: 'L\'argomento che funziona meglio è il tempo che faccio risparmiare.' },
      { label: 'Qualità / competenza', text: 'L\'argomento che funziona meglio è la qualità del lavoro e la competenza.' },
      { label: 'Reattività / vicinanza', text: 'L\'argomento che funziona meglio è la mia reattività e vicinanza al cliente.' },
    ],
    'chat.onboardingQ6': [
      { label: 'Il prezzo', text: 'L\'obiezione più frequente è il prezzo.' },
      { label: 'La mancanza di tempo', text: 'L\'obiezione più frequente è la mancanza di tempo del prospect.' },
      { label: 'La fiducia', text: 'L\'obiezione più frequente è la fiducia verso un nuovo fornitore.' },
      { label: 'Hanno già un fornitore', text: 'L\'obiezione più frequente è che lavorano già con qualcun altro.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Ottenere un appuntamento', text: 'Idealmente, dopo un primo contatto, ottengo un appuntamento.' },
      { label: 'Inviare un preventivo', text: 'Idealmente, dopo un primo contatto, invio un preventivo.' },
      { label: 'Proporre una prova gratuita', text: 'Idealmente, dopo un primo contatto, propongo una prova gratuita.' },
      { label: 'Inviare documentazione', text: 'Idealmente, dopo un primo contatto, invio documentazione.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Competenza / esperienza', text: 'Ciò che mi contraddistingue è la mia competenza ed esperienza.' },
      { label: 'Reattività', text: 'Ciò che mi contraddistingue è la mia reattività.' },
      { label: 'Posizionamento di prezzo', text: 'Ciò che mi contraddistingue è il mio posizionamento di prezzo.' },
      { label: 'Assistenza / follow-up', text: 'Ciò che mi contraddistingue è l\'assistenza e il follow-up che offro.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Sì, con numeri', text: 'Sì, ho un esempio concreto con un risultato misurabile: ' },
      { label: 'Sì, senza numeri precisi', text: 'Sì, ho un esempio concreto, senza numeri precisi: ' },
      { label: 'Nessun esempio per ora', text: 'Al momento non ho un esempio preciso da fornire.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Un evento preciso', text: 'Ciò che spinge di solito un prospect a decidersi è un evento preciso (trasloco, assunzione, guasto...).' },
      { label: 'Un periodo dell\'anno', text: 'Ciò che spinge di solito un prospect a decidersi è un particolare periodo dell\'anno.' },
      { label: 'Fine contratto concorrente', text: 'Ciò che spinge di solito un prospect a decidersi è la fine di un contratto con un concorrente.' },
      { label: 'Difficile a dirsi', text: 'È difficile a dirsi, varia molto da prospect a prospect.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Anni di esperienza', text: 'Ho diversi anni di esperienza in questo settore.' },
      { label: 'Certificazioni / marchi', text: 'Ho certificazioni o marchi riconosciuti nel mio settore.' },
      { label: 'Numero di clienti/progetti', text: 'Ho già realizzato numerosi clienti/progetti in questo settore.' },
      { label: 'Referenze importanti', text: 'Ho referenze importanti che posso citare.' },
      { label: 'Nulla di preciso per ora', text: 'Al momento non ho nulla di preciso da mettere in evidenza.' },
    ],
  },
  es: {
    'chat.onboardingQ1': [
      { label: 'Construcción / Artesanía', text: 'Trabajo principalmente en el sector de la construcción y la artesanía.' },
      { label: 'Servicios a empresas', text: 'Trabajo en servicios a empresas (B2B).' },
      { label: 'Comercio / Distribución', text: 'Trabajo en el comercio y la distribución.' },
      { label: 'Tecnología / Software', text: 'Trabajo en tecnología, en soluciones de software (SaaS).' },
      { label: 'Salud / Bienestar', text: 'Trabajo en el sector de la salud y el bienestar.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Microempresas', text: 'Mis clientes suelen ser microempresas.' },
      { label: 'Pymes', text: 'Mis clientes suelen ser pymes.' },
      { label: 'Grandes empresas', text: 'Mis clientes suelen ser grandes empresas o grupos.' },
      { label: 'Particulares', text: 'Trabajo sobre todo con particulares, no con empresas.' },
      { label: 'Todos los tamaños', text: 'Trabajo con empresas de todos los tamaños.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Un solo perfil homogéneo', text: 'Tengo un único tipo de cliente, bastante homogéneo.' },
      { label: 'Varios perfiles distintos', text: 'Tengo varios perfiles de clientes bien diferenciados.' },
      { label: 'Depende de la oferta', text: 'Depende de la oferta o de la época del año.' },
    ],
    'chat.onboardingQ3': [
      { label: 'Con prisa', text: 'Mis clientes suelen tener prisa, quieren ir directos al grano.' },
      { label: 'Desconfiados', text: 'Mis clientes son bastante desconfiados en el primer contacto.' },
      { label: 'Habladores', text: 'A mis clientes les gusta charlar, son bastante habladores.' },
      { label: 'Concretos', text: 'Mis clientes son concretos, quieren cifras y pruebas.' },
      { label: 'Exigentes', text: 'Mis clientes son exigentes con la calidad.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Un producto', text: 'Mi producto estrella es: ' },
      { label: 'Un servicio', text: 'Mi servicio estrella es: ' },
      { label: 'Una suscripción (SaaS)', text: 'Mi oferta estrella es una suscripción (SaaS): ' },
      { label: 'Un servicio a medida', text: 'Mi oferta estrella es un servicio a medida: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Relación calidad-precio', text: 'El argumento que más funciona es la relación calidad-precio.' },
      { label: 'Ahorro de tiempo', text: 'El argumento que más funciona es el tiempo que ahorro.' },
      { label: 'Calidad / experiencia', text: 'El argumento que más funciona es la calidad del trabajo y mi experiencia.' },
      { label: 'Rapidez / cercanía', text: 'El argumento que más funciona es mi rapidez y cercanía con el cliente.' },
    ],
    'chat.onboardingQ6': [
      { label: 'El precio', text: 'La objeción más frecuente es el precio.' },
      { label: 'La falta de tiempo', text: 'La objeción más frecuente es la falta de tiempo del prospecto.' },
      { label: 'La confianza', text: 'La objeción más frecuente es la confianza hacia un nuevo proveedor.' },
      { label: 'Ya tienen proveedor', text: 'La objeción más frecuente es que ya trabajan con otra persona.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Conseguir una cita', text: 'Lo ideal, tras un primer contacto, es conseguir una cita.' },
      { label: 'Enviar un presupuesto', text: 'Lo ideal, tras un primer contacto, es enviar un presupuesto.' },
      { label: 'Ofrecer una prueba gratuita', text: 'Lo ideal, tras un primer contacto, es ofrecer una prueba gratuita.' },
      { label: 'Enviar documentación', text: 'Lo ideal, tras un primer contacto, es enviar documentación.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Experiencia / know-how', text: 'Lo que me diferencia es mi experiencia y know-how.' },
      { label: 'Rapidez de respuesta', text: 'Lo que me diferencia es mi rapidez de respuesta.' },
      { label: 'Posicionamiento de precio', text: 'Lo que me diferencia es mi posicionamiento de precio.' },
      { label: 'Acompañamiento / seguimiento', text: 'Lo que me diferencia es el acompañamiento y seguimiento que ofrezco.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Sí, con cifras', text: 'Sí, tengo un ejemplo concreto con un resultado medible: ' },
      { label: 'Sí, sin cifras exactas', text: 'Sí, tengo un ejemplo concreto, sin cifras exactas: ' },
      { label: 'Sin ejemplo por ahora', text: 'Por ahora no tengo un ejemplo concreto que dar.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Un evento concreto', text: 'Lo que suele empujar a un prospecto a decidirse es un evento concreto (mudanza, contratación, avería...).' },
      { label: 'Una época del año', text: 'Lo que suele empujar a un prospecto a decidirse es una época concreta del año.' },
      { label: 'Fin de contrato con la competencia', text: 'Lo que suele empujar a un prospecto a decidirse es el fin de un contrato con la competencia.' },
      { label: 'Difícil de decir', text: 'Es difícil de decir, varía mucho según el prospecto.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Años de experiencia', text: 'Tengo varios años de experiencia en este campo.' },
      { label: 'Certificaciones / sellos', text: 'Tengo certificaciones o sellos reconocidos en mi sector.' },
      { label: 'Número de clientes/proyectos', text: 'Ya he realizado numerosos clientes/proyectos en este campo.' },
      { label: 'Referencias destacadas', text: 'Tengo referencias destacadas que puedo citar.' },
      { label: 'Nada concreto por ahora', text: 'Por ahora no tengo nada concreto que destacar.' },
    ],
  },
  pt: {
    'chat.onboardingQ1': [
      { label: 'Construção / Artesanato', text: 'Trabalho principalmente no setor da construção e do artesanato.' },
      { label: 'Serviços às empresas', text: 'Trabalho nos serviços às empresas (B2B).' },
      { label: 'Comércio / Distribuição', text: 'Trabalho no comércio e na distribuição.' },
      { label: 'Tecnologia / Software', text: 'Trabalho na área tech, em soluções de software (SaaS).' },
      { label: 'Saúde / Bem-estar', text: 'Trabalho no setor da saúde e do bem-estar.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Micro empresas', text: 'Os meus clientes são geralmente micro empresas.' },
      { label: 'PME', text: 'Os meus clientes são geralmente PME.' },
      { label: 'Grandes empresas', text: 'Os meus clientes são geralmente grandes empresas ou grupos.' },
      { label: 'Particulares', text: 'Trabalho sobretudo com particulares, não com empresas.' },
      { label: 'Todos os tamanhos', text: 'Trabalho com empresas de todos os tamanhos.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Um único perfil homogéneo', text: 'Tenho um único tipo de cliente, bastante homogéneo.' },
      { label: 'Vários perfis distintos', text: 'Tenho vários perfis de clientes bem distintos.' },
      { label: 'Depende das ofertas', text: 'Depende das ofertas ou da época do ano.' },
    ],
    'chat.onboardingQ3': [
      { label: 'Apressados', text: 'Os meus clientes costumam estar com pressa, querem ir direto ao ponto.' },
      { label: 'Desconfiados', text: 'Os meus clientes são bastante desconfiados no primeiro contacto.' },
      { label: 'Conversadores', text: 'Os meus clientes gostam de conversar, são bastante faladores.' },
      { label: 'Objetivos', text: 'Os meus clientes são objetivos, querem números e provas.' },
      { label: 'Exigentes', text: 'Os meus clientes são exigentes quanto à qualidade.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Um produto', text: 'O meu produto principal é: ' },
      { label: 'Um serviço', text: 'O meu serviço principal é: ' },
      { label: 'Uma assinatura (SaaS)', text: 'A minha oferta principal é uma assinatura (SaaS): ' },
      { label: 'Uma prestação personalizada', text: 'A minha oferta principal é uma prestação personalizada: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Relação qualidade-preço', text: 'O argumento que mais convence é a relação qualidade-preço.' },
      { label: 'Poupança de tempo', text: 'O argumento que mais convence é o tempo que faço poupar.' },
      { label: 'Qualidade / know-how', text: 'O argumento que mais convence é a qualidade do trabalho e o meu know-how.' },
      { label: 'Rapidez / proximidade', text: 'O argumento que mais convence é a minha rapidez e proximidade com o cliente.' },
    ],
    'chat.onboardingQ6': [
      { label: 'O preço', text: 'A objeção mais frequente é o preço.' },
      { label: 'A falta de tempo', text: 'A objeção mais frequente é a falta de tempo do prospect.' },
      { label: 'A confiança', text: 'A objeção mais frequente é a confiança num novo prestador.' },
      { label: 'Já têm prestador', text: 'A objeção mais frequente é já trabalharem com outra pessoa.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Marcar uma reunião', text: 'O ideal, após um primeiro contacto, é marcar uma reunião.' },
      { label: 'Enviar um orçamento', text: 'O ideal, após um primeiro contacto, é enviar um orçamento.' },
      { label: 'Propor um teste gratuito', text: 'O ideal, após um primeiro contacto, é propor um teste gratuito.' },
      { label: 'Enviar documentação', text: 'O ideal, após um primeiro contacto, é enviar documentação.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Know-how / experiência', text: 'O que me diferencia é o meu know-how e a minha experiência.' },
      { label: 'Rapidez de resposta', text: 'O que me diferencia é a minha rapidez de resposta.' },
      { label: 'Posicionamento de preço', text: 'O que me diferencia é o meu posicionamento de preço.' },
      { label: 'Acompanhamento / seguimento', text: 'O que me diferencia é o acompanhamento e seguimento que ofereço.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Sim, com números', text: 'Sim, tenho um exemplo concreto com um resultado mensurável: ' },
      { label: 'Sim, sem números exatos', text: 'Sim, tenho um exemplo concreto, sem números exatos: ' },
      { label: 'Sem exemplo por agora', text: 'Por agora não tenho um exemplo concreto para dar.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Um evento específico', text: 'O que geralmente leva um prospect a decidir-se é um evento específico (mudança, contratação, avaria...).' },
      { label: 'Uma época do ano', text: 'O que geralmente leva um prospect a decidir-se é uma época específica do ano.' },
      { label: 'Fim de contrato com concorrente', text: 'O que geralmente leva um prospect a decidir-se é o fim de um contrato com um concorrente.' },
      { label: 'Difícil de dizer', text: 'É difícil de dizer, varia muito de prospect para prospect.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Anos de experiência', text: 'Tenho vários anos de experiência nesta área.' },
      { label: 'Certificações / selos', text: 'Tenho certificações ou selos reconhecidos no meu setor.' },
      { label: 'Número de clientes/projetos', text: 'Já realizei numerosos clientes/projetos nesta área.' },
      { label: 'Referências notáveis', text: 'Tenho referências notáveis que posso citar.' },
      { label: 'Nada de concreto por agora', text: 'Por agora não tenho nada de concreto para destacar.' },
    ],
  },
  nl: {
    'chat.onboardingQ1': [
      { label: 'Bouw / Ambacht', text: 'Ik werk vooral in de bouw en het ambacht.' },
      { label: 'Zakelijke dienstverlening', text: 'Ik werk in de zakelijke dienstverlening (B2B).' },
      { label: 'Handel / Distributie', text: 'Ik werk in de handel en distributie.' },
      { label: 'Tech / Software', text: 'Ik werk in de tech, aan softwareoplossingen (SaaS).' },
      { label: 'Gezondheid / Welzijn', text: 'Ik werk in de gezondheids- en welzijnssector.' },
    ],
    'chat.onboardingQ1b': [
      { label: 'Kleine bedrijven', text: 'Mijn klanten zijn meestal kleine bedrijven.' },
      { label: 'Mkb', text: 'Mijn klanten zijn meestal mkb-bedrijven.' },
      { label: 'Grote ondernemingen', text: 'Mijn klanten zijn meestal grote ondernemingen of concerns.' },
      { label: 'Particulieren', text: 'Ik werk vooral met particulieren, niet met bedrijven.' },
      { label: 'Alle groottes', text: 'Ik werk met bedrijven van alle groottes.' },
    ],
    'chat.onboardingQ2': [
      { label: 'Eén homogeen profiel', text: 'Ik heb één, vrij homogene klantengroep.' },
      { label: 'Meerdere duidelijke profielen', text: 'Ik heb meerdere duidelijk verschillende klantprofielen.' },
      { label: 'Hangt af van het aanbod', text: 'Dat hangt af van het aanbod of de periode.' },
    ],
    'chat.onboardingQ3': [
      { label: 'Gehaast', text: 'Mijn klanten hebben meestal haast, ze willen meteen ter zake komen.' },
      { label: 'Wantrouwig', text: 'Mijn klanten zijn bij het eerste contact vrij wantrouwig.' },
      { label: 'Praatgraag', text: 'Mijn klanten praten graag, ze zijn vrij spraakzaam.' },
      { label: 'Feitelijk', text: 'Mijn klanten zijn feitelijk ingesteld, ze willen cijfers en bewijs.' },
      { label: 'Veeleisend', text: 'Mijn klanten zijn veeleisend op het gebied van kwaliteit.' },
    ],
    'chat.onboardingQ4': [
      { label: 'Een product', text: 'Mijn topproduct is: ' },
      { label: 'Een dienst', text: 'Mijn topdienst is: ' },
      { label: 'Een abonnement (SaaS)', text: 'Mijn topaanbod is een abonnement (SaaS): ' },
      { label: 'Maatwerk', text: 'Mijn topaanbod is een dienst op maat: ' },
    ],
    'chat.onboardingQ5': [
      { label: 'Prijs-kwaliteitverhouding', text: 'Het argument dat het beste werkt, is de prijs-kwaliteitverhouding.' },
      { label: 'Tijdsbesparing', text: 'Het argument dat het beste werkt, is de tijd die ik bespaar.' },
      { label: 'Kwaliteit / vakmanschap', text: 'Het argument dat het beste werkt, is de kwaliteit van het werk en mijn vakmanschap.' },
      { label: 'Reactiesnelheid / nabijheid', text: 'Het argument dat het beste werkt, is mijn reactiesnelheid en nabijheid.' },
    ],
    'chat.onboardingQ6': [
      { label: 'De prijs', text: 'Het meest voorkomende bezwaar is de prijs.' },
      { label: 'Gebrek aan tijd', text: 'Het meest voorkomende bezwaar is het gebrek aan tijd van de prospect.' },
      { label: 'Vertrouwen', text: 'Het meest voorkomende bezwaar is het vertrouwen in een nieuwe leverancier.' },
      { label: 'Al een leverancier', text: 'Het meest voorkomende bezwaar is dat ze al met iemand anders werken.' },
    ],
    'chat.onboardingQ7': [
      { label: 'Een afspraak maken', text: 'Idealiter maak ik na een eerste contact een afspraak.' },
      { label: 'Een offerte sturen', text: 'Idealiter stuur ik na een eerste contact een offerte.' },
      { label: 'Een gratis proefperiode aanbieden', text: 'Idealiter bied ik na een eerste contact een gratis proefperiode aan.' },
      { label: 'Documentatie sturen', text: 'Idealiter stuur ik na een eerste contact documentatie.' },
    ],
    'chat.onboardingQDifferentiation': [
      { label: 'Vakmanschap / expertise', text: 'Wat mij onderscheidt, is mijn vakmanschap en expertise.' },
      { label: 'Reactiesnelheid', text: 'Wat mij onderscheidt, is mijn reactiesnelheid.' },
      { label: 'Prijspositionering', text: 'Wat mij onderscheidt, is mijn prijspositionering.' },
      { label: 'Begeleiding / opvolging', text: 'Wat mij onderscheidt, is de begeleiding en opvolging die ik bied.' },
    ],
    'chat.onboardingQSocialProof': [
      { label: 'Ja, met cijfers', text: 'Ja, ik heb een concreet voorbeeld met een meetbaar resultaat: ' },
      { label: 'Ja, zonder exacte cijfers', text: 'Ja, ik heb een concreet voorbeeld, zonder exacte cijfers: ' },
      { label: 'Nog geen voorbeeld', text: 'Ik heb op dit moment geen concreet voorbeeld te geven.' },
    ],
    'chat.onboardingQTrigger': [
      { label: 'Een specifieke gebeurtenis', text: 'Wat een prospect meestal doet beslissen, is een specifieke gebeurtenis (verhuizing, aanwerving, storing...).' },
      { label: 'Een periode van het jaar', text: 'Wat een prospect meestal doet beslissen, is een bepaalde periode van het jaar.' },
      { label: 'Einde contract concurrent', text: 'Wat een prospect meestal doet beslissen, is het einde van een contract met een concurrent.' },
      { label: 'Moeilijk te zeggen', text: 'Dat is moeilijk te zeggen, dat verschilt sterk per prospect.' },
    ],
    'chat.onboardingQ8': [
      { label: 'Jaren ervaring', text: 'Ik heb meerdere jaren ervaring op dit gebied.' },
      { label: 'Certificeringen / keurmerken', text: 'Ik heb erkende certificeringen of keurmerken in mijn sector.' },
      { label: 'Aantal klanten/projecten', text: 'Ik heb al talrijke klanten/projecten in dit domein gerealiseerd.' },
      { label: 'Opmerkelijke referenties', text: 'Ik heb opmerkelijke referenties die ik kan noemen.' },
      { label: 'Nog niets concreets', text: 'Ik heb op dit moment niets concreets om te benadrukken.' },
    ],
  },
};

// Puces d'une question dans la langue demandée (repli sur le français).
export function suggestionsFor(locale, key) {
  return ONBOARDING_QUESTION_SUGGESTIONS[locale]?.[key] || ONBOARDING_QUESTION_SUGGESTIONS.fr[key] || [];
}
