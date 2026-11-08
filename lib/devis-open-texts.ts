// lib/devis-open-texts.ts
// Textes des notifications « devis ouvert » dans la langue DU COMMERCIAL.
// Décision Alex (docx 08/11/2026) : à l'ouverture du devis, prévenir le
// commercial qu'il doit appeler tout de suite, idéalement dans les 30 min ;
// passé ce délai, le relancer une fois : « appelle quand même ».

import { normalizeLocale } from './locale-instruction';

const T: Record<string, { openTitle: string; openBody: string; nudgeTitle: string; nudgeBody: string }> = {
  fr: { openTitle: 'Devis ouvert — appelle maintenant', openBody: '{name} est en train de lire ton devis. Appelle dans les 30 minutes : c’est le moment où il décide.', nudgeTitle: 'Tu n’as pas encore appelé {name}', nudgeBody: 'Le devis a été ouvert il y a {minutes} min. Appelle quand même : un devis lu se négocie encore, un devis oublié non.' },
  en: { openTitle: 'Quote opened — call now', openBody: '{name} is reading your quote right now. Call within 30 minutes: this is when they decide.', nudgeTitle: 'You have not called {name} yet', nudgeBody: 'The quote was opened {minutes} min ago. Call anyway: a quote that was read can still be negotiated, a forgotten one cannot.' },
  de: { openTitle: 'Angebot geöffnet — jetzt anrufen', openBody: '{name} liest gerade Ihr Angebot. Rufen Sie innerhalb von 30 Minuten an: jetzt wird entschieden.', nudgeTitle: 'Sie haben {name} noch nicht angerufen', nudgeBody: 'Das Angebot wurde vor {minutes} Min. geöffnet. Rufen Sie trotzdem an: ein gelesenes Angebot lässt sich noch verhandeln, ein vergessenes nicht.' },
  it: { openTitle: 'Preventivo aperto — chiama ora', openBody: '{name} sta leggendo il tuo preventivo. Chiama entro 30 minuti: è il momento in cui decide.', nudgeTitle: 'Non hai ancora chiamato {name}', nudgeBody: 'Il preventivo è stato aperto {minutes} min fa. Chiama comunque: un preventivo letto si negozia ancora, uno dimenticato no.' },
  es: { openTitle: 'Presupuesto abierto — llama ahora', openBody: '{name} está leyendo tu presupuesto. Llama en los próximos 30 minutos: es el momento en que decide.', nudgeTitle: 'Aún no has llamado a {name}', nudgeBody: 'El presupuesto se abrió hace {minutes} min. Llama de todos modos: un presupuesto leído todavía se negocia, uno olvidado no.' },
  pt: { openTitle: 'Orçamento aberto — liga agora', openBody: '{name} está a ler o teu orçamento. Liga nos próximos 30 minutos: é agora que decide.', nudgeTitle: 'Ainda não ligaste a {name}', nudgeBody: 'O orçamento foi aberto há {minutes} min. Liga na mesma: um orçamento lido ainda se negoceia, um esquecido não.' },
  nl: { openTitle: 'Offerte geopend — bel nu', openBody: '{name} leest op dit moment je offerte. Bel binnen 30 minuten: dit is het moment waarop hij beslist.', nudgeTitle: 'Je hebt {name} nog niet gebeld', nudgeBody: 'De offerte is {minutes} min geleden geopend. Bel toch: over een gelezen offerte valt nog te onderhandelen, over een vergeten offerte niet.' },
};

export function devisOpenTexts(locale: string | null | undefined) {
  return T[normalizeLocale(locale)] || T.fr;
}
