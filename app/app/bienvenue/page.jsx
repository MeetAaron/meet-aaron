// app/app/bienvenue/page.jsx
'use client';

// Parcours de première connexion (refonte de l'onboarding validée par Alex le
// 21/10/2026, plaquette « Onboarding Meet Aaron — proposition de refonte »).
//
// Un seul écran plein, sans menu ni chat, avec « Étape X sur N » en haut et
// deux boutons fixes en bas : « Passer » et « Reprendre plus tard ».
//   0. Bienvenue   — 3 cartes : Aaron trouve, écrit, relance ; tu valides.
//   1. Entreprise  — les 12 questions (puces + réponse libre), encouragements
//                    à la 6e et à la 10e, dépôt d'un document en haut pour
//                    pré-remplir. Fin : Aaron rédige la fiche entreprise.
//   2. Campagne    — ZÉRO question nouvelle : pré-remplie depuis les réponses,
//                    on confirme ou corrige, on choisit le nombre.
//   3. Boîte mail  — Google / Microsoft (agenda inclus) ou autre boîte.
//   Fin            — ce qui part maintenant, ce qui attend encore.
// Commercial invité par code (profil d'entreprise déjà fait) : 0, 3 et Fin.
//
// Reprise EXACTE : écran, question et réponses sont enregistrés en base à
// chaque pas (/api/welcome) — jamais dans le navigateur. « Reprendre plus
// tard » mène au tableau de bord ; le parcours se rouvre à la prochaine
// connexion, au même endroit. Une fois fini, il ne réapparaît plus.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { t, useLocale, LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { ONBOARDING_QUESTION_KEYS, suggestionsFor } from '@/lib/onboarding-questions';
import { Search, PenLine, RefreshCw, Check, Upload, Mail, ArrowRight, ArrowLeft, Sparkles, Loader2, FileText } from 'lucide-react';

// Textes du parcours, gardés ici (lib/i18n.js est trop lourd pour l'envoi web
// de GitHub), comme components/ContactCard.jsx.
const W = {
  fr: {
    chatSend: 'Envoyer', chatConfirm: 'Oui, c\'est ça', chatAdd: 'Compléter…', chatThinking: 'Aaron réfléchit…', chatFromDoc: 'D\'après ton document, voici ce que je comprends :', chatIntro: 'Réponds avec tes mots, ou pose-moi une question si quelque chose n\'est pas clair.', chatErr: 'Aaron n\'a pas pu répondre, réessaie.',
    availTitle: 'Quand es-tu disponible pour un rendez-vous ?', availLead: 'Aaron ne proposera que ces créneaux à tes prospects, et confirmera les rendez-vous tout seul quand ils tombent dedans. Tu pourras les changer à tout moment dans l\'Agenda.', availTypes: 'Types de rendez-vous que tu acceptes', availSave: 'Enregistrer mes disponibilités', availSaving: 'Enregistrement…', availFrom: 'de', availTo: 'à', typeVisio: 'Visio', typeTel: 'Téléphone', typePhysique: 'Sur place', availErr: 'Impossible d\'enregistrer, réessaie.',
    stepOf: 'Étape {n} sur {total}', skip: 'Passer', later: 'Reprendre plus tard', next: 'Suivant', back: 'Précédent', start: "C'est parti",
    introTitle: 'Bienvenue{name} ! Voici comment Aaron travaille pour toi', introLead: 'Trois minutes de réglages, puis Aaron prend le relais.',
    c1t: 'Aaron trouve', c1b: 'Il cherche les entreprises qui correspondent à tes clients idéaux.',
    c2t: 'Aaron écrit', c2b: 'Il rédige des emails personnalisés, dans ton style, à partir de ce qu’il sait de chaque entreprise.',
    c3t: 'Aaron relance', c3b: 'Il suit les réponses et relance au bon moment, sans que tu y penses.',
    c4t: 'Tu valides', c4b: 'Tu gardes la main sur chaque décision importante : rendez-vous, devis, envois sensibles.',
    companyTitle: 'Ton entreprise', companyLead: 'Ces réponses servent à Aaron pour parler de toi comme toi. C’est une seule fois.',
    docTitle: 'Tu as déjà une présentation ?', docBody: 'Dépose-la (PDF, Word ou RTF) : Aaron pré-remplit les réponses, tu n’as plus qu’à relire.',
    docButton: 'Déposer un document', docReading: 'Aaron lit ton document…', docFilled: 'Aaron a pré-rempli {n} réponses sur {total}. Relis-les, corrige si besoin, et valide.',
    docNone: 'Aaron n’a pas trouvé de réponse dans ce document. Pas grave : réponds simplement aux questions.',
    docError: 'Impossible de lire ce document. Essaie un PDF ou un Word (.docx), ou réponds directement.',
    question: 'Question {n} sur {total}', placeholder: 'Ta réponse…', validate: 'Valider', skipQuestion: 'Passer cette question',
    halfway: 'La moitié du chemin ! Tes réponses rendent déjà Aaron bien plus précis.', almost: 'On a bientôt fini, plus que quelques questions.',
    prefilled: 'Pré-rempli par Aaron d’après ton document', suggestions: 'Idées de réponse',
    summarizing: 'Aaron rédige ta fiche entreprise…', summarizingHint: 'Ça prend une vingtaine de secondes.',
    summaryError: 'La fiche n’a pas pu être générée. Tu pourras la relancer depuis Mon entreprise.',
    exTitle: "À quoi ça ressemblera",
    exLead: "Trois fiches d'exemple, inventées pour te montrer le principe : Aaron trouve l'entreprise, la bonne personne, et prépare le premier email. Les vraies arriveront dès le lancement.",
    exTag: "Exemple",
    exFound: "trouvée par Aaron",
    exDraftTitle: "Exemple de premier email",
    exDraft: "Bonjour Camille, j'ai vu que Dupont Menuiserie venait d'ouvrir un second atelier à Nantes. À ce stade, le suivi des devis devient vite le goulot — c'est exactement ce qu'on règle chez nos clients du bâtiment. Dix minutes mardi ou jeudi pour voir si ça vous concerne ?",
    ex: [["Camille Rousseau", "Dupont Menuiserie", "Gérante"], ["Yann Lefebvre", "Atelier Lefebvre & Fils", "Directeur commercial"], ["Inès Martin", "Martin Agencement", "Responsable achats"]],
    campaignTitle: 'Ta première campagne', campaignLead: 'Aaron l’a préparée d’après tes réponses. Vérifie, corrige si besoin, et choisis combien d’entreprises contacter.',
    campaignLoading: 'Aaron prépare ta campagne…', hintTitle: 'En une phrase : tu vends quoi, et à qui ?', hintPlaceholder: 'Ex. : des portes de garage motorisées, à des promoteurs immobiliers en Gironde',
    hintGo: 'Préparer ma campagne', zone: 'Zone', zonePlaceholder: 'Ville, région ou pays', sectors: 'Types d’entreprises à contacter', sectorsPlaceholder: 'Séparés par des virgules',
    sizes: 'Taille des entreprises', role: 'Personne à contacter', anyRole: 'Peu importe', count: 'Nombre d’entreprises', notes: 'Note pour Aaron (facultatif)',
    launch: 'Lancer ma campagne', launching: 'Lancement…', campaignError: 'La campagne n’a pas pu être créée. Réessaie, ou passe : tu la créeras depuis Campagnes.',
    quotaError: 'Ton quota de prospects du mois est atteint : tu pourras lancer la campagne depuis Campagnes.',
    mailboxTitle: 'Ta boîte mail', mailboxLead: 'Aaron envoie depuis TA boîte, comme si c’était toi. C’est la seule chose dont il a besoin pour que ta campagne parte.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Autre boîte (OVH, Ionos, Infomaniak…)',
    calendarNote: 'Avec Google ou Microsoft, tes rendez-vous arrivent directement dans ton agenda, et donc sur ton téléphone.',
    connected: 'Boîte mail liée', connecting: 'Redirection…', mailboxError: 'La liaison n’a pas abouti. Réessaie, ou passe : tu pourras le faire depuis Mon compte.',
    endTitle: 'C’est prêt', endGo: 'Aller au tableau de bord',
    endAllGood: 'Ta campagne part dès maintenant. Aaron te prévient dès qu’un prospect répond.',
    endNeedMailbox: 'Ta campagne est prête : elle partira dès que ta boîte mail sera liée (Mon compte, onglet Connexion).',
    endNoCampaign: 'Crée ta première campagne quand tu veux, depuis la page Campagnes.',
    endInvited: 'Ton espace est prêt. Ton entreprise a déjà sa fiche : Aaron sait de quoi parler.',
    endChecklist: 'Sur le tableau de bord, une petite liste t’attend pour les derniers réglages (notifications). Elle disparaît une fois complète.',
    saveError: 'Connexion perdue : ta réponse n’a pas été enregistrée. Réessaie.',
  },
  en: {
    chatSend: 'Send', chatConfirm: 'Yes, that\'s it', chatAdd: 'Add something…', chatThinking: 'Aaron is thinking…', chatFromDoc: 'From your document, here is what I understand:', chatIntro: 'Answer in your own words, or ask me a question if something is unclear.', chatErr: 'Aaron could not answer, please try again.',
    availTitle: 'When are you available for a meeting?', availLead: 'Aaron will only offer these time slots to your prospects, and will confirm meetings on his own when they fall inside them. You can change them any time in the Calendar.', availTypes: 'Meeting types you accept', availSave: 'Save my availability', availSaving: 'Saving…', availFrom: 'from', availTo: 'to', typeVisio: 'Video call', typeTel: 'Phone', typePhysique: 'In person', availErr: 'Could not save, please try again.',
    stepOf: 'Step {n} of {total}', skip: 'Skip', later: 'Continue later', next: 'Next', back: 'Back', start: "Let's go",
    introTitle: 'Welcome{name}! Here is how Aaron works for you', introLead: 'Three minutes of setup, then Aaron takes over.',
    c1t: 'Aaron finds', c1b: 'He looks for companies that match your ideal clients.',
    c2t: 'Aaron writes', c2b: 'He writes personalised emails in your style, based on what he knows about each company.',
    c3t: 'Aaron follows up', c3b: 'He tracks replies and follows up at the right time, without you thinking about it.',
    c4t: 'You approve', c4b: 'You stay in control of every important decision: meetings, quotes, sensitive emails.',
    companyTitle: 'Your company', companyLead: 'Aaron uses these answers to talk about you the way you would. You only do this once.',
    docTitle: 'Already have a presentation?', docBody: 'Drop it here (PDF, Word or RTF): Aaron pre-fills the answers, you just review them.',
    docButton: 'Upload a document', docReading: 'Aaron is reading your document…', docFilled: 'Aaron pre-filled {n} of {total} answers. Review them, edit if needed, and confirm.',
    docNone: 'Aaron found no answers in this document. No problem: just answer the questions.',
    docError: 'This document could not be read. Try a PDF or Word (.docx) file, or answer directly.',
    question: 'Question {n} of {total}', placeholder: 'Your answer…', validate: 'Confirm', skipQuestion: 'Skip this question',
    halfway: 'Halfway there! Your answers already make Aaron much sharper.', almost: 'Almost done, just a few questions left.',
    prefilled: 'Pre-filled by Aaron from your document', suggestions: 'Answer ideas',
    summarizing: 'Aaron is writing your company profile…', summarizingHint: 'This takes about twenty seconds.',
    summaryError: 'The profile could not be generated. You can retry from My company.',
    exTitle: "What it will look like",
    exLead: "Three example cards, made up to show the principle: Aaron finds the company, the right person, and drafts the first email. The real ones arrive as soon as you launch.",
    exTag: "Example",
    exFound: "found by Aaron",
    exDraftTitle: "Example first email",
    exDraft: "Hello Emma, I saw that Harper Joinery just opened a second workshop in Leeds. At that stage, quote follow-up quickly becomes the bottleneck — exactly what we fix for our clients in construction. Ten minutes on Tuesday or Thursday to see if it applies to you?",
    ex: [["Emma Harper", "Harper Joinery", "Owner"], ["Liam Walker", "Walker & Sons Workshop", "Sales director"], ["Chloe Bennett", "Bennett Fit-outs", "Purchasing manager"]],
    campaignTitle: 'Your first campaign', campaignLead: 'Aaron prepared it from your answers. Check it, edit if needed, and choose how many companies to contact.',
    campaignLoading: 'Aaron is preparing your campaign…', hintTitle: 'In one sentence: what do you sell, and to whom?', hintPlaceholder: 'E.g. motorised garage doors, to property developers in Bristol',
    hintGo: 'Prepare my campaign', zone: 'Area', zonePlaceholder: 'City, region or country', sectors: 'Types of companies to contact', sectorsPlaceholder: 'Comma-separated',
    sizes: 'Company size', role: 'Person to contact', anyRole: 'Anyone', count: 'Number of companies', notes: 'Note for Aaron (optional)',
    launch: 'Launch my campaign', launching: 'Launching…', campaignError: 'The campaign could not be created. Try again, or skip: you can create it from Campaigns.',
    quotaError: 'Your monthly prospect quota is reached: you can launch the campaign from Campaigns.',
    mailboxTitle: 'Your mailbox', mailboxLead: 'Aaron sends from YOUR mailbox, as if it were you. It is the only thing he needs for your campaign to go out.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Other mailbox (IMAP)',
    calendarNote: 'With Google or Microsoft, your meetings go straight into your calendar, and so onto your phone.',
    connected: 'Mailbox connected', connecting: 'Redirecting…', mailboxError: 'The connection did not complete. Try again, or skip: you can do it from My account.',
    endTitle: 'You are all set', endGo: 'Go to the dashboard',
    endAllGood: 'Your campaign starts now. Aaron tells you as soon as a prospect replies.',
    endNeedMailbox: 'Your campaign is ready: it will go out as soon as your mailbox is connected (My account, Connection tab).',
    endNoCampaign: 'Create your first campaign whenever you like, from the Campaigns page.',
    endInvited: 'Your space is ready. Your company already has its profile: Aaron knows what to talk about.',
    endChecklist: 'On the dashboard, a short list is waiting for the last settings (notifications). It disappears once complete.',
    saveError: 'Connection lost: your answer was not saved. Please try again.',
  },
  de: {
    chatSend: 'Senden', chatConfirm: 'Ja, genau', chatAdd: 'Ergänzen…', chatThinking: 'Aaron überlegt…', chatFromDoc: 'Aus deinem Dokument verstehe ich Folgendes:', chatIntro: 'Antworte in deinen Worten oder stell mir eine Frage, wenn etwas unklar ist.', chatErr: 'Aaron konnte nicht antworten, bitte versuche es erneut.',
    availTitle: 'Wann sind Sie für einen Termin erreichbar?', availLead: 'Aaron schlägt Ihren Interessenten nur diese Zeitfenster vor und bestätigt Termine selbstständig, wenn sie hineinfallen. Sie können sie jederzeit im Kalender ändern.', availTypes: 'Terminarten, die Sie akzeptieren', availSave: 'Verfügbarkeit speichern', availSaving: 'Wird gespeichert…', availFrom: 'von', availTo: 'bis', typeVisio: 'Videoanruf', typeTel: 'Telefon', typePhysique: 'Vor Ort', availErr: 'Speichern nicht möglich, bitte erneut versuchen.',
    stepOf: 'Schritt {n} von {total}', skip: 'Überspringen', later: 'Später fortsetzen', next: 'Weiter', back: 'Zurück', start: 'Los geht’s',
    introTitle: 'Willkommen{name}! So arbeitet Aaron für Sie', introLead: 'Drei Minuten Einrichtung, dann übernimmt Aaron.',
    c1t: 'Aaron findet', c1b: 'Er sucht Unternehmen, die zu Ihren idealen Kunden passen.',
    c2t: 'Aaron schreibt', c2b: 'Er verfasst persönliche E-Mails in Ihrem Stil, auf Basis dessen, was er über jedes Unternehmen weiß.',
    c3t: 'Aaron fasst nach', c3b: 'Er verfolgt Antworten und fasst im richtigen Moment nach, ohne dass Sie daran denken müssen.',
    c4t: 'Sie geben frei', c4b: 'Sie behalten jede wichtige Entscheidung in der Hand: Termine, Angebote, heikle E-Mails.',
    companyTitle: 'Ihr Unternehmen', companyLead: 'Mit diesen Antworten spricht Aaron über Sie so, wie Sie es tun würden. Das machen Sie nur einmal.',
    docTitle: 'Sie haben schon eine Präsentation?', docBody: 'Laden Sie sie hoch (PDF, Word oder RTF): Aaron füllt die Antworten vor, Sie prüfen nur noch.',
    docButton: 'Dokument hochladen', docReading: 'Aaron liest Ihr Dokument…', docFilled: 'Aaron hat {n} von {total} Antworten vorausgefüllt. Prüfen, bei Bedarf korrigieren und bestätigen.',
    docNone: 'Aaron hat in diesem Dokument keine Antworten gefunden. Kein Problem: Beantworten Sie einfach die Fragen.',
    docError: 'Dieses Dokument konnte nicht gelesen werden. Versuchen Sie PDF oder Word (.docx), oder antworten Sie direkt.',
    question: 'Frage {n} von {total}', placeholder: 'Ihre Antwort…', validate: 'Bestätigen', skipQuestion: 'Frage überspringen',
    halfway: 'Halbzeit! Ihre Antworten machen Aaron schon deutlich treffsicherer.', almost: 'Gleich geschafft, nur noch wenige Fragen.',
    prefilled: 'Von Aaron aus Ihrem Dokument vorausgefüllt', suggestions: 'Antwortideen',
    summarizing: 'Aaron schreibt Ihr Unternehmensprofil…', summarizingHint: 'Das dauert etwa zwanzig Sekunden.',
    summaryError: 'Das Profil konnte nicht erstellt werden. Sie können es unter Mein Unternehmen erneut starten.',
    exTitle: "So wird es aussehen",
    exLead: "Drei Beispielkarten, erfunden, um das Prinzip zu zeigen: Aaron findet das Unternehmen, die richtige Person und bereitet die erste E-Mail vor. Die echten kommen ab dem Start.",
    exTag: "Beispiel",
    exFound: "von Aaron gefunden",
    exDraftTitle: "Beispiel einer ersten E-Mail",
    exDraft: "Guten Tag Frau Keller, ich habe gesehen, dass Keller Schreinerei gerade eine zweite Werkstatt in Köln eröffnet hat. In dieser Phase wird die Angebotsnachverfolgung schnell zum Engpass — genau das lösen wir für unsere Kunden im Bau. Zehn Minuten am Dienstag oder Donnerstag, um zu sehen, ob es Sie betrifft?",
    ex: [["Anna Keller", "Keller Schreinerei", "Geschäftsführerin"], ["Jonas Weber", "Weber & Söhne Werkstatt", "Vertriebsleiter"], ["Lena Fischer", "Fischer Innenausbau", "Einkaufsleiterin"]],
    campaignTitle: 'Ihre erste Kampagne', campaignLead: 'Aaron hat sie anhand Ihrer Antworten vorbereitet. Prüfen, bei Bedarf korrigieren und die Anzahl der Unternehmen wählen.',
    campaignLoading: 'Aaron bereitet Ihre Kampagne vor…', hintTitle: 'In einem Satz: Was verkaufen Sie, und an wen?', hintPlaceholder: 'Z. B. motorisierte Garagentore an Bauträger in Bayern',
    hintGo: 'Kampagne vorbereiten', zone: 'Gebiet', zonePlaceholder: 'Stadt, Region oder Land', sectors: 'Branchen, die kontaktiert werden', sectorsPlaceholder: 'Durch Kommas getrennt',
    sizes: 'Unternehmensgröße', role: 'Ansprechperson', anyRole: 'Egal', count: 'Anzahl Unternehmen', notes: 'Notiz für Aaron (optional)',
    launch: 'Kampagne starten', launching: 'Wird gestartet…', campaignError: 'Die Kampagne konnte nicht erstellt werden. Erneut versuchen oder überspringen: Sie können sie unter Kampagnen anlegen.',
    quotaError: 'Ihr monatliches Interessenten-Kontingent ist erreicht: Sie können die Kampagne unter Kampagnen starten.',
    mailboxTitle: 'Ihr E-Mail-Postfach', mailboxLead: 'Aaron sendet aus IHREM Postfach, als wären Sie es. Mehr braucht er nicht, damit Ihre Kampagne startet.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Anderes Postfach (IMAP)',
    calendarNote: 'Mit Google oder Microsoft landen Ihre Termine direkt in Ihrem Kalender, und damit auf Ihrem Telefon.',
    connected: 'Postfach verbunden', connecting: 'Weiterleitung…', mailboxError: 'Die Verbindung wurde nicht abgeschlossen. Erneut versuchen oder überspringen: Sie können es unter Mein Konto erledigen.',
    endTitle: 'Alles bereit', endGo: 'Zum Dashboard',
    endAllGood: 'Ihre Kampagne startet jetzt. Aaron meldet sich, sobald ein Interessent antwortet.',
    endNeedMailbox: 'Ihre Kampagne ist bereit: Sie startet, sobald Ihr Postfach verbunden ist (Mein Konto, Reiter Verbindung).',
    endNoCampaign: 'Erstellen Sie Ihre erste Kampagne, wann Sie möchten, auf der Seite Kampagnen.',
    endInvited: 'Ihr Bereich ist bereit. Ihr Unternehmen hat bereits sein Profil: Aaron weiß, worüber er spricht.',
    endChecklist: 'Im Dashboard wartet eine kurze Liste mit den letzten Einstellungen (Benachrichtigungen). Sie verschwindet, sobald alles erledigt ist.',
    saveError: 'Verbindung verloren: Ihre Antwort wurde nicht gespeichert. Bitte erneut versuchen.',
  },
  it: {
    chatSend: 'Invia', chatConfirm: 'Sì, è così', chatAdd: 'Aggiungi qualcosa…', chatThinking: 'Aaron sta pensando…', chatFromDoc: 'Dal tuo documento, ecco cosa capisco:', chatIntro: 'Rispondi con parole tue, o fammi una domanda se qualcosa non è chiaro.', chatErr: 'Aaron non ha potuto rispondere, riprova.',
    availTitle: 'Quando sei disponibile per un appuntamento?', availLead: 'Aaron proporrà ai tuoi prospect solo queste fasce orarie e confermerà da solo gli appuntamenti che vi rientrano. Potrai cambiarle in qualsiasi momento nell\'Agenda.', availTypes: 'Tipi di appuntamento che accetti', availSave: 'Salva le mie disponibilità', availSaving: 'Salvataggio…', availFrom: 'dalle', availTo: 'alle', typeVisio: 'Videochiamata', typeTel: 'Telefono', typePhysique: 'Di persona', availErr: 'Impossibile salvare, riprova.',
    stepOf: 'Passo {n} di {total}', skip: 'Salta', later: 'Riprendi più tardi', next: 'Avanti', back: 'Indietro', start: 'Iniziamo',
    introTitle: 'Benvenuto{name}! Ecco come lavora Aaron per te', introLead: 'Tre minuti di impostazioni, poi ci pensa Aaron.',
    c1t: 'Aaron trova', c1b: 'Cerca le aziende che corrispondono ai tuoi clienti ideali.',
    c2t: 'Aaron scrive', c2b: 'Scrive email personalizzate nel tuo stile, partendo da ciò che sa di ogni azienda.',
    c3t: 'Aaron sollecita', c3b: 'Segue le risposte e sollecita al momento giusto, senza che tu ci debba pensare.',
    c4t: 'Tu approvi', c4b: 'Mantieni il controllo su ogni decisione importante: appuntamenti, preventivi, invii delicati.',
    companyTitle: 'La tua azienda', companyLead: 'Aaron usa queste risposte per parlare di te come faresti tu. Lo fai una volta sola.',
    docTitle: 'Hai già una presentazione?', docBody: 'Caricala (PDF, Word o RTF): Aaron precompila le risposte, tu devi solo rileggerle.',
    docButton: 'Carica un documento', docReading: 'Aaron sta leggendo il documento…', docFilled: 'Aaron ha precompilato {n} risposte su {total}. Rileggile, correggi se serve e conferma.',
    docNone: 'Aaron non ha trovato risposte in questo documento. Nessun problema: rispondi semplicemente alle domande.',
    docError: 'Impossibile leggere questo documento. Prova con un PDF o un Word (.docx), oppure rispondi direttamente.',
    question: 'Domanda {n} di {total}', placeholder: 'La tua risposta…', validate: 'Conferma', skipQuestion: 'Salta questa domanda',
    halfway: 'Sei a metà strada! Le tue risposte rendono già Aaron molto più preciso.', almost: 'Abbiamo quasi finito, mancano poche domande.',
    prefilled: 'Precompilato da Aaron dal tuo documento', suggestions: 'Idee di risposta',
    summarizing: 'Aaron sta scrivendo la scheda della tua azienda…', summarizingHint: 'Ci vogliono una ventina di secondi.',
    summaryError: 'Non è stato possibile generare la scheda. Potrai riprovare da La mia azienda.',
    exTitle: "Come sarà",
    exLead: "Tre schede di esempio, inventate per mostrare il principio: Aaron trova l'azienda, la persona giusta e prepara la prima email. Quelle vere arriveranno dal lancio.",
    exTag: "Esempio",
    exFound: "trovata da Aaron",
    exDraftTitle: "Esempio di prima email",
    exDraft: "Buongiorno Giulia, ho visto che Rossi Falegnameria ha appena aperto un secondo laboratorio a Torino. A questo punto il seguito dei preventivi diventa presto il collo di bottiglia — è esattamente ciò che risolviamo per i nostri clienti dell'edilizia. Dieci minuti martedì o giovedì per capire se vi riguarda?",
    ex: [["Giulia Rossi", "Rossi Falegnameria", "Titolare"], ["Marco Bianchi", "Bianchi & Figli", "Direttore commerciale"], ["Sara Conti", "Conti Arredamenti", "Responsabile acquisti"]],
    campaignTitle: 'La tua prima campagna', campaignLead: 'Aaron l’ha preparata dalle tue risposte. Controlla, correggi se serve e scegli quante aziende contattare.',
    campaignLoading: 'Aaron sta preparando la campagna…', hintTitle: 'In una frase: cosa vendi, e a chi?', hintPlaceholder: 'Es.: porte da garage motorizzate, a costruttori immobiliari in Lombardia',
    hintGo: 'Prepara la mia campagna', zone: 'Zona', zonePlaceholder: 'Città, regione o paese', sectors: 'Tipi di aziende da contattare', sectorsPlaceholder: 'Separati da virgole',
    sizes: 'Dimensione delle aziende', role: 'Persona da contattare', anyRole: 'Non importa', count: 'Numero di aziende', notes: 'Nota per Aaron (facoltativa)',
    launch: 'Avvia la campagna', launching: 'Avvio…', campaignError: 'Non è stato possibile creare la campagna. Riprova, oppure salta: potrai crearla da Campagne.',
    quotaError: 'Hai raggiunto la quota mensile di prospect: potrai avviare la campagna da Campagne.',
    mailboxTitle: 'La tua casella email', mailboxLead: 'Aaron invia dalla TUA casella, come se fossi tu. È l’unica cosa di cui ha bisogno perché la campagna parta.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Altra casella (IMAP)',
    calendarNote: 'Con Google o Microsoft, gli appuntamenti arrivano direttamente nel tuo calendario, quindi anche sul telefono.',
    connected: 'Casella collegata', connecting: 'Reindirizzamento…', mailboxError: 'Il collegamento non è andato a buon fine. Riprova, oppure salta: potrai farlo da Il mio account.',
    endTitle: 'È tutto pronto', endGo: 'Vai alla dashboard',
    endAllGood: 'La tua campagna parte adesso. Aaron ti avvisa appena un prospect risponde.',
    endNeedMailbox: 'La tua campagna è pronta: partirà appena la casella email sarà collegata (Il mio account, scheda Connessione).',
    endNoCampaign: 'Crea la tua prima campagna quando vuoi, dalla pagina Campagne.',
    endInvited: 'Il tuo spazio è pronto. La tua azienda ha già la sua scheda: Aaron sa di cosa parlare.',
    endChecklist: 'Nella dashboard ti aspetta una breve lista per gli ultimi ritocchi (notifiche). Sparisce una volta completata.',
    saveError: 'Connessione persa: la risposta non è stata salvata. Riprova.',
  },
  es: {
    chatSend: 'Enviar', chatConfirm: 'Sí, es eso', chatAdd: 'Añadir algo…', chatThinking: 'Aaron está pensando…', chatFromDoc: 'Según tu documento, esto es lo que entiendo:', chatIntro: 'Responde con tus palabras o hazme una pregunta si algo no está claro.', chatErr: 'Aaron no ha podido responder, inténtalo de nuevo.',
    availTitle: '¿Cuándo estás disponible para una reunión?', availLead: 'Aaron solo propondrá estos horarios a tus prospectos y confirmará las reuniones por sí mismo cuando caigan dentro. Puedes cambiarlos en cualquier momento en la Agenda.', availTypes: 'Tipos de reunión que aceptas', availSave: 'Guardar mi disponibilidad', availSaving: 'Guardando…', availFrom: 'de', availTo: 'a', typeVisio: 'Videollamada', typeTel: 'Teléfono', typePhysique: 'Presencial', availErr: 'No se ha podido guardar, inténtalo de nuevo.',
    stepOf: 'Paso {n} de {total}', skip: 'Omitir', later: 'Continuar más tarde', next: 'Siguiente', back: 'Atrás', start: 'Empezar',
    introTitle: '¡Bienvenido{name}! Así trabaja Aaron para ti', introLead: 'Tres minutos de ajustes y Aaron toma el relevo.',
    c1t: 'Aaron encuentra', c1b: 'Busca las empresas que encajan con tus clientes ideales.',
    c2t: 'Aaron escribe', c2b: 'Redacta emails personalizados con tu estilo, a partir de lo que sabe de cada empresa.',
    c3t: 'Aaron hace seguimiento', c3b: 'Sigue las respuestas y vuelve a escribir en el momento justo, sin que tengas que pensarlo.',
    c4t: 'Tú validas', c4b: 'Mantienes el control de cada decisión importante: reuniones, presupuestos, envíos delicados.',
    companyTitle: 'Tu empresa', companyLead: 'Aaron usa estas respuestas para hablar de ti como lo harías tú. Solo se hace una vez.',
    docTitle: '¿Ya tienes una presentación?', docBody: 'Súbela (PDF, Word o RTF): Aaron rellena las respuestas y tú solo las revisas.',
    docButton: 'Subir un documento', docReading: 'Aaron está leyendo tu documento…', docFilled: 'Aaron ha rellenado {n} de {total} respuestas. Revísalas, corrige si hace falta y valida.',
    docNone: 'Aaron no encontró respuestas en este documento. No pasa nada: responde a las preguntas.',
    docError: 'No se pudo leer este documento. Prueba con un PDF o un Word (.docx), o responde directamente.',
    question: 'Pregunta {n} de {total}', placeholder: 'Tu respuesta…', validate: 'Validar', skipQuestion: 'Omitir esta pregunta',
    halfway: '¡Mitad del camino! Tus respuestas ya hacen a Aaron mucho más preciso.', almost: 'Casi terminamos, quedan pocas preguntas.',
    prefilled: 'Rellenado por Aaron a partir de tu documento', suggestions: 'Ideas de respuesta',
    summarizing: 'Aaron está redactando la ficha de tu empresa…', summarizingHint: 'Tarda unos veinte segundos.',
    summaryError: 'No se pudo generar la ficha. Podrás relanzarla desde Mi empresa.',
    exTitle: "Así se verá",
    exLead: "Tres fichas de ejemplo, inventadas para mostrar el principio: Aaron encuentra la empresa, la persona adecuada y prepara el primer correo. Las reales llegarán en cuanto lances.",
    exTag: "Ejemplo",
    exFound: "encontrada por Aaron",
    exDraftTitle: "Ejemplo de primer correo",
    exDraft: "Hola Lucía, he visto que Carpintería García acaba de abrir un segundo taller en Valencia. En esa etapa, el seguimiento de presupuestos se convierte rápido en el cuello de botella — justo lo que resolvemos para nuestros clientes de la construcción. ¿Diez minutos el martes o el jueves para ver si os aplica?",
    ex: [["Lucía García", "Carpintería García", "Gerente"], ["Pablo Martín", "Taller Martín e Hijos", "Director comercial"], ["Marta López", "López Interiorismo", "Responsable de compras"]],
    campaignTitle: 'Tu primera campaña', campaignLead: 'Aaron la ha preparado con tus respuestas. Revisa, corrige si hace falta y elige cuántas empresas contactar.',
    campaignLoading: 'Aaron está preparando tu campaña…', hintTitle: 'En una frase: ¿qué vendes y a quién?', hintPlaceholder: 'Ej.: puertas de garaje motorizadas, a promotores inmobiliarios en Valencia',
    hintGo: 'Preparar mi campaña', zone: 'Zona', zonePlaceholder: 'Ciudad, región o país', sectors: 'Tipos de empresas a contactar', sectorsPlaceholder: 'Separados por comas',
    sizes: 'Tamaño de las empresas', role: 'Persona a contactar', anyRole: 'Da igual', count: 'Número de empresas', notes: 'Nota para Aaron (opcional)',
    launch: 'Lanzar mi campaña', launching: 'Lanzando…', campaignError: 'No se pudo crear la campaña. Reinténtalo u omítelo: podrás crearla desde Campañas.',
    quotaError: 'Has alcanzado la cuota mensual de prospectos: podrás lanzar la campaña desde Campañas.',
    mailboxTitle: 'Tu buzón de correo', mailboxLead: 'Aaron envía desde TU buzón, como si fueras tú. Es lo único que necesita para que tu campaña salga.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Otro buzón (IMAP)',
    calendarNote: 'Con Google o Microsoft, tus reuniones llegan directamente a tu calendario, y por tanto a tu móvil.',
    connected: 'Buzón conectado', connecting: 'Redirigiendo…', mailboxError: 'La conexión no se completó. Reinténtalo u omítelo: podrás hacerlo desde Mi cuenta.',
    endTitle: 'Todo listo', endGo: 'Ir al panel',
    endAllGood: 'Tu campaña empieza ahora. Aaron te avisa en cuanto un prospecto responda.',
    endNeedMailbox: 'Tu campaña está lista: saldrá en cuanto conectes tu buzón (Mi cuenta, pestaña Conexión).',
    endNoCampaign: 'Crea tu primera campaña cuando quieras, desde la página Campañas.',
    endInvited: 'Tu espacio está listo. Tu empresa ya tiene su ficha: Aaron sabe de qué hablar.',
    endChecklist: 'En el panel te espera una pequeña lista con los últimos ajustes (notificaciones). Desaparece una vez completa.',
    saveError: 'Conexión perdida: tu respuesta no se guardó. Inténtalo de nuevo.',
  },
  pt: {
    chatSend: 'Enviar', chatConfirm: 'Sim, é isso', chatAdd: 'Acrescentar…', chatThinking: 'O Aaron está a pensar…', chatFromDoc: 'Pelo teu documento, é isto que percebo:', chatIntro: 'Responde com as tuas palavras, ou faz-me uma pergunta se algo não estiver claro.', chatErr: 'O Aaron não conseguiu responder, tenta de novo.',
    availTitle: 'Quando estás disponível para uma reunião?', availLead: 'O Aaron só vai propor estes horários aos teus prospetos e confirma as reuniões sozinho quando caem dentro deles. Podes alterá-los a qualquer momento na Agenda.', availTypes: 'Tipos de reunião que aceitas', availSave: 'Guardar a minha disponibilidade', availSaving: 'A guardar…', availFrom: 'das', availTo: 'às', typeVisio: 'Videochamada', typeTel: 'Telefone', typePhysique: 'Presencial', availErr: 'Não foi possível guardar, tenta de novo.',
    stepOf: 'Passo {n} de {total}', skip: 'Saltar', later: 'Continuar mais tarde', next: 'Seguinte', back: 'Anterior', start: 'Vamos lá',
    introTitle: 'Bem-vindo{name}! Eis como o Aaron trabalha para ti', introLead: 'Três minutos de configuração, depois o Aaron trata do resto.',
    c1t: 'O Aaron encontra', c1b: 'Procura as empresas que correspondem aos teus clientes ideais.',
    c2t: 'O Aaron escreve', c2b: 'Redige emails personalizados no teu estilo, a partir do que sabe de cada empresa.',
    c3t: 'O Aaron faz seguimento', c3b: 'Acompanha as respostas e volta a escrever no momento certo, sem teres de pensar nisso.',
    c4t: 'Tu validas', c4b: 'Manténs o controlo de cada decisão importante: reuniões, orçamentos, envios sensíveis.',
    companyTitle: 'A tua empresa', companyLead: 'O Aaron usa estas respostas para falar de ti como tu falarias. Só se faz uma vez.',
    docTitle: 'Já tens uma apresentação?', docBody: 'Carrega-a (PDF, Word ou RTF): o Aaron pré-preenche as respostas, só tens de as rever.',
    docButton: 'Carregar um documento', docReading: 'O Aaron está a ler o teu documento…', docFilled: 'O Aaron pré-preencheu {n} de {total} respostas. Revê, corrige se for preciso e valida.',
    docNone: 'O Aaron não encontrou respostas neste documento. Não faz mal: responde às perguntas.',
    docError: 'Não foi possível ler este documento. Experimenta um PDF ou um Word (.docx), ou responde diretamente.',
    question: 'Pergunta {n} de {total}', placeholder: 'A tua resposta…', validate: 'Validar', skipQuestion: 'Saltar esta pergunta',
    halfway: 'A meio caminho! As tuas respostas já tornam o Aaron muito mais preciso.', almost: 'Estamos quase, faltam poucas perguntas.',
    prefilled: 'Pré-preenchido pelo Aaron a partir do teu documento', suggestions: 'Ideias de resposta',
    summarizing: 'O Aaron está a redigir a ficha da tua empresa…', summarizingHint: 'Demora cerca de vinte segundos.',
    summaryError: 'Não foi possível gerar a ficha. Podes voltar a tentar em A minha empresa.',
    exTitle: "Como vai ficar",
    exLead: "Três fichas de exemplo, inventadas para mostrar o princípio: o Aaron encontra a empresa, a pessoa certa e prepara o primeiro email. As verdadeiras chegam assim que lançares.",
    exTag: "Exemplo",
    exFound: "encontrada pelo Aaron",
    exDraftTitle: "Exemplo de primeiro email",
    exDraft: "Olá Beatriz, vi que a Carpintaria Silva acabou de abrir uma segunda oficina no Porto. Nessa fase, o seguimento dos orçamentos torna-se rapidamente o estrangulamento — é exatamente o que resolvemos para os nossos clientes da construção. Dez minutos na terça ou na quinta para ver se vos diz respeito?",
    ex: [["Beatriz Silva", "Carpintaria Silva", "Gerente"], ["Tiago Costa", "Oficina Costa & Filhos", "Diretor comercial"], ["Inês Pereira", "Pereira Interiores", "Responsável de compras"]],
    campaignTitle: 'A tua primeira campanha', campaignLead: 'O Aaron preparou-a a partir das tuas respostas. Verifica, corrige se for preciso e escolhe quantas empresas contactar.',
    campaignLoading: 'O Aaron está a preparar a tua campanha…', hintTitle: 'Numa frase: o que vendes, e a quem?', hintPlaceholder: 'Ex.: portões de garagem motorizados, a promotores imobiliários em Lisboa',
    hintGo: 'Preparar a minha campanha', zone: 'Zona', zonePlaceholder: 'Cidade, região ou país', sectors: 'Tipos de empresas a contactar', sectorsPlaceholder: 'Separados por vírgulas',
    sizes: 'Dimensão das empresas', role: 'Pessoa a contactar', anyRole: 'Tanto faz', count: 'Número de empresas', notes: 'Nota para o Aaron (opcional)',
    launch: 'Lançar a minha campanha', launching: 'A lançar…', campaignError: 'Não foi possível criar a campanha. Tenta outra vez, ou salta: podes criá-la em Campanhas.',
    quotaError: 'Atingiste a quota mensal de prospects: podes lançar a campanha em Campanhas.',
    mailboxTitle: 'A tua caixa de email', mailboxLead: 'O Aaron envia a partir da TUA caixa, como se fosses tu. É a única coisa de que precisa para a campanha partir.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Outra caixa (IMAP)',
    calendarNote: 'Com Google ou Microsoft, as reuniões vão diretamente para o teu calendário, e portanto para o telemóvel.',
    connected: 'Caixa ligada', connecting: 'A redirecionar…', mailboxError: 'A ligação não foi concluída. Tenta outra vez, ou salta: podes fazê-lo em A minha conta.',
    endTitle: 'Está tudo pronto', endGo: 'Ir para o painel',
    endAllGood: 'A tua campanha começa agora. O Aaron avisa-te assim que um prospect responder.',
    endNeedMailbox: 'A tua campanha está pronta: parte assim que a tua caixa estiver ligada (A minha conta, separador Ligação).',
    endNoCampaign: 'Cria a tua primeira campanha quando quiseres, na página Campanhas.',
    endInvited: 'O teu espaço está pronto. A tua empresa já tem a sua ficha: o Aaron sabe do que falar.',
    endChecklist: 'No painel espera-te uma pequena lista com as últimas configurações (notificações). Desaparece quando estiver completa.',
    saveError: 'Ligação perdida: a resposta não foi guardada. Tenta outra vez.',
  },
  nl: {
    chatSend: 'Versturen', chatConfirm: 'Ja, dat klopt', chatAdd: 'Aanvullen…', chatThinking: 'Aaron denkt na…', chatFromDoc: 'Uit je document begrijp ik het volgende:', chatIntro: 'Antwoord in je eigen woorden, of stel me een vraag als iets niet duidelijk is.', chatErr: 'Aaron kon niet antwoorden, probeer het opnieuw.',
    availTitle: 'Wanneer ben je beschikbaar voor een afspraak?', availLead: 'Aaron stelt je prospects alleen deze tijdsloten voor en bevestigt afspraken zelf wanneer ze erin vallen. Je kunt ze altijd aanpassen in de Agenda.', availTypes: 'Soorten afspraken die je accepteert', availSave: 'Mijn beschikbaarheid opslaan', availSaving: 'Opslaan…', availFrom: 'van', availTo: 'tot', typeVisio: 'Videogesprek', typeTel: 'Telefoon', typePhysique: 'Ter plaatse', availErr: 'Opslaan mislukt, probeer het opnieuw.',
    stepOf: 'Stap {n} van {total}', skip: 'Overslaan', later: 'Later verdergaan', next: 'Volgende', back: 'Terug', start: 'Aan de slag',
    introTitle: 'Welkom{name}! Zo werkt Aaron voor je', introLead: 'Drie minuten instellen, daarna neemt Aaron het over.',
    c1t: 'Aaron zoekt', c1b: 'Hij zoekt bedrijven die passen bij je ideale klanten.',
    c2t: 'Aaron schrijft', c2b: 'Hij schrijft persoonlijke e-mails in jouw stijl, op basis van wat hij over elk bedrijf weet.',
    c3t: 'Aaron volgt op', c3b: 'Hij volgt antwoorden en volgt op het juiste moment op, zonder dat jij eraan hoeft te denken.',
    c4t: 'Jij keurt goed', c4b: 'Jij houdt de regie over elke belangrijke beslissing: afspraken, offertes, gevoelige e-mails.',
    companyTitle: 'Je bedrijf', companyLead: 'Aaron gebruikt deze antwoorden om over jou te praten zoals jij dat zou doen. Je doet dit maar één keer.',
    docTitle: 'Heb je al een presentatie?', docBody: 'Upload hem (PDF, Word of RTF): Aaron vult de antwoorden vooraf in, jij leest ze alleen na.',
    docButton: 'Document uploaden', docReading: 'Aaron leest je document…', docFilled: 'Aaron heeft {n} van de {total} antwoorden ingevuld. Lees ze na, pas aan waar nodig en bevestig.',
    docNone: 'Aaron vond geen antwoorden in dit document. Geen probleem: beantwoord gewoon de vragen.',
    docError: 'Dit document kon niet gelezen worden. Probeer een PDF of Word (.docx), of antwoord direct.',
    question: 'Vraag {n} van {total}', placeholder: 'Je antwoord…', validate: 'Bevestigen', skipQuestion: 'Vraag overslaan',
    halfway: 'Halverwege! Je antwoorden maken Aaron nu al veel scherper.', almost: 'Bijna klaar, nog maar een paar vragen.',
    prefilled: 'Door Aaron ingevuld op basis van je document', suggestions: 'Antwoordideeën',
    summarizing: 'Aaron schrijft je bedrijfsprofiel…', summarizingHint: 'Dit duurt ongeveer twintig seconden.',
    summaryError: 'Het profiel kon niet worden gemaakt. Je kunt het opnieuw starten via Mijn bedrijf.',
    exTitle: "Zo gaat het eruitzien",
    exLead: "Drie voorbeeldkaarten, verzonnen om het principe te tonen: Aaron vindt het bedrijf, de juiste persoon en bereidt de eerste e-mail voor. De echte komen zodra je start.",
    exTag: "Voorbeeld",
    exFound: "gevonden door Aaron",
    exDraftTitle: "Voorbeeld van een eerste e-mail",
    exDraft: "Hallo Sanne, ik zag dat De Vries Timmerwerken net een tweede werkplaats in Utrecht heeft geopend. In die fase wordt het opvolgen van offertes al snel de bottleneck — precies wat we oplossen voor onze klanten in de bouw. Tien minuten dinsdag of donderdag om te kijken of het voor jullie speelt?",
    ex: [["Sanne de Vries", "De Vries Timmerwerken", "Eigenaar"], ["Daan Jansen", "Jansen & Zonen Werkplaats", "Commercieel directeur"], ["Lotte Bakker", "Bakker Interieurbouw", "Inkoopmanager"]],
    campaignTitle: 'Je eerste campagne', campaignLead: 'Aaron heeft hem voorbereid op basis van je antwoorden. Controleer, pas aan waar nodig en kies hoeveel bedrijven je wilt benaderen.',
    campaignLoading: 'Aaron bereidt je campagne voor…', hintTitle: 'In één zin: wat verkoop je, en aan wie?', hintPlaceholder: 'Bijv. gemotoriseerde garagedeuren, aan projectontwikkelaars in Utrecht',
    hintGo: 'Mijn campagne voorbereiden', zone: 'Gebied', zonePlaceholder: 'Stad, regio of land', sectors: 'Soorten bedrijven om te benaderen', sectorsPlaceholder: 'Gescheiden door komma’s',
    sizes: 'Bedrijfsgrootte', role: 'Contactpersoon', anyRole: 'Maakt niet uit', count: 'Aantal bedrijven', notes: 'Notitie voor Aaron (optioneel)',
    launch: 'Campagne starten', launching: 'Starten…', campaignError: 'De campagne kon niet worden aangemaakt. Probeer opnieuw of sla over: je kunt hem aanmaken via Campagnes.',
    quotaError: 'Je maandelijkse prospectquotum is bereikt: je kunt de campagne starten via Campagnes.',
    mailboxTitle: 'Je mailbox', mailboxLead: 'Aaron verstuurt vanuit JOUW mailbox, alsof jij het bent. Meer heeft hij niet nodig om je campagne te laten vertrekken.',
    google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365', other: 'Andere mailbox (IMAP)',
    calendarNote: 'Met Google of Microsoft komen je afspraken direct in je agenda, en dus op je telefoon.',
    connected: 'Mailbox gekoppeld', connecting: 'Doorsturen…', mailboxError: 'De koppeling is niet gelukt. Probeer opnieuw of sla over: je kunt het later doen via Mijn account.',
    endTitle: 'Alles staat klaar', endGo: 'Naar het dashboard',
    endAllGood: 'Je campagne start nu. Aaron laat het je weten zodra een prospect antwoordt.',
    endNeedMailbox: 'Je campagne staat klaar: hij vertrekt zodra je mailbox gekoppeld is (Mijn account, tabblad Verbinding).',
    endNoCampaign: 'Maak je eerste campagne wanneer je wilt, via de pagina Campagnes.',
    endInvited: 'Je omgeving staat klaar. Je bedrijf heeft al een profiel: Aaron weet waarover hij moet praten.',
    endChecklist: 'Op het dashboard wacht een korte lijst met de laatste instellingen (meldingen). Die verdwijnt zodra alles klaar is.',
    saveError: 'Verbinding verloren: je antwoord is niet opgeslagen. Probeer het opnieuw.',
  },
};
const w = (key, locale) => (W[locale] || W.fr)[key] ?? W.fr[key];

const SIZE_KEYS = [
  { key: 'artisan_tpe', labelKey: 'campaigns.sizeArtisanTpe' },
  { key: 'pme', labelKey: 'campaigns.sizePme' },
  { key: 'eti', labelKey: 'campaigns.sizeEti' },
  { key: 'grand_compte', labelKey: 'campaigns.sizeGrandCompte' },
];
const ROLE_KEYS = [
  { key: 'fondateur_dirigeant', labelKey: 'campaigns.roleFondateur' },
  { key: 'responsable_commercial', labelKey: 'campaigns.roleCommercial' },
  { key: 'responsable_achats', labelKey: 'campaigns.roleAchats' },
  { key: 'rh', labelKey: 'campaigns.roleRh' },
];
const COUNTS = [10, 20, 50, 100];
const RETURN_FLAG = 'aaron-welcome-return';
const LATER_FLAG = 'aaron-welcome-later';

function stepsFor(invited) {
  // 'availability' (08/11/2026, demande Alex) : plages du lundi au dimanche et
  // types de rendez-vous, saisis ici plutôt qu'en renvoyant vers l'Agenda.
  return invited ? ['intro', 'mailbox', 'availability', 'end'] : ['intro', 'company', 'campaign', 'mailbox', 'availability', 'end'];
}

export default function BienvenuePage() {
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  const [me, setMe] = useState(null); // { id, company_id }
  const [state, setState] = useState(null); // réponse de GET /api/welcome
  const [step, setStep] = useState('intro');
  const [error, setError] = useState(null);

  // Questionnaire
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { key: texte validé }
  const [drafts, setDrafts] = useState({}); // { key: texte proposé par le document }
  // Envoi du document vers les documents de l'entreprise, attendu avant de
  // construire le profil (24/10/2026) : sinon /api/business-summary pouvait
  // le lire avant qu'il soit enregistré et ne rien produire.
  const docSaveRef = useRef(null);
  const [current, setCurrent] = useState('');
  const [savingAnswer, setSavingAnswer] = useState(false);
  // Conversation avec Aaron sur la question en cours (08/11/2026) :
  // thread = [{ role: 'user'|'aaron', content }], proposal = la réponse
  // nettoyée qu'Aaron propose d'enregistrer, à confirmer ou compléter.
  const [thread, setThread] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const threadEndRef = useRef(null);
  useEffect(() => {
    try { threadEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }, [thread, proposal, chatBusy]);
  const [docStatus, setDocStatus] = useState(null); // null | 'reading' | { filled, total } | 'none' | 'error'
  const [summarizing, setSummarizing] = useState(false);
  const fileRef = useRef(null);

  // Campagne
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [needHint, setNeedHint] = useState(false);
  const [hint, setHint] = useState('');
  const [campaign, setCampaign] = useState(null); // formulaire
  const [launching, setLaunching] = useState(false);
  const [campaignCreated, setCampaignCreated] = useState(false);

  // Boîte mail
  const [connecting, setConnecting] = useState(null);

  const questions = useMemo(() => ONBOARDING_QUESTION_KEYS.map((key) => ({ key, text: t(key, locale) })), [locale]);
  const steps = stepsFor(!!state?.invited);
  const stepNo = Math.max(1, steps.indexOf(step) + 1);

  // ---- Chargement + reprise ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const linkRes = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      if (!linkRes.ok) { router.push(linkRes.status === 404 ? '/onboarding' : '/login'); return; }
      const link = await linkRes.json();
      const res = await fetch('/api/welcome');
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || body.done) {
        router.replace(`/app/campaigns?user_id=${link.user.id}`);
        return;
      }
      setMe({ id: link.user.id, company_id: link.user.company_id });
      try { window.sessionStorage.removeItem(RETURN_FLAG); } catch (e) {}
      const saved = {};
      for (const a of body.answers || []) if (a?.key && a.answer) saved[a.key] = a.answer;
      setAnswers(saved);
      // Un commercial dont l'entreprise n'avait pas de fiche passe par
      // l'écran Entreprise, qui CRÉE la fiche : au rechargement il serait
      // vu comme « invité » et renvoyé au début (relecture 22/10). Une étape
      // enregistrée hors du parcours invité garde donc le parcours complet.
      if (body.invited && body.step && !stepsFor(true).includes(body.step)) body.invited = false;
      const order = stepsFor(!!body.invited);
      const resumeStep = body.step && order.includes(body.step) ? body.step : 'intro';
      const q = Math.min(Math.max(0, body.question || 0), ONBOARDING_QUESTION_KEYS.length - 1);
      setQIndex(q);
      setCurrent(saved[ONBOARDING_QUESTION_KEYS[q]] || '');
      setStep(resumeStep);
      setState(body);
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function save(payload) {
    const res = await fetch('/api/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('save');
  }

  function goTo(next) {
    setError(null);
    setStep(next);
    save({ step: next }).catch(() => {});
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  function nextStep() {
    const i = steps.indexOf(step);
    goTo(steps[Math.min(steps.length - 1, i + 1)]);
  }

  // ---- Disponibilités ----
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const [avail, setAvail] = useState(() => Object.fromEntries(DAY_ORDER.map((d) => [d, { on: d >= 1 && d <= 5, start: '09:00', end: '18:00' }])));
  const [availTypes, setAvailTypes] = useState({ visio: true, telephonique: true, physique: true });
  const [availSaving, setAvailSaving] = useState(false);
  const dayName = (d) => new Date(Date.UTC(2024, 0, 7 + d)).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
  async function saveAvailability() {
    if (!me?.id) { nextStep(); return; }
    setAvailSaving(true);
    setError(null);
    try {
      const types = Object.keys(availTypes).filter((k) => availTypes[k]);
      const allTypes = types.length === 3 || types.length === 0;
      const calls = [];
      for (const d of DAY_ORDER) {
        const row = avail[d];
        if (!row.on || row.start >= row.end) continue;
        for (const type of allTypes ? [null] : types) {
          calls.push(fetch('/api/availability/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: me.id, day_of_week: d, start_time: `${row.start}:00`, end_time: `${row.end}:00`, appointment_type: type }),
          }));
        }
      }
      const results = await Promise.all(calls);
      if (results.some((r) => !r.ok)) throw new Error('save');
      nextStep();
    } catch (e) {
      setError(w('availErr', locale));
    } finally {
      setAvailSaving(false);
    }
  }

  function later() {
    try { window.sessionStorage.setItem(LATER_FLAG, '1'); } catch (e) {}
    router.push(`/app/campaigns?user_id=${me?.id || ''}`);
  }

  // ---- Questionnaire ----
  function showQuestion(i) {
    const key = ONBOARDING_QUESTION_KEYS[i];
    setQIndex(i);
    setCurrent('');
    resetThread(key);
    save({ question: i }).catch(() => {});
  }

  // Nouveau fil pour une question : une réponse déjà enregistrée ou tirée du
  // document est proposée d'emblée (à confirmer ou à compléter).
  function resetThread(key) {
    const known = answers[key] ?? drafts[key] ?? '';
    setThread([]);
    setProposal(known ? known : null);
  }

  async function sendToAaron(text) {
    const q = questions[qIndex];
    const msg = (text || current).trim();
    if (!msg || !q) return;
    const nextThread = [...thread, { role: 'user', content: msg }];
    setThread(nextThread);
    setCurrent('');
    setChatBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_key: q.key,
          question: q.text,
          history: proposal && thread.length === 0 ? [{ role: 'aaron', content: proposal }] : thread,
          message: msg,
          locale,
          draft: drafts[q.key] || null,
          company_name: state?.company_name || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.message) throw new Error(body.error || 'chat');
      setThread([...nextThread, { role: 'aaron', content: body.message }]);
      setProposal(body.kind === 'propose' ? body.proposed_answer : null);
    } catch (e) {
      setError(w('chatErr', locale));
    } finally {
      setChatBusy(false);
    }
  }

  async function validateAnswer(skip = false) {
    const q = questions[qIndex];
    // Ce qui est enregistré : la reformulation d'Aaron confirmée, sinon ce
    // que l'utilisateur a tapé (secours si Aaron n'a rien proposé).
    const text = skip ? '' : (proposal || current).trim();
    setSavingAnswer(true);
    setError(null);
    try {
      await save({ answer: { key: q.key, question: q.text, text }, question: Math.min(qIndex + 1, questions.length - 1) });
    } catch {
      setSavingAnswer(false);
      setError(w('saveError', locale));
      return;
    }
    const nextAnswers = { ...answers };
    if (text) nextAnswers[q.key] = text; else delete nextAnswers[q.key];
    setAnswers(nextAnswers);
    setSavingAnswer(false);
    if (qIndex + 1 < questions.length) {
      const key = ONBOARDING_QUESTION_KEYS[qIndex + 1];
      setQIndex(qIndex + 1);
      setCurrent('');
      setThread([]);
      setProposal(nextAnswers[key] ?? drafts[key] ?? null);
    } else {
      finishCompany(nextAnswers);
    }
  }

  async function finishCompany(finalAnswers) {
    let qa = questions.filter((q) => finalAnswers[q.key]).map((q) => ({ question: q.text, answer: finalAnswers[q.key] }));
    // Questions toutes passées mais réponses tirées du document : on s'en sert.
    if (qa.length === 0) qa = questions.filter((q) => drafts[q.key]).map((q) => ({ question: q.text, answer: drafts[q.key] }));
    const docUploaded = !!docStatus && docStatus !== 'error' && docStatus !== 'reading';
    if (qa.length === 0 && !docUploaded) { goTo('campaign'); return; }
    setSummarizing(true);
    try {
      if (docSaveRef.current) await docSaveRef.current;
      const res = await fetch('/api/business-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Le document éventuellement déposé est déjà dans les documents de
        // l'entreprise (POST /api/documents) : /api/business-summary le lit.
        body: JSON.stringify({ user_id: me.id, description: '', qa }),
      });
      if (!res.ok) setError(w('summaryError', locale));
      else setState((s) => ({ ...s, has_profile: true }));
    } catch {
      setError(w('summaryError', locale));
    }
    setSummarizing(false);
    goTo('campaign');
  }

  async function onDocument(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !me) return;
    setDocStatus('reading');
    // 1) Le document rejoint les documents de l'entreprise (Aaron s'en
    //    servira ensuite pour écrire) ; 2) Aaron en tire les réponses.
    const keep = new FormData();
    keep.append('file', file);
    keep.append('user_id', me.id);
    docSaveRef.current = fetch('/api/documents', { method: 'POST', body: keep }).catch(() => {});
    const fd = new FormData();
    fd.append('file', file);
    fd.append('questions', JSON.stringify(questions.map((q) => ({ key: q.key, question: q.text }))));
    try {
      const res = await fetch('/api/welcome/prefill', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setDocStatus('error'); return; }
      const found = body.answers || {};
      setDrafts(found);
      setDocStatus(body.filled ? { filled: body.filled, total: body.total } : 'none');
      const key = ONBOARDING_QUESTION_KEYS[qIndex];
      if (!current.trim() && found[key]) setCurrent(found[key]);
    } catch {
      setDocStatus('error');
    }
  }

  function addChip(text) {
    // Une suggestion cliquée est une réponse : elle part à Aaron, qui la
    // reformule et demande confirmation (08/11/2026).
    sendToAaron(text);
  }

  // ---- Campagne ----
  async function loadCampaign(withHint) {
    setCampaignLoading(true);
    setError(null);
    try {
      const url = withHint ? `/api/campaigns/profile-suggestions?hint=${encodeURIComponent(withHint)}` : '/api/campaigns/profile-suggestions';
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      const p = body.prefill;
      if (!p && !withHint) { setNeedHint(true); setCampaignLoading(false); return; }
      setNeedHint(false);
      setCampaign({
        zone_label: p?.zone_label || '',
        sectors: (p?.sector_keywords || []).join(', '),
        company_sizes: p?.company_sizes || [],
        target_role: p?.target_role || '',
        context_notes: p?.context_notes || '',
        target_count: 20,
      });
    } catch {
      setNeedHint(true);
    }
    setCampaignLoading(false);
  }

  useEffect(() => {
    if (step !== 'campaign' || campaign || campaignLoading || needHint || !state) return;
    if (!state.has_profile && Object.keys(answers).length === 0) { setNeedHint(true); return; }
    loadCampaign(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, state]);

  async function launchCampaign() {
    if (!campaign || !me) return;
    const sectors = campaign.sectors.split(',').map((s) => s.trim()).filter(Boolean);
    const zone = campaign.zone_label.trim();
    if (!zone || sectors.length === 0) return;
    setLaunching(true);
    setError(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: me.company_id,
        assigned_user_id: me.id,
        zone_label: zone,
        zone_type: 'zone',
        zone_codes: [zone],
        sector_keywords: sectors,
        company_sizes: campaign.company_sizes,
        target_count: campaign.target_count,
        context_notes: campaign.context_notes || null,
        target_role: campaign.target_role || null,
      }),
    }).catch(() => null);
    setLaunching(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(body.code === 'prospect_quota_exceeded' ? w('quotaError', locale) : w('campaignError', locale));
      return;
    }
    setCampaignCreated(true);
    goTo('mailbox');
  }

  // ---- Boîte mail : même passage sécurisé que Mon compte > Connexion ----
  async function connectProvider(provider) {
    setConnecting(provider);
    setError(null);
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) { router.push('/login'); return; }
    const handoffRes = await fetch('/api/auth/qr-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ provider }),
    }).catch(() => null);
    const handoff = handoffRes && handoffRes.ok ? await handoffRes.json() : null;
    if (!handoff?.token) { setConnecting(null); setError(w('mailboxError', locale)); return; }
    try { window.sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) {}
    window.location.href = `/api/auth/${provider}?qr=${encodeURIComponent(handoff.token)}`;
  }

  function otherMailbox() {
    try { window.sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) {}
    router.push(`/app/connexions?user_id=${me?.id || ''}&tab=connection`);
  }

  async function finish() {
    try { await save({ done: true }); } catch (e) {}
    try { window.sessionStorage.removeItem(LATER_FLAG); } catch (e) {}
    router.push(`/app/campaigns?user_id=${me?.id || ''}`);
  }

  if (!state) {
    return (
      <div className="wl-loading"><Loader2 className="spin" size={22} aria-hidden="true" />
        <style jsx>{`
          .wl-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--muted); }
          :global(.spin) { animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  const firstName = state.first_name ? ` ${state.first_name}` : '';
  const q = questions[qIndex];
  const chips = q ? suggestionsFor(locale, q.key) : [];
  const fromDoc = q && !answers[q.key] && drafts[q.key] && thread.length === 0 && proposal === drafts[q.key];

  return (
    <div className="wl">
      <header className="wl-top">
        <img src="/icon.png" alt="Meet Aaron" className="wl-logo" />
        <div className="wl-progress">
          <span className="wl-step">{w('stepOf', locale).replace('{n}', String(stepNo)).replace('{total}', String(steps.length))}</span>
          <span className="wl-bar"><span style={{ width: `${(stepNo / steps.length) * 100}%` }} /></span>
        </div>
        {/* Langue changeable dès la première connexion (demande Alex,
            08/11/2026 : « dans la démo il faut pouvoir changer la langue »).
            Synchronisée côté serveur comme dans Mon compte. */}
        <select
          className="wl-lang"
          value={locale}
          onChange={(e) => {
            const next = e.target.value;
            setLocale(next);
            fetch('/api/user/locale', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) }).catch(() => {});
          }}
          aria-label={t('common.language', locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
          ))}
        </select>
      </header>

      <main className="wl-main">
        {step === 'intro' && (
          <section>
            <h1>{w('introTitle', locale).replace('{name}', firstName)}</h1>
            <p className="lead">{w('introLead', locale)}</p>
            <div className="cards">
              {[
                [Search, 'c1t', 'c1b'],
                [PenLine, 'c2t', 'c2b'],
                [RefreshCw, 'c3t', 'c3b'],
                [Check, 'c4t', 'c4b'],
              ].map(([Icon, tk, bk]) => (
                <div key={tk} className="card">
                  <span className="card-ic"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span>
                  <h3>{w(tk, locale)}</h3>
                  <p>{w(bk, locale)}</p>
                </div>
              ))}
            </div>
            <div className="row-end">
              <button type="button" className="btn-primary" onClick={nextStep}>{w('start', locale)} <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </section>
        )}

        {step === 'company' && (
          <section>
            <h1>{w('companyTitle', locale)}</h1>
            <p className="lead">{w('companyLead', locale)}</p>

            {summarizing ? (
              <div className="panel center">
                <Loader2 className="spin" size={22} aria-hidden="true" />
                <p className="strong">{w('summarizing', locale)}</p>
                <p className="muted">{w('summarizingHint', locale)}</p>
              </div>
            ) : (
              <>
                <div className="doc">
                  <div className="doc-text">
                    <p className="strong"><FileText size={16} aria-hidden="true" /> {w('docTitle', locale)}</p>
                    <p className="muted">{w('docBody', locale)}</p>
                    {docStatus === 'reading' && <p className="muted"><Loader2 className="spin" size={14} aria-hidden="true" /> {w('docReading', locale)}</p>}
                    {docStatus && typeof docStatus === 'object' && <p className="ok">{w('docFilled', locale).replace('{n}', String(docStatus.filled)).replace('{total}', String(docStatus.total))}</p>}
                    {docStatus === 'none' && <p className="muted">{w('docNone', locale)}</p>}
                    {docStatus === 'error' && <p className="err">{w('docError', locale)}</p>}
                  </div>
                  <button type="button" className="btn-secondary" disabled={docStatus === 'reading'} onClick={() => fileRef.current?.click()}>
                    <Upload size={15} aria-hidden="true" /> {w('docButton', locale)}
                  </button>
                  <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf" onChange={onDocument} />
                </div>

                {qIndex === 5 && <p className="cheer"><Sparkles size={15} aria-hidden="true" /> {w('halfway', locale)}</p>}
                {qIndex === 9 && <p className="cheer"><Sparkles size={15} aria-hidden="true" /> {w('almost', locale)}</p>}

                <div className="panel">
                  <div className="q-head">
                    <span className="q-no">{w('question', locale).replace('{n}', String(qIndex + 1)).replace('{total}', String(questions.length))}</span>
                    <span className="q-dots">
                      {questions.map((qq, i) => (
                        <span key={qq.key} className={`dot${answers[qq.key] ? ' filled' : ''}${i === qIndex ? ' cur' : ''}`} />
                      ))}
                    </span>
                  </div>
                  {/* Conversation avec Aaron (08/11/2026) : la question est
                      son premier message ; l'utilisateur répond ou demande
                      une précision ; Aaron reformule et propose la réponse
                      à enregistrer, que l'on confirme ou que l'on complète. */}
                  <div className="thread">
                    <div className="bubble aaron"><span className="who">Aaron</span>{q.text}</div>
                    {thread.length === 0 && !proposal && <p className="muted small thread-hint">{w('chatIntro', locale)}</p>}
                    {thread.length === 0 && proposal && (
                      <div className="bubble aaron"><span className="who">Aaron</span>{fromDoc ? w('chatFromDoc', locale) : ''} {proposal}</div>
                    )}
                    {thread.map((m, i) => (
                      <div key={i} className={`bubble ${m.role}`}><span className="who">{m.role === 'aaron' ? 'Aaron' : (state?.first_name || firstName || '')}</span>{m.content}</div>
                    ))}
                    {chatBusy && <div className="bubble aaron muted"><span className="who">Aaron</span>{w('chatThinking', locale)}</div>}
                    <div ref={threadEndRef} />
                  </div>
                  {proposal && !chatBusy && (
                    <div className="proposal">
                      <p className="proposal-text">{proposal}</p>
                      <button type="button" className="btn-primary" disabled={savingAnswer} onClick={() => validateAnswer(false)}>
                        <Check size={15} aria-hidden="true" /> {w('chatConfirm', locale)}
                      </button>
                    </div>
                  )}
                  {chips.length > 0 && thread.length === 0 && !proposal && (
                    <div className="chips" aria-label={w('suggestions', locale)}>
                      {chips.map((c) => (
                        <button type="button" key={c.label} className="chip" disabled={chatBusy} onClick={() => addChip(c.text)}>{c.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="composer">
                    <textarea
                      rows={2}
                      value={current}
                      placeholder={proposal ? w('chatAdd', locale) : w('placeholder', locale)}
                      onChange={(e) => setCurrent(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !chatBusy) { e.preventDefault(); sendToAaron(); } }}
                    />
                    <button type="button" className="btn-secondary" disabled={chatBusy || !current.trim()} onClick={() => sendToAaron()}>{w('chatSend', locale)}</button>
                  </div>
                  {error && <p className="err">{error}</p>}
                  <div className="q-actions">
                    <button type="button" className="btn-ghost" disabled={qIndex === 0 || savingAnswer} onClick={() => showQuestion(qIndex - 1)}>
                      <ArrowLeft size={15} aria-hidden="true" /> {w('back', locale)}
                    </button>
                    <span className="grow" />
                    <button type="button" className="btn-ghost" disabled={savingAnswer} onClick={() => validateAnswer(true)}>{w('skipQuestion', locale)}</button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {step === 'campaign' && (
          <section>
            <h1>{w('campaignTitle', locale)}</h1>
            {campaignLoading ? (
              <div className="panel center"><Loader2 className="spin" size={22} aria-hidden="true" /><p className="strong">{w('campaignLoading', locale)}</p></div>
            ) : needHint && !campaign ? (
              <div className="panel">
                <h2 className="q-text">{w('hintTitle', locale)}</h2>
                <textarea rows={3} value={hint} placeholder={w('hintPlaceholder', locale)} onChange={(e) => setHint(e.target.value)} />
                <div className="row-end">
                  <button type="button" className="btn-primary" disabled={!hint.trim()} onClick={() => loadCampaign(hint.trim())}>{w('hintGo', locale)} <ArrowRight size={15} aria-hidden="true" /></button>
                </div>
              </div>
            ) : campaign ? (
              <>
                <p className="lead">{w('campaignLead', locale)}</p>
                {/* Trois exemples FICTIFS (décision Alex, 06/11/2026) : zéro
                    prospect réel avant la boîte mail, puisque la campagne
                    part juste après — mais le principe se voit tout de suite.
                    Marqués « Exemple » sur chaque carte. */}
                <div className="panel ex-panel">
                  <h2 className="q-text">{w('exTitle', locale)}</h2>
                  <p className="lead">{w('exLead', locale)}</p>
                  <div className="cards ex-cards">
                    {w('ex', locale).map(([name, company, role]) => (
                      <div className="card ex-card" key={name}>
                        <span className="ex-tag">{w('exTag', locale)}</span>
                        <strong>{name}</strong>
                        <span className="ex-sub">{role} · {company}</span>
                        <span className="ex-found"><Check size={12} aria-hidden="true" /> {w('exFound', locale)}</span>
                      </div>
                    ))}
                    <div className="card ex-card ex-draft">
                      <span className="ex-tag">{w('exTag', locale)}</span>
                      <strong>{w('exDraftTitle', locale)}</strong>
                      <p className="ex-mail">{w('exDraft', locale)}</p>
                    </div>
                  </div>
                </div>
                <div className="panel form">
                  <label>{w('zone', locale)}
                    <input value={campaign.zone_label} placeholder={w('zonePlaceholder', locale)} onChange={(e) => setCampaign({ ...campaign, zone_label: e.target.value })} />
                  </label>
                  <label>{w('sectors', locale)}
                    <input value={campaign.sectors} placeholder={w('sectorsPlaceholder', locale)} onChange={(e) => setCampaign({ ...campaign, sectors: e.target.value })} />
                  </label>
                  <div className="field">
                    <span className="lbl">{w('sizes', locale)}</span>
                    <div className="chips">
                      {SIZE_KEYS.map((s) => {
                        const on = campaign.company_sizes.includes(s.key);
                        return (
                          <button type="button" key={s.key} className={`chip${on ? ' on' : ''}`} aria-pressed={on}
                            onClick={() => setCampaign({ ...campaign, company_sizes: on ? campaign.company_sizes.filter((k) => k !== s.key) : [...campaign.company_sizes, s.key] })}>
                            {t(s.labelKey, locale)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label>{w('role', locale)}
                    <select value={campaign.target_role} onChange={(e) => setCampaign({ ...campaign, target_role: e.target.value })}>
                      <option value="">{w('anyRole', locale)}</option>
                      {ROLE_KEYS.map((r) => <option key={r.key} value={r.key}>{t(r.labelKey, locale)}</option>)}
                    </select>
                  </label>
                  <div className="field">
                    <span className="lbl">{w('count', locale)}</span>
                    <div className="chips">
                      {COUNTS.map((n) => (
                        <button type="button" key={n} className={`chip${campaign.target_count === n ? ' on' : ''}`} aria-pressed={campaign.target_count === n} onClick={() => setCampaign({ ...campaign, target_count: n })}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <label>{w('notes', locale)}
                    <textarea rows={2} value={campaign.context_notes} onChange={(e) => setCampaign({ ...campaign, context_notes: e.target.value })} />
                  </label>
                  {error && <p className="err">{error}</p>}
                  <div className="row-end">
                    <button type="button" className="btn-primary" disabled={launching || !campaign.zone_label.trim() || !campaign.sectors.trim()} onClick={launchCampaign}>
                      {launching ? w('launching', locale) : w('launch', locale)} <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        )}

        {step === 'mailbox' && (
          <section>
            <h1>{w('mailboxTitle', locale)}</h1>
            <p className="lead">{w('mailboxLead', locale)}</p>
            {state.mailbox_connected ? (
              <div className="panel center">
                <span className="card-ic ok-ic"><Check size={20} aria-hidden="true" /></span>
                <p className="strong">{w('connected', locale)}</p>
                <div className="row-end"><button type="button" className="btn-primary" onClick={nextStep}>{w('next', locale)} <ArrowRight size={15} aria-hidden="true" /></button></div>
              </div>
            ) : (
              <div className="panel">
                <div className="providers">
                  <button type="button" className="provider" disabled={!!connecting} onClick={() => connectProvider('google')}>
                    <Mail size={18} aria-hidden="true" /> {connecting === 'google' ? w('connecting', locale) : w('google', locale)}
                  </button>
                  <button type="button" className="provider" disabled={!!connecting} onClick={() => connectProvider('microsoft')}>
                    <Mail size={18} aria-hidden="true" /> {connecting === 'microsoft' ? w('connecting', locale) : w('microsoft', locale)}
                  </button>
                  <button type="button" className="provider" disabled={!!connecting} onClick={otherMailbox}>
                    <Mail size={18} aria-hidden="true" /> {w('other', locale)}
                  </button>
                </div>
                <p className="muted small">{w('calendarNote', locale)}</p>
                {error && <p className="err">{error}</p>}
              </div>
            )}
          </section>
        )}

        {step === 'availability' && (
          <section>
            <h1>{w('availTitle', locale)}</h1>
            <p className="lead">{w('availLead', locale)}</p>
            <div className="panel">
              <div className="avail-grid">
                {DAY_ORDER.map((d) => (
                  <div key={d} className={`avail-row${avail[d].on ? '' : ' off'}`}>
                    <label className="avail-day">
                      <input type="checkbox" checked={avail[d].on} onChange={(e) => setAvail({ ...avail, [d]: { ...avail[d], on: e.target.checked } })} />
                      <span>{dayName(d)}</span>
                    </label>
                    <div className="avail-times">
                      <span className="muted small">{w('availFrom', locale)}</span>
                      <input type="time" value={avail[d].start} disabled={!avail[d].on} onChange={(e) => setAvail({ ...avail, [d]: { ...avail[d], start: e.target.value } })} />
                      <span className="muted small">{w('availTo', locale)}</span>
                      <input type="time" value={avail[d].end} disabled={!avail[d].on} onChange={(e) => setAvail({ ...avail, [d]: { ...avail[d], end: e.target.value } })} />
                    </div>
                  </div>
                ))}
              </div>
              <span className="lbl" style={{ marginTop: '1rem' }}>{w('availTypes', locale)}</span>
              <div className="chips">
                {[['visio', 'typeVisio'], ['telephonique', 'typeTel'], ['physique', 'typePhysique']].map(([key, lk]) => (
                  <button type="button" key={key} className={`chip${availTypes[key] ? ' on' : ''}`} aria-pressed={availTypes[key]} onClick={() => setAvailTypes({ ...availTypes, [key]: !availTypes[key] })}>{w(lk, locale)}</button>
                ))}
              </div>
              {error && <p className="err">{error}</p>}
              <div className="row-end">
                <button type="button" className="btn-primary" disabled={availSaving} onClick={saveAvailability}>
                  {availSaving ? w('availSaving', locale) : w('availSave', locale)} <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'end' && (
          <section>
            <h1>{w('endTitle', locale)}</h1>
            <div className="panel">
              <p className="strong">
                {state.invited
                  ? w('endInvited', locale)
                  : (campaignCreated || state.has_campaign)
                    ? (state.mailbox_connected ? w('endAllGood', locale) : w('endNeedMailbox', locale))
                    : w('endNoCampaign', locale)}
              </p>
              <p className="muted">{w('endChecklist', locale)}</p>
              <div className="row-end">
                <button type="button" className="btn-primary" onClick={finish}>{w('endGo', locale)} <ArrowRight size={15} aria-hidden="true" /></button>
              </div>
            </div>
          </section>
        )}
      </main>

      {step !== 'end' && (
        <footer className="wl-foot">
          <button type="button" className="btn-ghost" onClick={later}>{w('later', locale)}</button>
          <button type="button" className="btn-ghost" disabled={summarizing || launching} onClick={nextStep}>{w('skip', locale)}</button>
        </footer>
      )}

      <style jsx>{`
        .wl { min-height: 100vh; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
        .wl-top { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 5; }
        .wl-logo { width: 32px; height: 32px; border-radius: 8px; }
        .wl-lang { margin-left: auto; background: var(--surface); border: 1px solid var(--border); color: var(--muted); border-radius: 8px; padding: 0.35rem 0.5rem; font-size: 0.76rem; font-family: inherit; cursor: pointer; max-width: 110px; }
        .wl-progress { flex: 1; display: flex; flex-direction: column; gap: 0.35rem; max-width: 520px; }
        .wl-step { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
        .wl-bar { height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; display: block; }
        .wl-bar span { display: block; height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.3s ease; }
        .wl-main { flex: 1; width: 100%; max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 7rem; box-sizing: border-box; }
        h1 { font-family: var(--font-display); font-size: 1.55rem; line-height: 1.25; margin: 0.4rem 0 0.5rem; }
        .lead { color: var(--muted); font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.2rem; }
        .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.8rem; }
        .avail-grid { display: grid; gap: 0.45rem; }
        .avail-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
        .avail-row:last-child { border-bottom: 0; }
        .avail-row.off .avail-times { opacity: 0.45; }
        .avail-day { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; text-transform: capitalize; min-width: 9rem; cursor: pointer; }
        .avail-day input { width: 16px; height: 16px; accent-color: var(--accent); }
        .avail-times { display: inline-flex; align-items: center; gap: 0.4rem; }
        .avail-times input { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.3rem 0.45rem; color: var(--text); font: inherit; font-size: 0.86rem; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; }
        .card h3 { margin: 0.6rem 0 0.3rem; font-size: 1rem; }
        .card p { margin: 0; color: var(--muted); font-size: 0.86rem; line-height: 1.45; }
        .card-ic { display: inline-flex; width: 38px; height: 38px; border-radius: 10px; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
        .ok-ic { background: rgba(61, 163, 93, 0.16); color: #3DA35D; }
        .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.1rem; margin-top: 0.9rem; }
        .ex-panel { margin-bottom: 0.4rem; }
        .ex-cards { grid-template-columns: repeat(2, 1fr); }
        .ex-card { display: flex; flex-direction: column; gap: 0.25rem; position: relative; padding-top: 1.6rem; }
        .ex-tag { position: absolute; top: 0.55rem; right: 0.7rem; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); border: 1px dashed var(--border); border-radius: 999px; padding: 0.1rem 0.5rem; }
        .ex-sub { color: var(--muted); font-size: 0.84rem; }
        .ex-found { color: var(--accent-green, #3dd68c); font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.2rem; }
        .ex-draft { grid-column: 1 / -1; }
        .ex-mail { margin: 0.2rem 0 0; font-size: 0.86rem; line-height: 1.5; color: var(--text); }
        .panel.center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5rem; }
        .doc { display: flex; gap: 1rem; align-items: center; justify-content: space-between; border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 0.9rem 1rem; }
        .doc-text p { margin: 0 0 0.25rem; }
        .strong { font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem; margin: 0; }
        .muted { color: var(--muted); font-size: 0.85rem; line-height: 1.45; }
        .small { font-size: 0.78rem; margin: 0.5rem 0 0; }
        .ok { color: #3DA35D; font-size: 0.85rem; margin: 0.3rem 0 0; }
        .err { color: var(--accent-red); font-size: 0.85rem; margin: 0.6rem 0 0; }
        .cheer { display: flex; align-items: center; gap: 0.45rem; margin: 1rem 0 0; padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); font-size: 0.88rem; font-weight: 600; }
        .q-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
        .q-no { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
        .q-dots { display: flex; gap: 4px; }
        .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--border); }
        .dot.filled { background: var(--accent); }
        .dot.cur { outline: 2px solid var(--accent); outline-offset: 1px; }
        .q-text { font-size: 1.08rem; line-height: 1.4; margin: 0.7rem 0 0.8rem; }
        .chips { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.7rem; }
        .chip { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 999px; padding: 0.38rem 0.75rem; font-size: 0.82rem; cursor: pointer; }
        .chip.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
        textarea, input, select { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.6rem 0.75rem; color: var(--text); font-size: 0.92rem; font-family: inherit; }
        textarea { resize: vertical; }
        .q-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.8rem; flex-wrap: wrap; }
        .thread { display: flex; flex-direction: column; gap: 0.55rem; margin: 0.6rem 0 0.8rem; max-height: 46vh; overflow-y: auto; padding-right: 0.2rem; }
        .bubble { position: relative; max-width: 92%; padding: 0.65rem 0.8rem 0.6rem; border-radius: 14px; font-size: 0.93rem; line-height: 1.45; white-space: pre-line; }
        .bubble .who { display: block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.2rem; }
        .bubble.aaron { align-self: flex-start; background: var(--bg); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
        .bubble.user { align-self: flex-end; background: rgba(75, 57, 239, 0.16); border: 1px solid rgba(124, 110, 245, 0.45); border-bottom-right-radius: 4px; }
        .bubble.muted { color: var(--muted); font-style: italic; }
        .thread-hint { margin: 0; }
        .proposal { display: flex; align-items: flex-start; gap: 0.7rem; flex-wrap: wrap; background: rgba(61, 163, 93, 0.1); border: 1px solid rgba(61, 163, 93, 0.45); border-radius: var(--radius-md); padding: 0.7rem 0.8rem; margin-bottom: 0.7rem; }
        .proposal-text { flex: 1 1 220px; margin: 0; font-size: 0.9rem; line-height: 1.45; }
        .composer { display: flex; gap: 0.5rem; align-items: flex-end; }
        .composer textarea { flex: 1; margin: 0; }
        .grow { flex: 1; }
        .form { display: flex; flex-direction: column; gap: 0.85rem; }
        .form label, .field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; color: var(--muted); font-weight: 600; }
        .field .chips { margin-bottom: 0; }
        .row-end { display: flex; justify-content: flex-end; margin-top: 1rem; }
        .providers { display: grid; gap: 0.6rem; }
        .provider { display: flex; align-items: center; gap: 0.6rem; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-md); padding: 0.85rem 1rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; text-align: left; }
        .provider:hover:not(:disabled) { border-color: var(--accent); }
        .btn-primary { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sm); padding: 0.65rem 1.1rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; }
        .btn-secondary { display: inline-flex; align-items: center; gap: 0.4rem; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 0.55rem 0.9rem; font-weight: 600; font-size: 0.85rem; cursor: pointer; white-space: nowrap; }
        .btn-ghost { display: inline-flex; align-items: center; gap: 0.35rem; background: transparent; border: none; color: var(--muted); padding: 0.55rem 0.6rem; font-weight: 600; font-size: 0.86rem; cursor: pointer; }
        button:disabled { opacity: 0.55; cursor: default; }
        .wl-foot { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1.25rem calc(0.75rem + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--border); }
        :global(.spin) { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 560px) {
          .cards { grid-template-columns: minmax(0, 1fr); }
          .doc { flex-direction: column; align-items: flex-start; }
          h1 { font-size: 1.3rem; }
        }
      `}</style>
    </div>
  );
}
