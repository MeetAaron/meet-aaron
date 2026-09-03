// app/app/chat/page.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, clearExplicitLogin } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from '@/lib/i18n';
import { NavIcon, LockIcon } from '@/components/NavIcon';
import MobileChrome from '@/components/MobileChrome';
import Stories from '@/components/Stories';
import { frenchTypography } from '@/lib/text-typography';
import { buildBusinessProfilePreview } from '@/lib/business-profile-format';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Pré-remplit immédiatement depuis l'URL (déjà présente sur tous les liens de
  // navigation de l'app, voir Shell) pour ne pas attendre la résolution complète
  // (session + /api/auth/link) avant de lancer le chargement des données de la
  // page — gain net sur le temps de chargement perçu à chaque changement de
  // rubrique. La résolution complète continue en tâche de fond juste après,
  // pour rediriger vers /login si la session n'est plus valide et corriger
  // l'identifiant si l'URL était absente/erronée (les appels API restent de
  // toute façon vérifiés côté serveur via le token, quel que soit ce user_id).
  useEffect(() => {
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlUserId) {
      setUserId(urlUserId);
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      const body = await res.json();

      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 404) {
          // Compte Supabase Auth valide (email vérifié) mais aucun profil
          // Meet Aaron encore créé — cas normal d'une inscription abandonnée
          // avant la fin du paiement Stripe (le profil n'est créé qu'au
          // webhook checkout.session.completed, voir
          // app/api/webhooks/stripe/route.ts) ou d'un commercial invité pas
          // encore rejoint (voir app/api/join-company/route.ts). On renvoie
          // vers /onboarding pour reprendre l'inscription plutôt que
          // d'afficher un message d'erreur sans issue ("contactez votre
          // administrateur") à quelqu'un qui n'a simplement pas terminé.
          router.push('/onboarding');
          return;
        }
        // Le client croyait la session valide (getSession() renvoyait
        // quelque chose) mais le serveur la rejette quand même — cas réel
        // remonté par Alex (2026-08-19) : il atterrissait sur une page
        // cassée, sans rien pouvoir faire ni se déconnecter pour se
        // reconnecter. On nettoie la session locale et on renvoie vers
        // /login plutôt que de laisser un message d'erreur sans issue.
        await supabaseBrowser.auth.signOut();
        router.push('/login');
        return;
      }

      setUserId(body.user.id);
      setAuthLoading(false);
    }

    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return { userId, authLoading, authError };
}

// Questions de découverte posées par Aaron une par une lors du premier accueil,
// pour construire un vrai profil commercial "clé en main" plutôt qu'un simple
// pavé de texte libre. Les réponses alimentent /api/business-summary.
const ONBOARDING_QUESTION_KEYS = [
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

function getOnboardingQuestions(locale) {
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
const ONBOARDING_QUESTION_SUGGESTIONS = {
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

// Code langue BCP47 attendu par SpeechSynthesisUtterance.lang — la voix
// utilisée dépend ensuite des voix installées côté navigateur/OS de
// l'utilisateur (hors de notre contrôle), mais indiquer la bonne langue
// aide le navigateur à choisir une voix cohérente quand plusieurs sont
// disponibles.
const SPEECH_LANG_BY_LOCALE = {
  fr: 'fr-FR',
  en: 'en-US',
  de: 'de-DE',
  it: 'it-IT',
  es: 'es-ES',
  pt: 'pt-PT',
  nl: 'nl-NL',
};

// Libellé de séparateur de jour dans le fil (refonte messagerie
// 01/09/2026) : « Aujourd'hui » / « Hier » / date complète, comme Messenger.
function dayLabel(date, locale) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (date.toDateString() === today.toDateString()) return t('chat.dayToday', locale);
  if (date.toDateString() === yesterday.toDateString()) return t('chat.dayYesterday', locale);
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function ChatPage() {
  const [locale] = useLocale();
  const { userId, authLoading, authError } = useAuthedUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [isWelcome, setIsWelcome] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryDone, setSummaryDone] = useState(false);
  // Bug remonté par Alex (27/08/2026) : le bouton "Générer le résumé" se
  // basait sur `isWelcome` seul — donc visible dès la 1ère question (jamais
  // "à la toute fin" comme demandé), ET absent en régénération depuis Mon
  // compte (ce flux ne passe jamais par `isWelcome`, voir restartRequested
  // plus bas). `questionnaireDone` est mis à true UNIQUEMENT quand la
  // dernière question du questionnaire vient d'être répondue (voir
  // handleSend), pour les deux flux à la fois — donc jamais avant la fin,
  // et toujours visible ensuite quel que soit le flux d'origine.
  const [questionnaireDone, setQuestionnaireDone] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  // Bug remonté par Alex (2026-08-19, nouveau compte) : la page "Chat avec Aaron"
  // restait bloquée sur "Chargement…" indéfiniment. Cause : le message d'accueil
  // (voir l'effet ci-dessous) attendait `userInfo` non-null avant de s'afficher,
  // mais le fetch qui le charge n'avait ni gestion d'erreur ni marqueur "terminé"
  // — au moindre hoquet (réseau, 401 transitoire, etc.) `userInfo` restait `null`
  // pour toujours et l'accueil ne s'affichait jamais. `userInfoLoaded` distingue
  // "chargement en cours" de "chargement terminé, avec ou sans résultat" (même
  // principe que `historyLoaded` juste en dessous, qui lui gérait déjà ce cas).
  const [userInfoLoaded, setUserInfoLoaded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(-1); // -1 = pas en cours de questionnaire
  const [onboardingAnswers, setOnboardingAnswers] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Relance du questionnaire de découverte depuis Préférences (bouton "Relancer
  // le questionnaire de découverte", voir app/app/preferences/page.jsx) — pour
  // quelqu'un qui l'a manqué ou déconnecté en cours de route la première fois.
  // Distinct de isWelcome : ne dépend pas de messages.length === 0, puisqu'une
  // conversation existe déjà dans ce cas (restartSeeded sert de garde-fou
  // "une seule fois" à la place).
  const [restartRequested, setRestartRequested] = useState(false);
  const [restartSeeded, setRestartSeeded] = useState(false);
  // Dépôt de document dans le chat (demande d'Alex, 22/08/2026) : pendingDocument
  // contient les métadonnées du document déjà uploadé (voir
  // app/api/chat/document/route.ts) mais pas encore sauvegardé dans "Mes
  // documents" — renvoyé à chaque appel /api/chat tant qu'il reste "joint",
  // pour qu'Aaron continue d'avoir accès à son contenu sur plusieurs tours
  // (ex: le temps qu'il demande confirmation de sauvegarde). Il disparaît
  // uniquement quand Aaron l'a sauvegardé (data.document_saved, voir
  // handleSend) ou quand le commercial le retire lui-même via le ✕ du chip.
  //
  // Bug remonté par Alex (29/08/2026) : une fois le document envoyé dans un
  // message (visible dans la bulle, voir bubble-attachment plus bas), le chip
  // flottant au-dessus du champ de saisie restait affiché tel quel — donnant
  // l'impression que le document n'avait pas été envoyé (comme sur
  // Claude.ai/ChatGPT, où le fichier "part" dans la conversation et
  // disparaît de la zone de saisie). `pendingDocumentAlreadyInChat` (calculé
  // plus bas, avant le rendu) détecte que ce document apparaît déjà dans un
  // message envoyé et cache alors le chip flottant — le document continue
  // néanmoins d'être transmis à Aaron en arrière-plan tant qu'il n'est pas
  // sauvegardé/retiré, seul l'affichage change.
  const [pendingDocument, setPendingDocument] = useState(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [attachError, setAttachError] = useState(null);
  // Demande Alex (29/08/2026) : une fois qu'Aaron a posé (une fois) la
  // question "tu veux que je sauvegarde ce document ?", on affiche 2 boutons
  // de réponse rapide (Oui/Non) sous SA réponse plutôt que de forcer le
  // commercial à taper "oui"/"non" — voir le bloc offerSaveDocument dans
  // handleSend. Remis à false à chaque nouveau document joint (voir
  // handleFileSelected) pour pouvoir reproposer les boutons sur le suivant.
  const [docSaveAsked, setDocSaveAsked] = useState(false);
  // Filet de sécurité sur l'appel /api/chat (l'appel principal, hors
  // questionnaire de découverte) : avant, aucun try/catch ici — une erreur
  // réseau ou un 500 sans JSON valide faisait planter handleSend en plein
  // vol, "sending" restait bloqué à true (input verrouillé indéfiniment) et
  // rien n'informait le commercial. Voir aussi chat.sendError (lib/i18n.js).
  const [sendError, setSendError] = useState(null);
  // Conversations multiples (demande d'Alex, 25/08/2026) : "possibilité
  // d'ouvrir une nouvelle conversation" + "possibilité de mettre une conv en
  // favoris" — voir migration_chat_conversations_2026-08-25.sql. Conservation
  // illimitée (comme Claude/ChatGPT) : `conversations` peut contenir plus de
  // 10 entrées, rien n'est supprimé automatiquement. `activeConversationId`
  // est celle actuellement affichée dans la boîte de chat.
  const [conversations, setConversations] = useState([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [conversationsError, setConversationsError] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [creatingConversation, setCreatingConversation] = useState(false);
  // Tiroir « mes conversations » (refonte messagerie 01/09/2026).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const prefillAppliedRef = useRef(false);
  // docx "CHAT AVEC AARON" item A1 : le texte en cours de rédaction (non
  // envoyé) doit survivre à un aller-retour sur une autre page — comme un
  // brouillon WhatsApp. La page se démonte complètement en changeant de
  // rubrique (ce n'est pas un problème d'auth/historique comme pour les
  // messages déjà envoyés, voir /api/chat-history plus haut), donc un state
  // React seul ne suffit pas : on persiste dans localStorage, scopé par
  // utilisateur pour ne pas mélanger les brouillons entre commerciaux d'une
  // même entreprise partageant le même navigateur.
  const draftStorageKey = userId ? `meetaaron_chat_draft_${userId}` : null;
  // Bug remonté par Alex (26/08/2026) : un document joint mais pas encore
  // confirmé/sauvegardé (pendingDocument) disparaissait dès qu'on quittait la
  // page (changement de rubrique) et qu'on y revenait — c'est un state React
  // pur, qui repart à `null` à chaque montage du composant, exactement comme
  // le brouillon ci-dessus avant son propre correctif. Le fichier reste bien
  // dans Storage entre-temps (voir app/api/chat/document/route.ts) : seule la
  // référence en mémoire était perdue. Même traitement que draftStorageKey.
  const pendingDocStorageKey = userId ? `meetaaron_chat_pending_doc_${userId}` : null;

  // Lu directement depuis window.location (plutôt que useSearchParams) pour éviter
  // d'avoir à englober la page dans un <Suspense> côté build Next.js.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setIsWelcome(true);
    }
    if (params.get('restart_questionnaire') === '1') {
      setRestartRequested(true);
    }
    // Tâche "Mon compte" (2026-08-22) : la carte "Ton CRM n'est pas dans la
    // liste ?" (app/app/connexions/page.jsx) amène ici avec un message
    // pré-rempli plutôt que d'ouvrir une conversation vide — le commercial
    // reste libre de le modifier avant de l'envoyer. On ne fait que
    // PRÉ-REMPLIR la zone de saisie, jamais d'envoi automatique. Priorité sur
    // un éventuel brouillon déjà sauvegardé (voir draftRestoredRef plus bas) :
    // un lien de préremplissage est une intention explicite et fraîche.
    const prefill = params.get('prefill');
    if (prefill) {
      setInput(prefill);
      prefillAppliedRef.current = true;
    }
  }, []);

  // Charge les infos de l'utilisateur (dont son prénom) pour qu'Aaron l'utilise
  // dans son message d'accueil et tout au long de la conversation.
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.user) setUserInfo(res.user);
      })
      .catch(() => {})
      .finally(() => setUserInfoLoaded(true));
  }, [userId]);

  // Item 6 (docx Modifs Aaron 30/08/2026) : "lorsque le commercial se connecte
  // via un code envoyé par le fondateur, Aaron ajoute automatiquement le
  // profil entreprise — pas besoin pour le salarié de recréer la fiche".
  // Le profil vit déjà sur la société (companies.business_summary, partagé
  // par tous les comptes de la même société) ; il restait à ne PAS relancer
  // le questionnaire à l'arrivée d'un commercial dont la société a déjà son
  // profil (sinon ses réponses auraient écrasé celui du fondateur). Chargé
  // uniquement sur l'accueil (?welcome=1), seul endroit où ça se décide.
  const [companyProfileExists, setCompanyProfileExists] = useState(null); // null = pas encore su
  useEffect(() => {
    if (!userId || !isWelcome) return;
    fetch(`/api/business-summary?user_id=${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setCompanyProfileExists(!!res?.summary))
      .catch(() => setCompanyProfileExists(false));
  }, [userId, isWelcome]);

  // Item 11 (docx Modifs Aaron 30/08/2026) : "au bout de 24 h la conversation
  // est classée en historique — mais pas 24 h après le DÉBUT : imagine
  // l'utilisateur qui utilise le chat pendant 2 h et hop, classé." La règle
  // est donc l'INACTIVITÉ : 24 h sans aucun message (updated_at de la
  // conversation, remis à jour à chaque message par /api/chat-history et
  // /api/chat). Au-delà, une nouvelle conversation démarre automatiquement
  // et l'ancienne reste dans la liste (rien n'est supprimé). Exceptions :
  // conversation encore vide (on la réutilise), questionnaire de profil en
  // cours (on ne coupe pas le fil des questions), et réouverture manuelle
  // d'une ancienne conversation (voir inactivityCheckPendingRef).
  const CONVERSATION_INACTIVITY_MS = 24 * 60 * 60 * 1000;
  const inactivityCheckPendingRef = useRef(false);
  async function rotateInactiveConversation() {
    const res = await fetch('/api/chat-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!body?.conversation) return false;
    setConversations((prev) => [body.conversation, ...prev]);
    setActiveConversationId(body.conversation.id);
    try {
      window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, body.conversation.id);
    } catch {
      // Voir draftStorageKey plus haut.
    }
    return true;
  }

  // Résout la conversation à afficher (voir migration_chat_conversations_2026-08-25.sql) :
  // reprend la dernière conversation ouverte par ce commercial sur cet appareil
  // (localStorage, même principe que draftStorageKey plus haut), sinon la plus
  // récente renvoyée par l'API, sinon en crée une nouvelle si aucune n'existe
  // encore (tout premier message d'un commercial).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const activeKey = `meetaaron_chat_active_conversation_${userId}`;

    fetch(`/api/chat-conversations?user_id=${userId}`)
      .then((r) => r.json())
      .then(async (res) => {
        if (cancelled) return;
        if (!Array.isArray(res.conversations)) {
          setConversationsError(true);
          return;
        }
        let list = res.conversations;
        setConversations(list);

        let savedId = null;
        try {
          savedId = window.localStorage.getItem(activeKey);
        } catch {
          // localStorage indisponible — voir draftStorageKey plus haut, même dégradation silencieuse.
        }
        let chosen = list.find((c) => c.id === savedId) || list[0] || null;

        if (!chosen) {
          // Tout premier passage de ce commercial : pas encore de conversation en base.
          const createRes = await fetch('/api/chat-conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
          }).catch(() => null);
          const createBody = createRes ? await createRes.json().catch(() => null) : null;
          if (createBody?.conversation) {
            chosen = createBody.conversation;
            setConversations([chosen]);
          }
        }

        if (chosen) {
          // Item 11 (docx 30/08) : la vérification "24 h sans échange" ne se
          // fait qu'à l'arrivée sur la page, jamais quand le commercial
          // rouvre lui-même une vieille conversation depuis la liste.
          inactivityCheckPendingRef.current = true;
          setActiveConversationId(chosen.id);
          try {
            window.localStorage.setItem(activeKey, chosen.id);
          } catch {
            // Voir plus haut.
          }
        }
      })
      .catch(() => setConversationsError(true))
      .finally(() => !cancelled && setConversationsLoaded(true));

    return () => { cancelled = true; };
  }, [userId]);


  // Rapatrie l'historique déjà persisté (voir migration_chat_history_2026-08-13.sql
  // et app/api/chat-history/route.ts) avant toute décision d'afficher l'accueil —
  // sans ça, revenir sur cette page après être parti ailleurs (ex: "Mes documents")
  // en plein questionnaire d'onboarding faisait tout recommencer à zéro. Se
  // redéclenche à chaque changement de conversation active (nouvelle
  // conversation créée, ou changement manuel depuis la liste ci-dessous).
  useEffect(() => {
    if (!userId || !activeConversationId) return;
    setHistoryLoaded(false);
    setMessages([]);
    let rotated = false;
    fetch(`/api/chat-history?user_id=${userId}&conversation_id=${activeConversationId}`)
      .then((r) => r.json())
      .then(async (res) => {
        const hasMessages = Array.isArray(res.messages) && res.messages.length > 0;
        const step = typeof res.onboarding_step === 'number' ? res.onboarding_step : -1;
        if (inactivityCheckPendingRef.current) {
          inactivityCheckPendingRef.current = false;
          const conv = conversations.find((c) => c.id === activeConversationId);
          const lastActivity = conv?.updated_at ? new Date(conv.updated_at).getTime() : Date.now();
          const inactiveForTooLong = Date.now() - lastActivity > CONVERSATION_INACTIVITY_MS;
          if (hasMessages && inactiveForTooLong && step < 0 && !isWelcome && !restartRequested) {
            rotated = await rotateInactiveConversation();
            if (rotated) return; // l'effet se relance sur la nouvelle conversation (vide)
          }
        }
        if (hasMessages) {
          setMessages(res.messages);
          setOnboardingStep(step);
          setOnboardingAnswers(Array.isArray(res.onboarding_answers) ? res.onboarding_answers : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!rotated) setHistoryLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, activeConversationId]);

  // Bug remonté par Alex (29/08/2026, "il va falloir que moi et Ludovic on
  // répondent encore une fois au questionnaire ?") : questionnaireDone (voir
  // plus haut) n'était mis à true QUE juste après avoir répondu à la
  // dernière question EN DIRECT (handleSend) — jamais recalculé depuis
  // l'historique déjà persisté en base (onboarding_step/onboarding_answers,
  // hydratés par l'effet juste au-dessus). Un commercial ayant déjà terminé
  // le questionnaire lors d'une session précédente ne revoyait donc JAMAIS
  // le bouton "Générer le profil de l'entreprise" en revenant sur cette page
  // plus tard — comme si le questionnaire n'avait jamais été fait, alors que
  // ses réponses étaient bien là. onboarding_step === -1 ET au moins une
  // réponse enregistrée = questionnaire déjà terminé (onboarding_step vaut
  // aussi -1 avant le tout premier démarrage, d'où le ET sur les réponses
  // pour ne pas confondre "jamais commencé" et "déjà fini"). Sans incidence
  // sur "Reprendre le questionnaire" (repart avec onboarding_answers vide,
  // donc cette condition ne redevient vraie qu'une fois réellement refini).
  useEffect(() => {
    if (onboardingStep === -1 && onboardingAnswers.length > 0) {
      setQuestionnaireDone(true);
    }
  }, [onboardingStep, onboardingAnswers]);

  useEffect(() => {
    if (!isWelcome || messages.length > 0) return;
    // On attend que le chargement du prénom soit TERMINÉ (succès ou échec, voir
    // userInfoLoaded ci-dessus) pour un accueil personnalisé quand c'est possible
    // — mais sans bloquer indéfiniment si ce fetch échoue.
    if (!userInfoLoaded) return;
    // On attend de savoir si un historique existe déjà en base avant de semer
    // l'accueil, pour ne pas écraser une conversation/un questionnaire en cours.
    if (!historyLoaded) return;
    // Item 6 : on attend de savoir si la société a déjà son profil.
    if (companyProfileExists === null) return;
    const firstName = userInfo ? (userInfo.first_name || (userInfo.full_name || '').split(' ')[0] || '') : '';
    const onboardingQuestions = getOnboardingQuestions(locale);
    const intro =
      `${t('chat.welcomeGreeting', locale).replace('{firstName}', firstName ? ' ' + firstName : '')}\n\n` +
      `• ${t('chat.welcomeBullet1', locale)}\n` +
      `• ${t('chat.welcomeBullet2', locale)}\n` +
      `• ${t('chat.welcomeBullet3', locale)}\n\n` +
      `${t('chat.welcomeNotDoing', locale)}\n\n`;

    if (companyProfileExists) {
      // Commercial qui rejoint une société déjà profilée (item 6) : pas de
      // questionnaire, le profil de l'équipe s'applique à lui.
      const welcomeMessages = [{ role: 'assistant', content: intro + t('chat.welcomeProfileAlreadyDone', locale) }];
      setMessages(welcomeMessages);
      setOnboardingStep(-1);
      setSummaryDone(true);
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          messages: welcomeMessages,
          onboarding_step: -1,
          onboarding_answers: [],
        }),
      }).catch(() => {});
      return;
    }

    const welcomeMessages = [
      { role: 'assistant', content: intro + t('chat.welcomeBeforeStart', locale) },
      {
        role: 'assistant',
        content: onboardingQuestions[0],
      },
    ];
    setMessages(welcomeMessages);
    setOnboardingStep(0);

    // Persiste tout de suite l'accueil + le démarrage du questionnaire : si la
    // page est quittée avant même la première réponse, on ne repart plus de zéro.
    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        conversation_id: activeConversationId,
        messages: welcomeMessages,
        onboarding_step: 0,
        onboarding_answers: [],
      }),
    }).catch(() => {});
  }, [isWelcome, messages.length, userInfo, userInfoLoaded, historyLoaded, userId, locale, activeConversationId, companyProfileExists]);

  // Relance du questionnaire (voir restartRequested plus haut) : ajoute une
  // courte intro + la première question à la suite de la conversation
  // existante (n'écrase rien — /api/chat-history insère, ne remplace jamais),
  // et repart de zéro sur la progression (étape 0, réponses vidées) pour que
  // /api/business-summary régénère un résumé propre à la fin.
  useEffect(() => {
    if (!restartRequested || restartSeeded) return;
    // Voir userInfoLoaded plus haut : on attend la FIN du chargement (pas un
    // résultat non-nul) pour ne jamais bloquer indéfiniment.
    if (!userInfoLoaded) return;
    if (!historyLoaded) return;
    // Item 13 (31/08/2026) : le tableau de bord renvoie ici chaque jour tant
    // que le profil n'est pas généré — si un questionnaire est DÉJÀ en cours
    // (étape >= 0), on le reprend là où il en était au lieu de l'effacer et
    // de tout recommencer.
    if (onboardingStep >= 0) {
      setRestartSeeded(true);
      return;
    }

    // CORRECTION 04/09/2026 (Alex : « gros problème, ça me repose le
    // questionnaire […] ce questionnaire doit être mis qu'une seule fois lors
    // de la création du compte »).
    //
    // Avant : arriver ici avec ?restart_questionnaire=1 RELANÇAIT le
    // questionnaire d'autorité — onboarding_step remis à 0 et
    // onboarding_answers VIDÉES. Or le tableau de bord pointe ce lien tant
    // que le profil d'entreprise n'est pas généré : un commercial dont le
    // profil manquait (ou avait été perdu, cf. le bug du 03/09) se voyait
    // donc reposer les 11 questions à chaque passage, en perdant à chaque
    // fois les réponses déjà données. C'est exactement ce qu'Alex a vécu.
    //
    // Désormais Aaron PROPOSE, il n'impose pas : un seul message avec deux
    // boutons. Tant que le commercial n'a pas cliqué « oui », rien n'est
    // touché — ni l'étape, ni les réponses, ni le profil. Le questionnaire
    // ne démarre donc plus jamais tout seul en dehors de la toute première
    // conversation d'un nouveau compte (voir l'effet `isWelcome` plus haut,
    // qui reste le SEUL démarrage automatique).
    //
    // Ce message d'offre n'est volontairement PAS persisté : il n'appartient
    // pas à la conversation, c'est une invite contextuelle. S'il est ignoré,
    // il ne laisse aucune trace dans l'historique.
    setMessages((prev) => [...prev, { role: 'assistant', content: t('chat.restartOfferTitle', locale), offerRestartQuestionnaire: true }]);
    setRestartSeeded(true);
  }, [restartRequested, restartSeeded, userInfoLoaded, historyLoaded, userId, locale, activeConversationId, onboardingStep]);

  // Démarrage EXPLICITE du questionnaire, déclenché seulement par le bouton
  // « Oui, on le refait » sous le message d'offre ci-dessus.
  function startQuestionnaireNow() {
    const onboardingQuestions = getOnboardingQuestions(locale);
    const restartMessages = [
      { role: 'assistant', content: t('chat.restartQuestionnaireIntro', locale) },
      { role: 'assistant', content: onboardingQuestions[0] },
    ];
    // Retire l'invite (non persistée) avant d'ajouter le vrai démarrage.
    setMessages((prev) => [...prev.filter((m) => !m.offerRestartQuestionnaire), ...restartMessages]);
    setOnboardingStep(0);
    setOnboardingAnswers([]);
    setSummaryDone(false);
    setQuestionnaireDone(false);

    fetch('/api/chat-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        conversation_id: activeConversationId,
        messages: restartMessages,
        onboarding_step: 0,
        onboarding_answers: [],
      }),
    }).catch(() => {});
  }

  // Refus : on retire l'invite et on répond une ligne, sans rien persister ni
  // modifier. Le commercial retrouve sa conversation exactement comme avant.
  function declineQuestionnaireRestart() {
    setMessages((prev) => [
      ...prev.filter((m) => !m.offerRestartQuestionnaire),
      { role: 'assistant', content: t('chat.restartDeclinedMessage', locale) },
    ]);
  }

  // docx item A3 : scroller uniquement la liste de messages elle-même (pas
  // toute la page) à chaque nouveau message. `scrollIntoView` sans option
  // `block: 'nearest'` peut aussi faire défiler des ancêtres qui montrent
  // déjà l'élément (ex: la page entière si le fil dépasse la fenêtre),
  // ce qui produisait le "la page descend toute seule" remonté par Alex — on
  // manipule directement `scrollTop` du conteneur scrollable pour rester
  // strictement local à la boîte de chat.
  //
  // Item 14 (docx Modifs Aaron 30/08/2026) : "parfois Aaron écrit 2 messages
  // à la suite — dans ce cas, ancrer la première ligne du premier message,
  // car là ça descend tout en bas et on ne comprend pas". Quand ce sont des
  // messages d'Aaron qui arrivent, on cale donc le haut de la boîte sur le
  // DÉBUT du premier nouveau message (le commercial lit de haut en bas,
  // comme sur ChatGPT) ; quand c'est le commercial qui vient d'envoyer, ou
  // pendant qu'Aaron "écrit", on reste tout en bas comme avant.
  const previousMessageCountRef = useRef(0);
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    const appended = messages.length - previousCount;
    if (!sending && appended > 0 && previousCount > 0 && messages[messages.length - 1]?.role === 'assistant') {
      let first = messages.length - 1;
      while (first - 1 >= previousCount && messages[first - 1]?.role === 'assistant') first -= 1;
      const rows = el.querySelectorAll('.msg-row');
      const target = rows[first];
      if (target) {
        el.scrollTop = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 6;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // docx item A1 : restaure le brouillon non envoyé dès que l'utilisateur est
  // connu (une seule fois — on ne veut pas écraser ce que l'utilisateur est
  // déjà en train de retaper si l'effet se redéclenchait).
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (!draftStorageKey || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    // Un lien "?prefill=..." (voir plus haut) vient déjà de remplir la zone
    // de saisie avec une intention fraîche et explicite — on ne l'écrase pas
    // avec un vieux brouillon resté en localStorage.
    if (prefillAppliedRef.current) return;
    try {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (saved) setInput(saved);
    } catch {
      // localStorage indisponible (navigation privée stricte, etc.) — le
      // brouillon ne survivra simplement pas à un changement de page, sans
      // bloquer le reste de la fonctionnalité.
    }
  }, [draftStorageKey]);

  // Sauvegarde le brouillon à chaque frappe, pour qu'il survienne un aller-
  // retour vers une autre rubrique (la page se démonte entièrement).
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      if (input) {
        window.localStorage.setItem(draftStorageKey, input);
      } else {
        window.localStorage.removeItem(draftStorageKey);
      }
    } catch {
      // Voir plus haut.
    }
  }, [draftStorageKey, input]);

  // Restaure le document en attente (pas encore sauvegardé) dès que
  // l'utilisateur est connu — même principe que le brouillon ci-dessus, une
  // seule fois pour ne pas écraser un nouvel upload en cours.
  //
  // Bug trouvé le 27/08/2026 (Alex : le document "perd son contexte actif"
  // en pleine conversation, sans même changer de page) : cet effet de
  // restauration et celui de sauvegarde ci-dessous s'exécutaient tous les
  // deux au montage, DANS LE MÊME lot d'effets. `setPendingDocument(doc)`
  // ici ne met pas à jour la variable `pendingDocument` capturée par la
  // closure de l'effet de sauvegarde suivant (le re-render n'a pas encore eu
  // lieu) — cet effet de sauvegarde voyait donc encore `pendingDocument ===
  // null` et appelait `localStorage.removeItem(...)`, effaçant SILENCIEUSEMENT
  // la valeur que cet effet-ci venait tout juste de lire. Le document restait
  // affiché (state React déjà mis à jour) mais sa sauvegarde localStorage
  // avait disparu : le prochain démontage du composant (nouvel onglet du
  // chat, changement de conversation, etc.) le perdait pour de bon, avant
  // même que l'outil sauvegarder_document n'ait pu agir. `pendingDocRestored`
  // (state, pas juste une ref) bloque l'effet de sauvegarde tant que la
  // restauration n'est pas passée par au moins un rendu.
  const [pendingDocRestored, setPendingDocRestored] = useState(false);
  useEffect(() => {
    if (!pendingDocStorageKey || pendingDocRestored) return;
    try {
      const saved = window.localStorage.getItem(pendingDocStorageKey);
      if (saved) setPendingDocument(JSON.parse(saved));
    } catch {
      // localStorage indisponible ou JSON corrompu — le document restera
      // simplement non restauré, sans bloquer le reste de la page.
    } finally {
      setPendingDocRestored(true);
    }
  }, [pendingDocStorageKey, pendingDocRestored]);

  // Sauvegarde le document en attente à chaque changement, pour qu'il
  // survive un aller-retour vers une autre rubrique. Gated sur
  // `pendingDocRestored` (voir commentaire ci-dessus) : ne s'exécute qu'une
  // fois la restauration effectivement passée par un rendu, jamais avant.
  useEffect(() => {
    if (!pendingDocStorageKey || !pendingDocRestored) return;
    try {
      if (pendingDocument) {
        window.localStorage.setItem(pendingDocStorageKey, JSON.stringify(pendingDocument));
      } else {
        window.localStorage.removeItem(pendingDocStorageKey);
      }
    } catch {
      // Voir plus haut.
    }
  }, [pendingDocStorageKey, pendingDocument, pendingDocRestored]);

  // Le cadre ne s'agrandit "en direct" que via l'onChange du textarea (item
  // A2) — quand `input` change par programme plutôt que par frappe (brouillon
  // restauré au chargement, envoi qui vide le champ), rien ne redéclenche ce
  // handler DOM, donc on resynchronise la hauteur ici à chaque changement de
  // `input`, peu importe la cause.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    if (input) el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Profil d'entreprise enrichi (demande Alex, 29/08/2026) : le document
  // généré par /api/business-summary est désormais structuré en sections
  // (titres "## ", voir lib/business-profile-format.ts) et peut être bien
  // plus long que l'ancien résumé de 5-9 phrases. Alex a explicitement
  // demandé de ne plus le déverser en entier dans la bulle de chat ("ca
  // devait être un résumé style word... on en voit un aperçu de texte") —
  // cette fonction construit un court aperçu en prose (titres retirés, texte
  // tronqué) pour la bulle, le document complet restant consultable via le
  // bouton "Voir le profil de l'entreprise" (Mon compte > Mon entreprise).
  // buildBusinessProfilePreview vit maintenant dans lib/business-profile-format.ts
  // (factorisé le 29/08/2026 pour être réutilisé aussi dans Mon compte > Mon
  // entreprise, voir app/app/connexions/page.jsx) — comportement inchangé.
  const buildSummaryPreview = buildBusinessProfilePreview;

  // Item 12 : tant que le profil se génère, le navigateur demande
  // confirmation avant de fermer/quitter l'onglet (message générique imposé
  // par les navigateurs — impossible de le personnaliser).
  useEffect(() => {
    if (!summarizing) return undefined;
    const guard = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [summarizing]);

  async function handleGenerateSummary() {
    if (summarizing) return;
    setSummarizing(true);

    // Si le questionnaire guidé a été répondu, on envoie les paires question/réponse
    // structurées (bien plus exploitables pour Aaron qu'un pavé de texte libre).
    // Sinon (questionnaire sauté ou messages libres), on retombe sur l'ancien
    // comportement : tous les messages de l'utilisateur concaténés.
    const description = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const res = await fetch('/api/business-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, description, qa: onboardingAnswers }),
    });
    const data = await res.json();
    setSummarizing(false);

    if (!res.ok) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.error || t('chat.summaryErrorFallback', locale) },
      ]);
      return;
    }

    setSummaryDone(true);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          `${t('chat.summaryIntro', locale)}\n\n${buildSummaryPreview(data.summary)}\n\n` +
          t('chat.summaryOutro', locale),
        viewProfileLink: true,
      },
    ]);
  }

  // Upload immédiat dès la sélection du fichier (pas seulement à l'envoi du
  // message) : le commercial voit tout de suite le chip "document joint" et
  // une éventuelle erreur (fichier trop lourd, échec réseau) avant même
  // d'écrire son message.
  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de resélectionner le même fichier plus tard
    if (!file || !userId) return;

    setAttachError(null);
    setUploadingDocument(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);

    try {
      const res = await fetch('/api/chat/document', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        setAttachError(body.error || t('chat.attachError', locale));
        return;
      }
      setPendingDocument(body.document);
      setDocSaveAsked(false); // nouveau document -> on peut reproposer les boutons Oui/Non
    } catch {
      setAttachError(t('chat.attachError', locale));
    } finally {
      setUploadingDocument(false);
    }
  }

  // Demande Alex (29/08/2026) : refactor pour accepter un texte "en dur"
  // (overrideText) en plus du contenu du champ de saisie — utilisé par les
  // boutons de réponse rapide Oui/Non (voir plus bas) qui envoient
  // directement une réponse sans passer par le <textarea>, contrairement aux
  // "chips" de suggestion du questionnaire d'onboarding qui ne font eux que
  // PRÉ-REMPLIR le champ (voir suggestion-chip plus haut, comportement
  // inchangé).
  async function handleSend(e, overrideText) {
    if (e?.preventDefault) e.preventDefault();
    const rawText = overrideText !== undefined ? overrideText : input;
    // Bug remonté par Alex (29/08/2026) : impossible d'envoyer un document
    // seul, sans texte — le bouton "Envoyer" restait grisé et cette garde
    // bloquait l'envoi tant que le champ était vide, même avec un document
    // joint. Un document joint suffit désormais à autoriser l'envoi (voir
    // aussi btn-send plus bas, même condition).
    if ((!rawText.trim() && !pendingDocument) || sending) return;
    setSendError(null);

    // Texte de repli quand on envoie un document seul, sans rien écrire —
    // voir chat.attachOnlyMessage (lib/i18n.js).
    const messageContent = rawText.trim() || t('chat.attachOnlyMessage', locale);

    // UX pièce jointe (demande Alex, 27/08/2026, façon ChatGPT/Claude) : le
    // fichier joint s'affiche désormais comme un repère DANS la bulle de
    // message envoyée, pas seulement comme un chip flottant au-dessus du
    // champ de saisie. Le chip lui-même reste inchangé côté logique (voir
    // pendingDocument plus haut) — il doit continuer à être renvoyé à chaque
    // tour tant que le document n'est pas sauvegardé/retiré, potentiellement
    // sur plusieurs messages d'affilée (le temps qu'Aaron demande
    // confirmation) — seul l'AFFICHAGE de CE message précis change : on note
    // simplement, au moment de l'envoi, quel document était joint à ce
    // tour-ci, pour l'afficher dans sa bulle d'historique.
    const userMessage = {
      role: 'user',
      content: messageContent,
      ...(pendingDocument ? { attachment: { file_name: pendingDocument.file_name } } : {}),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    // Questionnaire de découverte guidé : on avance question par question,
    // en local pour la logique de progression (prévisible, jamais bloquée
    // par un souci réseau/API), mais chaque message est d'abord CLASSÉ par
    // un appel IA léger (/api/chat/onboarding-ack) : est-ce une vraie
    // réponse à la question posée, ou une question/incompréhension de la
    // part du commercial ? Retour Alex (2026-08-25, capture à l'appui) :
    // avant ce correctif, un message comme "c'est à dire ?" était traité
    // comme SI c'était la réponse, et Aaron enchaînait quand même sur la
    // question suivante — un simple formulaire déguisé, pas une vraie
    // interaction. Maintenant : si ce n'est pas une réponse, Aaron clarifie
    // (reply) et REPOSE la même question, sans avancer ni enregistrer quoi
    // que ce soit comme réponse. Best-effort : si l'appel échoue ou que le
    // plafond API est atteint, on retombe sur l'ancien comportement (avance
    // directement, sans accroche) — jamais bloquant pour la progression.
    const onboardingQuestions = getOnboardingQuestions(locale);
    if (onboardingStep >= 0 && onboardingStep < onboardingQuestions.length) {
      const askedQuestion = onboardingQuestions[onboardingStep];
      setSending(true);

      let isAnswer = true;
      let reply = null;
      try {
        const ackRes = await fetch('/api/chat/onboarding-ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // previous_answers (01/09/2026) : sans elles, l'appel ne voyait
          // QUE la question posée et la réponse brute, sans savoir ce que
          // vend la société — Aaron comblait le vide avec un mot plausible
          // mais faux ("cabinet" pour un distributeur de portes de garage,
          // signalé par le père d'Alex). Les réponses déjà données dans ce
          // même questionnaire sont le seul contexte fiable disponible à ce
          // stade (business_summary n'existe pas encore, il est justement
          // généré à la fin) — on les transmet pour qu'Aaron accuse
          // réception dans les mots du commercial, pas dans les siens.
          body: JSON.stringify({
            user_id: userId,
            question: askedQuestion,
            answer: userMessage.content,
            previous_answers: onboardingAnswers,
          }),
        });
        const ackData = await ackRes.json();
        isAnswer = ackData.is_answer !== false;
        reply = ackData.reply || null;
      } catch {
        // Voir commentaire ci-dessus — dégradation silencieuse.
      }

      let assistantMessage;
      let newOnboardingStep;
      let answersToSave = onboardingAnswers;

      if (!isAnswer) {
        // Pas une réponse : on ne fait PAS avancer le questionnaire, et on
        // n'enregistre RIEN comme réponse à la question posée — sinon "c'est
        // à dire ?" se retrouverait enregistré comme réponse au résumé final.
        newOnboardingStep = onboardingStep;
        assistantMessage = { role: 'assistant', content: reply || askedQuestion };
      } else {
        const updatedAnswers = [...onboardingAnswers, { question: askedQuestion, answer: userMessage.content }];
        answersToSave = updatedAnswers;
        setOnboardingAnswers(updatedAnswers);

        const nextStep = onboardingStep + 1;
        if (nextStep < onboardingQuestions.length) {
          newOnboardingStep = nextStep;
          const nextQuestion = onboardingQuestions[nextStep];
          assistantMessage = { role: 'assistant', content: reply ? `${reply}\n\n${nextQuestion}` : nextQuestion };
          setOnboardingStep(nextStep);
        } else {
          newOnboardingStep = -1;
          const completion = t('chat.onboardingCompleteDocs', locale);
          assistantMessage = { role: 'assistant', content: reply ? `${reply}\n\n${completion}` : completion };
          setOnboardingStep(-1);
          // Voir le commentaire sur questionnaireDone plus haut : dernière
          // question tout juste répondue, donc c'est exactement ici (jamais
          // avant) que le bouton "Générer le résumé" doit devenir visible.
          setQuestionnaireDone(true);
        }
      }

      setSending(false);
      setMessages([...newMessages, assistantMessage]);

      // Persiste ce tour de questionnaire (question + réponse, si c'en était
      // vraiment une) et la nouvelle progression, pour ne pas la reperdre si
      // la page est quittée avant la fin.
      fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          messages: [userMessage, assistantMessage],
          onboarding_step: newOnboardingStep,
          onboarding_answers: answersToSave,
        }),
      }).catch(() => {});

      return;
    }

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: activeConversationId,
          message: userMessage.content,
          history: messages,
          attached_document: pendingDocument || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSendError(data.error || t('chat.sendError', locale));
        return;
      }

      // Aaron vient de sauvegarder le document joint (outil sauvegarder_document,
      // voir app/api/chat/route.ts) — le chip disparaît, sa propre réponse texte
      // confirme déjà l'action au commercial.
      if (data.document_saved) setPendingDocument(null);

      // Boutons de réponse rapide Oui/Non (demande Alex, 29/08/2026) : un
      // document reste joint et Aaron ne vient pas de le sauvegarder dans CE
      // tour -> c'est très probablement le tour où il pose sa question "tu
      // veux que je le sauvegarde ?" (il ne la pose qu'une fois par document,
      // voir CHAT_SYSTEM_PROMPT côté serveur). On ne propose les boutons
      // qu'une seule fois par document (docSaveAsked) pour ne pas les
      // réafficher sur tous les tours suivants tant que le document reste
      // attaché en arrière-plan.
      const offerSaveDocument = !!pendingDocument && !data.document_saved && !docSaveAsked;
      if (offerSaveDocument) setDocSaveAsked(true);

      // Demande Alex (29/08/2026, "il manque un bouton je confirme") : même
      // principe pour l'ajout au profil d'entreprise — voir l'outil
      // proposer_ajout_profil (app/api/chat/route.ts), appelé par Aaron au
      // moment où IL PROPOSE l'ajout (pas quand il l'exécute). Un signal
      // explicite du serveur, pas une déduction du texte — fiable même si
      // Aaron reformule sa question différemment d'une fois sur l'autre.
      const profileProposal = data.profile_update_proposal || null;

      if (data.reply) {
        setMessages([...newMessages, { role: 'assistant', content: data.reply, offerSaveDocument, profileProposal }]);
      } else {
        setSendError(t('chat.sendError', locale));
      }
    } catch {
      // Réseau coupé, timeout, réponse non-JSON... — voir commentaire sur
      // sendError plus haut : avant ce correctif, cette branche n'existait
      // pas du tout et "sending" restait bloqué à true.
      setSendError(t('chat.sendError', locale));
    } finally {
      setSending(false);
    }
  }

  async function handleSendFeedback(e) {
    e.preventDefault();
    if (!feedbackText.trim() || feedbackSending) return;
    setFeedbackSending(true);

    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, message: feedbackText }),
    });

    setFeedbackSending(false);
    setFeedbackText('');
    setShowFeedback(false);
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  }

  // "possibilité d'ouvrir une nouvelle conversation" (Alex, 25/08/2026).
  async function handleNewConversation() {
    if (creatingConversation) return;
    setCreatingConversation(true);
    try {
      const res = await fetch('/api/chat-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json();
      if (!res.ok || !body.conversation) return;
      setConversations((prev) => [body.conversation, ...prev]);
      setActiveConversationId(body.conversation.id);
      try {
        window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, body.conversation.id);
      } catch {
        // Voir draftStorageKey plus haut.
      }
    } finally {
      setCreatingConversation(false);
    }
  }

  function handleSwitchConversation(conversationId) {
    setDrawerOpen(false);
    if (conversationId === activeConversationId) return;
    setActiveConversationId(conversationId);
    try {
      window.localStorage.setItem(`meetaaron_chat_active_conversation_${userId}`, conversationId);
    } catch {
      // Voir draftStorageKey plus haut.
    }
  }

  // "possibilité de mettre une conv en favoris" (Alex, 25/08/2026) — épingle
  // en haut de liste (voir tri dans GET /api/chat-conversations), ne protège
  // plus rien d'une suppression automatique puisqu'il n'y en a pas.
  async function handleToggleFavorite(conversation, e) {
    e.stopPropagation();
    const nextValue = !conversation.is_favorite;
    setConversations((prev) =>
      prev
        .map((c) => (c.id === conversation.id ? { ...c, is_favorite: nextValue } : c))
        .sort((a, b) => (b.is_favorite === a.is_favorite ? 0 : b.is_favorite ? 1 : -1))
    );
    try {
      await fetch(`/api/chat-conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, is_favorite: nextValue }),
      });
    } catch {
      // Best-effort : au pire l'état local se resynchronisera au prochain
      // chargement de la liste (changement de page puis retour).
    }
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <p>Connexion…</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: var(--bg); color: var(--muted); font-family: 'Inter', sans-serif;
          }
        `}</style>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <style jsx>{`
          .auth-loading {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: var(--bg); color: var(--accent-red); font-family: 'Inter', sans-serif;
            text-align: center; padding: 2rem;
          }
        `}</style>
      </div>
    );
  }

  // Voir le commentaire sur pendingDocument plus haut : un document déjà
  // visible dans un message envoyé (bulle) n'a plus besoin d'être répété
  // comme chip flottant au-dessus du champ de saisie.
  const pendingDocumentAlreadyInChat =
    !!pendingDocument && messages.some((m) => m.role === 'user' && m.attachment?.file_name === pendingDocument.file_name);

  return (
    <Shell active={t('nav.chat', locale)} userId={userId}>
      {/* Refonte 01/09/2026 (demande Alex : « dans le chat Aaron, ça doit
          ressembler à Messenger ou Insta ; là on dirait un forum des années
          2000 ») : plus de titre de page ni d'encadré de 60vh au milieu de
          l'écran — une vraie fenêtre de messagerie plein écran, avec la
          barre d'en-tête (avatar + nom + statut), le fil au centre et la
          zone de saisie collée en bas. La liste des conversations passe
          dans un tiroir latéral, comme sur Messenger. */}
      <header className="mg-head">
        <span className="mg-avatar"><img src="/icon.png" alt="" /></span>
        <div className="mg-id">
          <p className="mg-name">Aaron</p>
          <p className="mg-status"><span className="mg-dot" aria-hidden="true" />{t('chat.headerStatus', locale)}</p>
        </div>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={handleNewConversation}
          disabled={creatingConversation}
          title={t('chat.newConversation', locale)}
          aria-label={t('chat.newConversation', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={() => setDrawerOpen(true)}
          title={t('chat.conversationsTitle', locale)}
          aria-label={t('chat.conversationsTitle', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button
          type="button"
          className="mg-icon-btn"
          onClick={() => setShowFeedback(!showFeedback)}
          title={t('chat.feedbackButton', locale)}
          aria-label={t('chat.feedbackButton', locale)}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" /></svg>
        </button>
      </header>

      {/* Barre de progression du questionnaire de découverte (demande Alex,
          27/08/2026, façon assistants campagnes/marketing), visible
          uniquement pendant le questionnaire lui-même (onboardingStep >= 0),
          pour les deux flux (création initiale ET régénération depuis Mon
          compte). Remplacée le 27/08/2026 (docx "Modifs Aaron", "tu as
          oublié la barre de progression PAR POINT... si il y a 8 questions
          alors une barre avec 8 points, et à chaque question répondue un
          point se remplit") par une suite de points discrets — un par
          question — plutôt qu'une barre continue en pourcentage : un point
          est rempli une fois la question CORRESPONDANTE répondue (index
          strictement inférieur à onboardingStep, qui pointe la question
          affichée mais pas encore répondue), le point de la question en
          cours est mis en évidence sans être plein. */}
      {onboardingStep >= 0 && (
        <div
          className="questionnaire-progress-dots"
          role="progressbar"
          aria-valuenow={onboardingStep + 1}
          aria-valuemin={1}
          aria-valuemax={getOnboardingQuestions(locale).length}
          aria-label={t('chat.questionnaireProgressLabel', locale)}
        >
          {getOnboardingQuestions(locale).map((_, i) => (
            <span
              key={i}
              className={`questionnaire-progress-dot${i < onboardingStep ? ' filled' : ''}${i === onboardingStep ? ' current' : ''}`}
            />
          ))}
        </div>
      )}

      {feedbackSent && <p className="feedback-sent">{t('chat.feedbackSentBanner', locale)}</p>}

      {showFeedback && (
        <form className="feedback-form" onSubmit={handleSendFeedback}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t('chat.feedbackPlaceholder', locale)}
            rows={3}
          />
          <div className="feedback-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowFeedback(false)}>{t('common.cancel', locale)}</button>
            <button type="submit" className="btn-primary" disabled={feedbackSending || !feedbackText.trim()}>
              {feedbackSending ? t('chat.sending', locale) : t('chat.send', locale)}
            </button>
          </div>
        </form>
      )}

      {/* Item 12 (docx Modifs Aaron 30/08/2026) : pendant la génération du
          profil (1-2 min), une fenêtre bloquante — "comme ça l'utilisateur
          comprend qu'il ne peut pas quitter tant que ce n'est pas terminé".
          Doublée d'un garde-fou beforeunload (voir l'effet plus haut) si
          malgré tout il ferme l'onglet. */}
      {summarizing && (
        <div className="gen-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="gen-card">
            <div className="gen-spinner" aria-hidden="true" />
            <h2 className="gen-title">{t('chat.generatingModalTitle', locale)}</h2>
            <p className="gen-body">{t('chat.generatingModalBody', locale)}</p>
            <div className="gen-bar" aria-hidden="true"><span /></div>
            <p className="gen-hint">{t('chat.generatingModalHint', locale)}</p>
          </div>
        </div>
      )}

      <div className="messenger">
        <div className="mg-messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="intro">
              <p>
                {isWelcome
                  ? t('common.loading', locale)
                  : t('chat.introGreeting', locale)}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            // Regroupement façon Messenger (01/09/2026) : les messages
            // consécutifs du même interlocuteur se collent, seul le DERNIER
            // du groupe porte la petite pointe et l'avatar d'Aaron, et
            // l'heure ne s'affiche qu'une fois par groupe. Un séparateur de
            // jour est inséré quand on change de date (created_at renvoyé
            // par /api/chat-history ; absent sur un message tout juste
            // envoyé côté client, on retombe silencieusement sur "pas de
            // séparateur, pas d'heure").
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const firstOfGroup = !prev || prev.role !== m.role;
            const lastOfGroup = !next || next.role !== m.role;
            const at = m.created_at ? new Date(m.created_at) : null;
            const prevAt = prev?.created_at ? new Date(prev.created_at) : null;
            const newDay = at && (!prevAt || at.toDateString() !== prevAt.toDateString());
            return (
            <div key={`w${i}`} className="mg-group-wrap">
            {newDay && (
              <div className="mg-day"><span>{dayLabel(at, locale)}</span></div>
            )}
            {/* Bug remonté par Alex (29/08/2026) : une sélection à la souris
                (clic gauche maintenu, pour copier un morceau de conversation)
                ne récupérait que les bulles Aaron, jamais les bulles
                utilisateur. Cause : chaque bulle était directement l'enfant
                flex de .messages, avec align-self pour la pousser à
                droite/gauche — l'espace vide à côté n'appartenait à AUCUN
                élément DOM, et le navigateur y accrochait la ligne voisine.
                Correctif : chaque bulle est enveloppée dans une ligne
                .msg-row qui occupe TOUTE la largeur (justify-content au lieu
                d'align-self), donc il y a toujours un élément sous le curseur.

                03/09/2026 : ce bloc était écrit en commentaire `//` au milieu
                du JSX — donc rendu comme du TEXTE dans la conversation, sous
                les yeux de l'utilisateur. En JSX, un commentaire placé entre
                des balises doit être une accolade contenant un commentaire de
                bloc ; la syntaxe // ne commente rien à cet endroit. */}
            <div className={`msg-row ${m.role}${firstOfGroup ? ' first' : ''}${lastOfGroup ? ' last' : ''}`}>
            {m.role === 'assistant' && (
              <span className={`mg-msg-avatar${lastOfGroup ? '' : ' hidden'}`} aria-hidden="true">
                <img src="/icon.png" alt="" />
              </span>
            )}
            <div className={`bubble ${m.role}`}>
              {m.attachment && (
                <div className="bubble-attachment">📎 {m.attachment.file_name}</div>
              )}
              {/* Typographie (demande Alex, 29/08/2026, capture à l'appui) :
                  seuls les textes GÉNÉRÉS PAR AARON passent par
                  frenchTypography (espace insécable avant : ; ! ?, pour
                  éviter la ponctuation orpheline en début de ligne) — jamais
                  le texte tapé par le commercial lui-même, qu'on affiche tel
                  quel. Voir lib/text-typography.js. */}
              {m.role === 'assistant' ? frenchTypography(m.content) : m.content}
              {/* Boutons de réponse rapide Oui/Non (demande Alex, 29/08/2026) :
                  affichés uniquement sous le dernier message, quand Aaron
                  vient de proposer de sauvegarder le document joint — un clic
                  envoie directement la réponse, sans repasser par le champ de
                  saisie (contrairement aux chips de suggestion de l'onboarding,
                  qui ne font que pré-remplir le champ). */}
              {m.offerSaveDocument && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={() => handleSend(null, 'Oui, sauvegarde-le.')}
                  >
                    {t('chat.quickReplySaveYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={() => handleSend(null, "Non, ce n'est pas nécessaire.")}
                  >
                    {t('chat.quickReplySaveNo', locale)}
                  </button>
                </div>
              )}
              {/* Proposition de (re)faire le questionnaire — voir
                  startQuestionnaireNow. Rien n'est modifié tant que le
                  commercial n'a pas cliqué « oui ». */}
              {m.offerRestartQuestionnaire && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={startQuestionnaireNow}
                  >
                    {t('chat.quickReplyRestartYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={declineQuestionnaireRestart}
                  >
                    {t('chat.quickReplyRestartNo', locale)}
                  </button>
                </div>
              )}
              {/* Boutons de réponse rapide Confirmer/Annuler (demande Alex,
                  29/08/2026, "il manque un bouton je confirme") — pour la
                  proposition d'ajout au profil d'entreprise (voir
                  proposer_ajout_profil côté serveur). */}
              {m.profileProposal && i === messages.length - 1 && !sending && (
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-yes"
                    onClick={() => handleSend(null, 'Oui, je confirme, ajoute-le à mon profil.')}
                  >
                    {t('chat.quickReplyProfileYes', locale)}
                  </button>
                  <button
                    type="button"
                    className="quick-reply-btn quick-reply-no"
                    onClick={() => handleSend(null, 'Non, laisse tomber.')}
                  >
                    {t('chat.quickReplyProfileNo', locale)}
                  </button>
                </div>
              )}
              {/* Bouton "Voir le profil de l'entreprise" (demande Alex,
                  29/08/2026 : "on en voit un aperçu de texte et on peut
                  cliquer... et là on voit un super document") — le message
                  n'affiche plus qu'un aperçu du document complet (voir
                  handleGenerateSummary, buildSummaryPreview), ce bouton
                  ouvre l'onglet "Mon entreprise" de Mon compte où le
                  document entier est éditable, exportable en Word/PDF. Pas
                  de garde sur i/sending : contrairement aux boutons de
                  réponse rapide ci-dessus, c'est une simple navigation (pas
                  une action ponctuelle), donc rester cliquable même sur un
                  ancien message est voulu. */}
              {m.viewProfileLink && (
                <div className="tour-link-row">
                  <a href={`/app/connexions${userId ? `?user_id=${userId}&tab=company` : '?tab=company'}`} className="tour-link">
                    {t('chat.viewBusinessProfileButton', locale)}
                  </a>
                </div>
              )}
            </div>
            </div>
            {lastOfGroup && at && (
              <div className={`mg-time ${m.role}`}>{at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</div>
            )}
            </div>
            );
          })}
          {sending && (
            <div className="msg-row assistant first last">
              <span className="mg-msg-avatar" aria-hidden="true"><img src="/icon.png" alt="" /></span>
              <div className="bubble assistant typing" aria-label={t('chat.aaronThinking', locale)}>
                <span className="mg-typing"><i /><i /><i /></span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {questionnaireDone && !summaryDone && (
          <div className="welcome-actions">
            <button type="button" className="btn-secondary" onClick={handleGenerateSummary} disabled={summarizing}>
              {summarizing ? t('chat.generatingSummary', locale) : t('chat.generateSummaryButton', locale)}
            </button>
            {/* Demande Alex (29/08/2026) : la génération prend 1-2 minutes
                (document long, plusieurs sections) — sans indication, on
                dirait que le bouton est resté bloqué. Rassure l'utilisateur
                plutôt que de le laisser deviner. */}
            {summarizing && <span className="welcome-actions-hint">{t('chat.generatingSummaryHint', locale)}</span>}
          </div>
        )}

        {/* Bug remonté par Alex (29/08/2026) : ce chip restait affiché même
            APRÈS l'envoi du document dans un message (déjà visible dans sa
            bulle, voir bubble-attachment) — donnant l'impression qu'il
            n'était pas parti. pendingDocumentAlreadyInChat détecte ce cas
            (le document apparaît déjà dans un message envoyé) et cache alors
            ce chip flottant, comme sur Claude.ai/ChatGPT une fois le fichier
            envoyé. Il continue néanmoins d'être transmis à Aaron en
            arrière-plan (voir pendingDocument plus haut) tant qu'il n'est
            pas sauvegardé/retiré — seul l'affichage change. */}
        {((pendingDocument && !pendingDocumentAlreadyInChat) || uploadingDocument || attachError || sendError) && (
          <div className="attach-row">
            {uploadingDocument && <span className="attach-chip attach-loading">{t('chat.attachUploading', locale)}</span>}
            {pendingDocument && !uploadingDocument && !pendingDocumentAlreadyInChat && (
              <span className="attach-chip">
                📎 {pendingDocument.file_name}
                <button
                  type="button"
                  className="attach-remove"
                  onClick={() => setPendingDocument(null)}
                  aria-label={t('chat.attachRemove', locale)}
                >
                  ✕
                </button>
              </span>
            )}
            {attachError && <span className="attach-error">{attachError}</span>}
            {sendError && <span className="attach-error">{sendError}</span>}
          </div>
        )}

        {/* Suggestions cliquables (demande Alex, docx "Modifs Aaron") :
            uniquement pendant le questionnaire, traduites dans les 7 langues
            du site (voir ONBOARDING_QUESTION_SUGGESTIONS plus haut). Repli sur
            le français si jamais une locale/clé venait à manquer. */}
        {onboardingStep >= 0 && !sending && (ONBOARDING_QUESTION_SUGGESTIONS[locale]?.[ONBOARDING_QUESTION_KEYS[onboardingStep]] || ONBOARDING_QUESTION_SUGGESTIONS.fr[ONBOARDING_QUESTION_KEYS[onboardingStep]]) && (
          <div className="suggestion-row">
            {(ONBOARDING_QUESTION_SUGGESTIONS[locale]?.[ONBOARDING_QUESTION_KEYS[onboardingStep]] || ONBOARDING_QUESTION_SUGGESTIONS.fr[ONBOARDING_QUESTION_KEYS[onboardingStep]]).map((s) => (
              <button
                key={s.label}
                type="button"
                className="suggestion-chip"
                onClick={() => {
                  // Bug remonté par Alex (30/08/2026) : cliquer sur un chip
                  // REMPLAÇAIT tout le texte déjà saisi (setInput(s.text) tout
                  // court) — impossible de composer sa réponse en cliquant
                  // plusieurs chips à la suite, ou d'écrire une phrase autour
                  // d'un chip. Corrigé pour insérer le texte du chip À LA
                  // POSITION DU CURSEUR (comme un vrai copier-coller) plutôt
                  // que de tout écraser : le texte avant, après, ou entre deux
                  // chips cliqués l'un après l'autre est désormais préservé.
                  const el = textareaRef.current;
                  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : input.length;
                  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : input.length;
                  const before = input.slice(0, start);
                  const after = input.slice(end);
                  // Espace de séparation si besoin, pour ne pas coller le chip
                  // directement à un mot déjà présent avant/après le curseur.
                  const needsSpaceBefore = before && !/\s$/.test(before);
                  const needsSpaceAfter = after && !/^\s/.test(after);
                  const insert = `${needsSpaceBefore ? ' ' : ''}${s.text}${needsSpaceAfter ? ' ' : ''}`;
                  const newValue = before + insert + after;
                  const newCursorPos = before.length + insert.length;
                  setInput(newValue);
                  // Repositionne le curseur juste après le texte inséré, une
                  // fois que React a bien reporté newValue dans le DOM du
                  // <textarea> contrôlé (value={input}) — sinon setSelectionRange
                  // s'appliquerait encore sur l'ancienne valeur.
                  requestAnimationFrame(() => {
                    el?.focus();
                    el?.setSelectionRange(newCursorPos, newCursorPos);
                  });
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <form className="mg-composer" onSubmit={handleSend}>
          <input
            ref={fileInputRef}
            type="file"
            className="file-input-hidden"
            onChange={handleFileSelected}
            accept=".pdf,.txt,.csv,.doc,.docx,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <button
            type="button"
            className="mg-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploadingDocument}
            title={t('chat.attachButton', locale)}
            aria-label={t('chat.attachButton', locale)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 0 1 5.18 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.5-8.49" /></svg>
          </button>
          <textarea
            ref={textareaRef}
            className="mg-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            // Revenu en arrière (demande Alex, 27/08/2026, docx "Modifs
            // Aaron") : Entrée ne doit PLUS envoyer le message, juste
            // revenir à la ligne (comportement natif d'un <textarea>, donc
            // rien à gérer ici) — seul un clic sur "Envoyer" envoie
            // désormais le message.
            placeholder={t('chat.inputPlaceholder', locale)}
            disabled={sending}
          />
          {/* Bug remonté par Alex (29/08/2026) : un document seul, sans texte,
              devait pouvoir être envoyé (bouton grisé sinon) — voir la même
              condition sur la garde en tête de handleSend. */}
          {/* Bouton rond fléché, comme dans une messagerie — le libellé
              « Envoyer » reste en aria-label pour l'accessibilité. */}
          <button
            type="submit"
            className="mg-send"
            disabled={sending || (!input.trim() && !pendingDocument)}
            title={t('chat.send', locale)}
            aria-label={t('chat.send', locale)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
      </div>

      {/* "possibilité d'ouvrir une nouvelle conversation" + "possibilité de
          mettre une conv en favoris" (Alex, 25/08/2026), affiché "en bas du
          bloc chat avec aaron" comme demandé. Conservation illimitée (voir
          migration_chat_conversations_2026-08-25.sql) : le favori sert
          uniquement à épingler en haut de liste, rien n'est jamais supprimé
          automatiquement. */}
      {/* Tiroir « mes conversations » (refonte messagerie 01/09/2026) : la
          liste ne s'empile plus sous le fil (effet forum), elle glisse
          depuis la droite comme la liste de discussions d'une messagerie. */}
      {drawerOpen && <div className="mg-drawer-overlay" onClick={() => setDrawerOpen(false)} />}
      <aside className={`conversations-panel${drawerOpen ? ' open' : ''}`}>
        <div className="conversations-head">
          <h2>{t('chat.conversationsTitle', locale)}</h2>
          <button type="button" className="mg-icon-btn" onClick={() => setDrawerOpen(false)} aria-label={t('common.close', locale)}>✕</button>
        </div>
        <button type="button" className="mg-new-conv" onClick={handleNewConversation} disabled={creatingConversation}>
          + {t('chat.newConversation', locale)}
        </button>
        <p className="conversations-hint">{t('chat.conversationsHint', locale)}</p>
        {conversationsError && conversations.length === 0 ? (
          <p className="conversations-error">{t('chat.conversationsLoadError', locale)}</p>
        ) : (
          <ul className="conversations-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`conversation-row ${c.id === activeConversationId ? 'active' : ''}`}
                  onClick={() => handleSwitchConversation(c.id)}
                >
                  <span
                    className={`conversation-star ${c.is_favorite ? 'is-favorite' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleToggleFavorite(c, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleToggleFavorite(c, e);
                    }}
                    title={c.is_favorite ? t('chat.favoriteRemove', locale) : t('chat.favoriteAdd', locale)}
                    aria-label={c.is_favorite ? t('chat.favoriteRemove', locale) : t('chat.favoriteAdd', locale)}
                  >
                    {c.is_favorite ? '★' : '☆'}
                  </span>
                  <span className="conversation-info">
                    <span className="conversation-title">{c.title || t('chat.conversationUntitled', locale)}</span>
                    {c.preview && <span className="conversation-preview">{c.preview}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* docx AJOUT GLOBAL item A8 : "revoir la visite guidée" doit rester
          accessible en permanence juste sous le chat (pas seulement pendant
          l'onboarding, et plus dans le pied de page de Préférences — voir
          app/app/preferences/page.jsx). */}
      <div className="tour-link-row">
        <a href={`/app/tour${userId ? `?user_id=${userId}` : ''}`} className="tour-link">
          {t('chat.viewTourButton', locale)}
        </a>
      </div>

      <style jsx>{`
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--accent);
          font-weight: 600;
          margin: 0 0 0.4rem;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 1.9rem;
          margin: 0;
        }
        .btn-feedback {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.55rem 0.9rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .feedback-sent {
          background: rgba(61, 214, 140, 0.12);
          border: 1px solid rgba(61, 214, 140, 0.4);
          color: var(--accent-green);
          padding: 0.7rem 1rem;
          border-radius: var(--radius-md);
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
        .questionnaire-progress-dots {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-bottom: 1rem;
        }
        .questionnaire-progress-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--border);
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .questionnaire-progress-dot.filled {
          background: var(--accent);
        }
        .questionnaire-progress-dot.current {
          background: var(--bg);
          border: 2px solid var(--accent);
          transform: scale(1.15);
        }
        .feedback-form {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1rem;
          margin-bottom: 1.2rem;
        }
        .feedback-form textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.7rem;
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
          resize: vertical;
        }
        .feedback-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.7rem;
        }
        .btn-primary, .btn-secondary {
          border-radius: var(--radius-sm);
          padding: 0.5rem 1rem;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          font-weight: 600;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        /* ============ Fenêtre de messagerie (refonte 01/09/2026) ============
           Demande d'Alex : « dans le chat Aaron ça doit ressembler à
           Messenger ou Insta ; là on dirait un forum des années 2000 ».
           La colonne prend toute la hauteur disponible, l'en-tête et la
           saisie sont fixes, seul le fil défile. */
        /* Fil centré et borné, comme une messagerie : sur un grand écran une
           ligne de texte qui traverse 1500 px est illisible. */
        .mg-head {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0 0.2rem 0.9rem;
          border-bottom: 1px solid var(--border-soft);
          max-width: 940px;
          margin: 0 auto;
          width: 100%;
        }
        .mg-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--surface);
          box-shadow: 0 0 0 2px rgba(75, 57, 239, 0.35);
        }
        .mg-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mg-id { flex: 1; min-width: 0; }
        .mg-name {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.02rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .mg-status {
          margin: 0.1rem 0 0;
          font-size: 0.76rem;
          color: var(--muted);
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        .mg-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
        }
        .mg-icon-btn {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9rem;
          transition: background var(--fast), color var(--fast);
        }
        .mg-icon-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
        .mg-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .messenger {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 13rem);
          min-height: 420px;
          max-width: 940px;
          margin: 0 auto;
          width: 100%;
        }
        .mg-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.1rem 0.4rem 0.6rem;
          display: flex;
          flex-direction: column;
          gap: 0.12rem;
        }
        .mg-group-wrap { display: contents; }
        .intro {
          color: var(--muted);
          font-size: 0.9rem;
          text-align: center;
          margin-top: 2rem;
        }
        .mg-day {
          display: flex;
          justify-content: center;
          margin: 1rem 0 0.7rem;
        }
        .mg-day span {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          font-size: 0.7rem;
          padding: 0.2rem 0.75rem;
          border-radius: 999px;
          text-transform: capitalize;
        }
        .msg-row {
          display: flex;
          width: 100%;
          align-items: flex-end;
          gap: 0.45rem;
        }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.assistant { justify-content: flex-start; }
        .msg-row.first { margin-top: 0.55rem; }
        .mg-msg-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          overflow: hidden;
          flex-shrink: 0;
          align-self: flex-end;
        }
        .mg-msg-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mg-msg-avatar.hidden { visibility: hidden; }
        .bubble {
          max-width: min(70%, 620px);
          padding: 0.62rem 0.95rem;
          border-radius: 20px;
          font-size: 0.92rem;
          line-height: 1.45;
          white-space: pre-wrap;
          overflow-wrap: break-word;
        }
        /* Coins « collés » à l'intérieur d'un groupe : le repère visuel des
           messageries — un seul bloc quand on enchaîne plusieurs messages. */
        .msg-row.user .bubble {
          background: linear-gradient(135deg, var(--accent), var(--accent-light));
          color: #fff;
          border-bottom-right-radius: 6px;
        }
        .msg-row.user:not(.first) .bubble { border-top-right-radius: 6px; }
        .msg-row.assistant .bubble {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border-soft);
          color: var(--text);
          border-bottom-left-radius: 6px;
        }
        .msg-row.assistant:not(.first) .bubble { border-top-left-radius: 6px; }
        .mg-time {
          font-size: 0.66rem;
          color: var(--muted-soft);
          margin: 0.15rem 0 0.1rem;
          padding: 0 0.3rem;
        }
        .mg-time.user { text-align: right; }
        .mg-time.assistant { text-align: left; padding-left: 2.1rem; }
        .bubble.typing { padding: 0.75rem 1rem; }
        .mg-typing { display: inline-flex; gap: 4px; align-items: center; }
        .mg-typing i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--muted);
          animation: mg-blink 1.2s infinite ease-in-out;
        }
        .mg-typing i:nth-child(2) { animation-delay: 0.18s; }
        .mg-typing i:nth-child(3) { animation-delay: 0.36s; }
        @keyframes mg-blink {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        .bubble-attachment {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.78rem;
          font-weight: 600;
          opacity: 0.85;
          margin-bottom: 0.35rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.25);
        }
        .bubble.assistant .bubble-attachment {
          border-bottom-color: var(--border);
        }
        .quick-replies {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.7rem;
        }
        .quick-reply-btn {
          border-radius: var(--radius-sm);
          padding: 0.45rem 0.9rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text);
        }
        .quick-reply-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .quick-reply-yes {
          border-color: var(--accent);
        }
        .welcome-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          padding: 0 1rem 1rem;
        }
        .gen-overlay {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: rgba(5, 6, 12, 0.72);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .gen-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 2rem 1.8rem;
          width: min(440px, 100%);
          text-align: center;
          box-shadow: var(--shadow-lg);
        }
        .gen-spinner {
          width: 44px;
          height: 44px;
          margin: 0 auto 1rem;
          border-radius: 50%;
          border: 3px solid var(--border);
          border-top-color: var(--accent-light);
          animation: gen-spin 0.9s linear infinite;
        }
        @keyframes gen-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .gen-title {
          margin: 0 0 0.5rem;
          font-family: var(--font-display);
          font-size: 1.2rem;
        }
        .gen-body {
          margin: 0 0 1rem;
          color: var(--muted);
          font-size: 0.9rem;
          line-height: 1.5;
        }
        .gen-bar {
          height: 6px;
          border-radius: 999px;
          background: var(--bg);
          border: 1px solid var(--border);
          overflow: hidden;
          margin-bottom: 0.8rem;
        }
        .gen-bar span {
          display: block;
          height: 100%;
          width: 40%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), var(--accent-light));
          animation: gen-slide 1.6s ease-in-out infinite;
        }
        @keyframes gen-slide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(260%);
          }
        }
        .gen-hint {
          margin: 0;
          font-size: 0.78rem;
          color: var(--muted-soft);
        }
        .welcome-actions-hint {
          flex-basis: 100%;
          color: var(--muted);
          font-size: 0.82rem;
        }
        .btn-tour {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }
        /* Tiroir latéral (refonte messagerie) : masqué par défaut, glisse
           depuis la droite au clic sur l'icône « liste » de l'en-tête. */
        .conversations-panel {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(340px, 88vw);
          z-index: 119;
          background: var(--bg-elevated);
          border-left: 1px solid var(--border);
          box-shadow: var(--shadow-lg);
          padding: 1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));
          overflow-y: auto;
          transform: translateX(100%);
          transition: transform 0.25s var(--ease);
          box-sizing: border-box;
        }
        .conversations-panel.open { transform: translateX(0); }
        .mg-new-conv {
          width: 100%;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--radius-md);
          padding: 0.6rem 1rem;
          font-size: 0.84rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          margin-bottom: 0.7rem;
        }
        .mg-new-conv:disabled { opacity: 0.5; cursor: not-allowed; }
        .conversations-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.4rem;
        }
        .conversations-head h2 {
          font-size: 0.95rem;
          margin: 0;
          font-family: var(--font-display);
        }
        .conversations-hint {
          font-size: 0.76rem;
          color: var(--muted);
          margin: 0 0 0.9rem;
        }
        .conversations-error {
          font-size: 0.82rem;
          color: var(--accent-red);
          margin: 0;
        }
        .conversations-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          max-height: 260px;
          overflow-y: auto;
        }
        .conversation-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.6rem;
          cursor: pointer;
          text-align: left;
        }
        .conversation-row:hover {
          background: var(--bg);
        }
        .conversation-row.active {
          background: var(--bg);
          border-color: var(--border);
        }
        .conversation-star {
          flex-shrink: 0;
          font-size: 1rem;
          color: var(--muted);
          line-height: 1;
          cursor: pointer;
        }
        .conversation-star.is-favorite {
          color: #F0C94E;
        }
        .conversation-info {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          min-width: 0;
          flex: 1;
        }
        .conversation-title {
          font-size: 0.84rem;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .conversation-preview {
          font-size: 0.74rem;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tour-link-row {
          text-align: center;
          margin-top: 0.8rem;
        }
        /* Bug remonté par Alex (29/08/2026) : ce lien ("Voir comment
           fonctionne l'appli") était un simple texte souligné discret
           (couleur --muted, petite taille) — pas assez visible pour qu'on
           comprenne qu'on peut cliquer dessus. Repris avec le même habillage
           que .btn-secondary (bordure, fond au survol) pour qu'il se
           reconnaisse clairement comme un bouton, tout en restant un <Link>
           (navigation, pas d'action JS). */
        .tour-link {
          display: inline-block;
          color: var(--text);
          font-size: 0.82rem;
          font-weight: 600;
          text-decoration: none;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.5rem 1rem;
        }
        .tour-link:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--accent);
        }
        .attach-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          padding: 0 1rem;
          margin-top: 0.6rem;
        }
        .suggestion-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          padding: 0.6rem 1rem 0;
        }
        .suggestion-chip {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--accent);
          border-radius: 999px;
          padding: 0.35rem 0.8rem;
          font-size: 0.78rem;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .suggestion-chip:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .attach-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-md);
          padding: 0.35rem 0.7rem;
          font-size: 0.8rem;
        }
        .attach-loading {
          color: var(--muted);
        }
        .attach-remove {
          background: none;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0;
          line-height: 1;
        }
        .attach-remove:hover {
          color: var(--accent-red);
        }
        .attach-error {
          color: var(--accent-red);
          font-size: 0.8rem;
        }
        .mg-composer {
          display: flex;
          align-items: flex-end;
          gap: 0.4rem;
          padding: 0.6rem 0.2rem 0.2rem;
          border-top: 1px solid var(--border-soft);
        }
        .file-input-hidden { display: none; }
        .mg-attach, .mg-send {
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .mg-attach { background: transparent; color: var(--muted); }
        .mg-attach:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
        .mg-send { background: var(--accent); color: #fff; }
        .mg-send:hover:not(:disabled) { background: var(--accent-light); transform: scale(1.05); }
        .mg-attach:disabled, .mg-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .mg-input {
          flex: 1;
          min-width: 0;
          max-height: 140px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 22px;
          padding: 0.68rem 1.05rem;
          color: var(--text);
          /* 16px : évite le zoom automatique de Safari iOS à la mise au point */
          font-size: 16px;
          font-family: inherit;
          line-height: 1.45;
          resize: none;
          overflow-y: auto;
          transition: border-color var(--fast);
        }
        .mg-input:focus { outline: none; border-color: var(--accent); }
        .mg-input::placeholder { color: var(--muted); }
        .mg-input:disabled { opacity: 0.6; }

        /* Tiroir des conversations + adaptation téléphone */
        .mg-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 6, 12, 0.55);
          backdrop-filter: blur(2px);
          z-index: 118;
        }
        @media (max-width: 900px) {
          .messenger {
            height: calc(100dvh - 52px - 62px - 7.5rem);
            min-height: 340px;
          }
          .mg-head { padding-bottom: 0.7rem; }
          .bubble { max-width: 82%; font-size: 0.95rem; }
          .mg-composer {
            position: sticky;
            bottom: 0;
            background: var(--bg);
            padding-bottom: 0.4rem;
          }
        }
      `}</style>
    </Shell>
  );
}

function Shell({ children, active, userId, onNotificationsChanged, onNotificationContact }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lockedModules, setLockedModules] = useState({ prospect: false, sales: false, customer: false });
  // Demande Alex (2026-08-25) : "Mon équipe" ne doit pas apparaître DU TOUT
  // (pas grisé/verrouillé, absent) pour un compte "commercial" (rejoint via
  // code d'invitation, ou créé en solo sans être "fondateur(trice)/
  // dirigeant(e)" — voir app/onboarding/page.jsx). null tant que le rôle
  // n'est pas encore chargé : NAV_ITEMS masque l'item par défaut dans ce cas
  // (fermé par défaut plutôt qu'ouvert puis masqué après coup).
  const [userRole, setUserRole] = useState(null);
  // Docx Modifs Aaron (30/08/2026) : la rubrique Clients est réservée au
  // compte aaron@meetaaron.app (supprimée pour tous les autres comptes,
  // fondateur comme commercial) — même logique "fermé par défaut" que
  // userRole ci-dessus. Produits est retiré pour tout le monde, et
  // Suggestions devient un onglet de Mon équipe (voir app/app/team/page.jsx).
  const [userEmail, setUserEmail] = useState(null);
  const [locale, setLocale] = useLocale();

  // CHANGEMENTS A FAIRE (2026-08-16, item 31 + section STRIPE) : abonnement
  // multi-module — chacun des 3 modules Aaron Prospect/Opportunités/Clients
  // est maintenant indépendamment actif/inactif (companies.offer_ap_active/
  // offer_as_active/offer_ac_active), au lieu d'un seul module "offer" avec
  // Aaron Prospect toujours actif par défaut. Voir lib/subscription.ts et
  // l'onglet Abonnement dans Préférences.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/preferences?user_id=${userId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const prefs = body.preferences || {};
        setLockedModules({
          prospect: prefs.offer_ap_active === false,
          sales: prefs.offer_as_active !== true,
          customer: prefs.offer_ac_active !== true,
        });
        setUserRole(prefs.role || null);
        setUserEmail(prefs.email || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Demande d'Alex (docx CHANGEMENTS A FAIRE, item A10, 2026-08-20) : une
  // rubrique connexion/déconnexion visible tout en bas de la barre latérale,
  // sur chaque page (pas seulement Préférences comme avant) — distincte du
  // pastille "En veille"/"Aaron travaille" du tableau de bord, qui reflète
  // l'activité des campagnes, pas la connexion de l'utilisateur.
  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    // Efface aussi le marqueur "connexion explicite faite aujourd'hui" (voir
    // components/AuthFetchInterceptor.jsx et lib/supabase-browser.ts) pour
    // qu'un lien direct vers /app, juste après cette déconnexion, repasse
    // bien par /login au lieu de rouvrir l'app.
    clearExplicitLogin();
    window.location.href = '/login';
  }

  const NAV_ITEMS = [
    { label: t('nav.dashboard', locale), slug: 'dashboard', icon: '📊' },
    { label: t('nav.prospects', locale), slug: 'prospects', icon: '🎯', locked: lockedModules.prospect },
    { label: t('nav.campaigns', locale), slug: 'campaigns', icon: '🚀', locked: lockedModules.prospect },
    { label: t('nav.agenda', locale), slug: 'agenda', icon: '📅' },
    { label: t('nav.results', locale), slug: 'resultats', icon: '📈' },
    { label: t('nav.chat', locale), slug: 'chat', icon: '💬' },
    { label: t('nav.documents', locale), slug: 'documents', icon: '📁' },
    { label: t('nav.connections', locale), slug: 'connexions', icon: '🔗' },
    { label: t('nav.team', locale), slug: 'team', icon: '👥' },
  ];
  return (
    <div className="shell">
      {/* Habillage téléphone/tablette : barre du haut + barre d'onglets du
          bas (components/MobileChrome.jsx, styles dans app/globals.css) —
          remplace l'ancien bouton hamburger flottant (docx 30/08, item 8). */}
      <MobileChrome
        title={active}
        items={NAV_ITEMS}
        userId={userId}
        onMenu={() => setMobileOpen(true)}
        menuLabel={t('shell.openMenu', locale)}
        moreLabel={t('shell.more', locale)}
        locale={locale}
      />
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/icon.png" alt="Meet Aaron" className="brand-mark" />
          <span>Meet Aaron</span>
        </div>
        <select
          className="lang-switcher"
          value={locale}
          onChange={(e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            // Synchronise côté serveur (fire-and-forget) pour que le contenu
            // généré par Aaron (conseils, emails, chat, devis) utilise la même
            // langue — voir lib/locale-instruction.ts. Un échec ici ne doit
            // jamais bloquer le changement de langue de l'UI elle-même.
            if (userId) {
              fetch('/api/user/locale', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: newLocale }),
              }).catch(() => {});
            }
          }}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_FLAGS[l]} {l.toUpperCase()}</option>
          ))}
        </select>
        <ul className="nav-list">
          {NAV_ITEMS.filter((item) => (item.slug !== 'team' || userRole === 'patron')).map((item) => (
            <Link
              key={item.label}
              href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${userId ? `?user_id=${userId}` : ''}`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <li className={`${item.label === active ? 'active' : ''}${item.locked ? ' locked' : ''}`}><span className="nav-icon"><NavIcon slug={item.slug} /></span><span className="nav-label">{item.label}</span>{item.locked && <span className="lock-badge" title={t('shell.notIncluded', locale)}><LockIcon /></span>}</li>
            </Link>
          ))}
        </ul>
        <div className="rail-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </div>
        <div className="account-section">
          <div className="conn-status">
            <span className="conn-dot" />
            <span className="nav-label">{t('shell.connected', locale)}</span>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            <span className="nav-label">{t('common.logout', locale)}</span>
          </button>
        </div>
      </nav>
      <main className="content">
        {/* Notifications « bulles » en haut de CHAQUE page, toujours au même
            endroit (demande Alex, 03/09/2026). Avant, le bandeau n'existait
            que sur Tableau de bord et Contacts, et la cloche du rail était
            invisible sous 901px : sur téléphone, un commercial ne voyait donc
            AUCUNE notification tant qu'il n'était pas sur l'une de ces deux
            pages. Placé ici, dans le Shell, la position est identique partout
            et sur tous les écrans.
            Coût nul quand il n'y a rien à traiter : Stories rend `null` si
            aucun groupe n'est en attente (voir components/Stories.jsx), donc
            aucune page ne perd de hauteur utile. */}
        <Stories userId={userId} locale={locale} onChanged={onNotificationsChanged} onOpenContact={onNotificationContact} />
        {children}
      </main>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        :root {
          --bg: #0a0c17;
          --bg-elevated: #0f1224;
          --surface: #12162a;
          --surface-hover: #171b34;
          --border: #232744;
          --border-soft: rgba(244, 241, 234, 0.07);
          --accent: #4b39ef;
          --accent-light: #7c6ef5;
          --accent-dark: #3627c0;
          --accent-glow: rgba(75, 57, 239, 0.4);
          --accent-green: #3dd68c;
          --accent-red: #ef4459;
          --accent-amber: #f5a623;
          --text: #f4f1ea;
          --muted: #8b90a8;
          --muted-soft: #666b85;
          --radius-sm: 8px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --radius-xl: 24px;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.45);
          --shadow-glow: 0 0 0 1px rgba(75, 57, 239, 0.2), 0 8px 32px rgba(75, 57, 239, 0.22);
          --ease: cubic-bezier(0.4, 0, 0.2, 1);
          --fast: 0.15s var(--ease);
          --normal: 0.25s var(--ease);
          --font-display: 'Space Grotesk', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          position: relative;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(720px circle at 8% -6%, rgba(75, 57, 239, 0.16), transparent 60%),
            radial-gradient(640px circle at 96% 8%, rgba(61, 214, 140, 0.08), transparent 55%),
            radial-gradient(900px circle at 50% 118%, rgba(75, 57, 239, 0.1), transparent 60%);
        }
        ::selection {
          background: var(--accent);
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--accent-dark);
          background-clip: padding-box;
        }
        * {
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;
        }
        a:focus-visible,
        button:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible,
        [tabindex]:focus-visible {
          outline: 2px solid var(--accent-light);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
      <style jsx>{`
        .shell {
          display: grid;
          grid-template-columns: 252px 1fr;
          min-height: 100vh;
        }
        .sidebar {
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border-right: 1px solid var(--border-soft);
          padding: 1.6rem 1.1rem;
          box-shadow: 1px 0 0 rgba(0, 0, 0, 0.15);
        }
        .account-section {
          margin-top: 0.8rem;
          padding-top: 0.8rem;
          border-top: 1px solid var(--border-soft);
        }
        .conn-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.75rem 0.5rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .conn-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.18);
          flex-shrink: 0;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          padding: 0.62rem 0.75rem;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--muted);
          font-size: 0.87rem;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--fast), color var(--fast);
        }
        .logout-btn:hover {
          background: var(--surface-hover);
          color: var(--accent-red);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-family: var(--font-display);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin-bottom: 1.8rem;
          padding: 0 0.3rem;
        }
        .brand span {
          background: linear-gradient(90deg, var(--text) 20%, var(--accent-light) 120%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(244, 241, 234, 0.08), 0 4px 14px rgba(75, 57, 239, 0.35);
        }
        .lang-switcher {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-soft);
          color: var(--muted);
          border-radius: var(--radius-md);
          padding: 0.5rem 0.6rem;
          font-size: 0.76rem;
          font-family: inherit;
          margin-bottom: 1.3rem;
          cursor: pointer;
          transition: border-color var(--fast), color var(--fast);
        }
        .lang-switcher:hover {
          border-color: var(--accent);
          color: var(--text);
        }
        .nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .nav-link {
          text-decoration: none;
        }
        .nav-list li {
          position: relative;
          padding: 0.62rem 0.75rem;
          border-radius: var(--radius-md);
          font-size: 0.87rem;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          transition: background var(--fast), color var(--fast), transform var(--fast);
        }
        .nav-list li:hover {
          background: var(--surface-hover);
          color: var(--text);
          transform: translateX(2px);
        }
        .nav-icon {
          font-size: 0.92rem;
          width: 1.75em;
          height: 1.75em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: rgba(244, 241, 234, 0.04);
          flex-shrink: 0;
          transition: background var(--fast);
        }
        .nav-list li.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.22), rgba(75, 57, 239, 0.08));
          color: var(--text);
          font-weight: 500;
        }
        .nav-list li.active::before {
          content: '';
          position: absolute;
          left: -1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 4px 4px 0;
          background: var(--accent-light);
          box-shadow: 0 0 10px var(--accent-glow);
        }
        .nav-list li.active .nav-icon {
          background: rgba(124, 110, 245, 0.22);
        }
        .nav-list li.locked {
          opacity: 0.4;
        }
        .nav-list li.locked:hover {
          transform: none;
          background: transparent;
        }
        .lock-badge {
          margin-left: auto;
          font-size: 0.72rem;
        }
        .content {
          padding: 2.5rem 3rem;
          min-width: 0;
          animation: content-in 0.35s var(--ease);
        }
        @keyframes content-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mobile-menu-btn {
          display: none;
        }
        .sidebar-overlay {
          display: none;
        }
        @media (max-width: 900px) {
          .shell {
            grid-template-columns: 1fr;
          }
          .mobile-menu-btn {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 60;
            width: 40px;
            height: 40px;
            background: var(--surface);
            border: 1px solid var(--border-soft);
            border-radius: var(--radius-md);
            cursor: pointer;
            padding: 0;
            box-shadow: var(--shadow-sm);
            transition: border-color var(--fast);
          }
          .mobile-menu-btn:hover {
            border-color: var(--accent);
          }
          .mobile-menu-btn .bar {
            display: block;
            width: 18px;
            height: 2px;
            margin: 0 auto;
            background: var(--text);
            border-radius: 1px;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 260px;
            transform: translateX(-100%);
            transition: transform 0.25s var(--ease);
            z-index: 70;
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
          }
          .sidebar-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(5, 6, 12, 0.6);
            backdrop-filter: blur(2px);
            z-index: 65;
          }
          .content {
            padding: 1.5rem;
            padding-top: 4.5rem;
          }
        }
      `}</style>
    </div>
  );
}
