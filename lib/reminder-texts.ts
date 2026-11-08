// lib/reminder-texts.ts
// Textes des rappels de rendez-vous adressés AU COMMERCIAL (sa langue) et de
// l'email « je suis en retard » adressé AU PROSPECT (sa langue). Décision Alex
// (docx 08/11/2026) : deux rappels par rendez-vous — le récap de la veille à
// 20 h (« ta journée de demain », email + notification), puis le rappel juste
// avant : 30 min pour un appel ou une visio, 1 h pour un rendez-vous physique.

import { normalizeLocale } from './locale-instruction';

export type ApptType = 'visio' | 'telephonique' | 'physique';

// Délai de rappel avant le rendez-vous selon le type ; la préférence du
// commercial (notify_before_appointment_minutes) s'applique aux appels et
// visios, le physique ne descend jamais sous 60 min (temps de déplacement).
export function reminderLeadMinutes(type: string, pref: number | null | undefined): number {
  const base = Number.isFinite(Number(pref)) && Number(pref) > 0 ? Number(pref) : 30;
  if (type === 'physique') return Math.max(base, 60);
  return base;
}

export const DIGEST_HOUR = 20;

const T: Record<string, {
  intl: string;
  types: Record<ApptType, string>;
  reminderTitle: string; reminderBody: string; // {name} {minutes} {type} {time}
  reminderLink: string;
  digestSubject: string; digestTitle: string; digestIntro: string; digestLine: string; digestNone: string; digestFoot: string; digestPush: string;
  lateSubject: string; lateBody: string; lateBye: string; hello: string;
}> = {
  fr: { intl: 'fr-FR', types: { visio: 'en visio', telephonique: 'par téléphone', physique: 'sur place' }, reminderTitle: 'Rendez-vous dans {minutes} min', reminderBody: '{name} {type}, à {time}.', reminderLink: 'Lien visio : {link}', digestSubject: 'Ta journée de demain', digestTitle: 'Ta journée de demain', digestIntro: 'Bonjour {first}, voici tes rendez-vous de demain, {date} :', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: "Tout est confirmé côté prospects. Je te rappelle chacun juste avant. Bonne soirée,\nAaron", digestPush: '{n} rendez-vous demain : {first_line}', hello: 'Bonjour {name},', lateSubject: 'Petit retard pour notre rendez-vous', lateBody: "Un petit imprévu me retarde d'environ {minutes} minutes. Notre rendez-vous tient bien, j'arrive au plus vite. Merci pour votre patience.", lateBye: 'À tout de suite,' },
  en: { intl: 'en-GB', types: { visio: 'video call', telephonique: 'phone call', physique: 'in person' }, reminderTitle: 'Meeting in {minutes} min', reminderBody: '{name}, {type} at {time}.', reminderLink: 'Video link: {link}', digestSubject: 'Your day tomorrow', digestTitle: 'Your day tomorrow', digestIntro: 'Hi {first}, here are your meetings tomorrow, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Everything is confirmed on the prospects’ side. I will remind you just before each one. Have a good evening,\nAaron', digestPush: '{n} meetings tomorrow: {first_line}', hello: 'Hello {name},', lateSubject: 'Running slightly late for our meeting', lateBody: 'Something unexpected is delaying me by about {minutes} minutes. Our meeting still stands, I will be with you as soon as possible. Thank you for your patience.', lateBye: 'See you very soon,' },
  de: { intl: 'de-DE', types: { visio: 'Videoanruf', telephonique: 'Telefonat', physique: 'vor Ort' }, reminderTitle: 'Termin in {minutes} Min.', reminderBody: '{name}, {type} um {time}.', reminderLink: 'Video-Link: {link}', digestSubject: 'Dein Tag morgen', digestTitle: 'Dein Tag morgen', digestIntro: 'Hallo {first}, hier sind deine Termine morgen, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Alles ist bei den Interessenten bestätigt. Ich erinnere dich kurz vor jedem Termin. Schönen Abend,\nAaron', digestPush: '{n} Termine morgen: {first_line}', hello: 'Guten Tag {name},', lateSubject: 'Kleine Verspätung zu unserem Termin', lateBody: 'Ein unvorhergesehener Umstand verzögert mich um etwa {minutes} Minuten. Unser Termin findet statt, ich bin so schnell wie möglich bei Ihnen. Vielen Dank für Ihre Geduld.', lateBye: 'Bis gleich,' },
  it: { intl: 'it-IT', types: { visio: 'videochiamata', telephonique: 'telefonata', physique: 'di persona' }, reminderTitle: 'Appuntamento tra {minutes} min', reminderBody: '{name}, {type} alle {time}.', reminderLink: 'Link video: {link}', digestSubject: 'La tua giornata di domani', digestTitle: 'La tua giornata di domani', digestIntro: 'Ciao {first}, ecco i tuoi appuntamenti di domani, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Tutto è confermato lato prospect. Ti ricordo ciascuno poco prima. Buona serata,\nAaron', digestPush: '{n} appuntamenti domani: {first_line}', hello: 'Buongiorno {name},', lateSubject: 'Piccolo ritardo per il nostro appuntamento', lateBody: 'Un imprevisto mi fa ritardare di circa {minutes} minuti. Il nostro appuntamento è confermato, arrivo il prima possibile. Grazie per la pazienza.', lateBye: 'A tra poco,' },
  es: { intl: 'es-ES', types: { visio: 'videollamada', telephonique: 'llamada', physique: 'presencial' }, reminderTitle: 'Reunión en {minutes} min', reminderBody: '{name}, {type} a las {time}.', reminderLink: 'Enlace de vídeo: {link}', digestSubject: 'Tu día de mañana', digestTitle: 'Tu día de mañana', digestIntro: 'Hola {first}, estas son tus reuniones de mañana, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Todo está confirmado por parte de los prospectos. Te lo recordaré justo antes de cada una. Buenas noches,\nAaron', digestPush: '{n} reuniones mañana: {first_line}', hello: 'Hola {name},', lateSubject: 'Pequeño retraso para nuestra reunión', lateBody: 'Un imprevisto me retrasa unos {minutes} minutos. Nuestra reunión se mantiene, llego lo antes posible. Gracias por su paciencia.', lateBye: 'Hasta ahora,' },
  pt: { intl: 'pt-PT', types: { visio: 'videochamada', telephonique: 'chamada', physique: 'presencial' }, reminderTitle: 'Reunião daqui a {minutes} min', reminderBody: '{name}, {type} às {time}.', reminderLink: 'Link de vídeo: {link}', digestSubject: 'O teu dia de amanhã', digestTitle: 'O teu dia de amanhã', digestIntro: 'Olá {first}, aqui estão as tuas reuniões de amanhã, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Está tudo confirmado do lado dos prospetos. Lembro-te de cada uma mesmo antes. Boa noite,\nAaron', digestPush: '{n} reuniões amanhã: {first_line}', hello: 'Olá {name},', lateSubject: 'Pequeno atraso para a nossa reunião', lateBody: 'Um imprevisto atrasa-me cerca de {minutes} minutos. A nossa reunião mantém-se, chego o mais depressa possível. Obrigado pela sua paciência.', lateBye: 'Até já,' },
  nl: { intl: 'nl-NL', types: { visio: 'videogesprek', telephonique: 'telefoongesprek', physique: 'ter plaatse' }, reminderTitle: 'Afspraak over {minutes} min', reminderBody: '{name}, {type} om {time}.', reminderLink: 'Videolink: {link}', digestSubject: 'Je dag van morgen', digestTitle: 'Je dag van morgen', digestIntro: 'Hallo {first}, dit zijn je afspraken van morgen, {date}:', digestLine: '{time} · {name} ({company}) · {type}', digestNone: '', digestFoot: 'Alles is bevestigd aan de kant van de prospects. Ik herinner je vlak voor elke afspraak. Fijne avond,\nAaron', digestPush: '{n} afspraken morgen: {first_line}', hello: 'Hallo {name},', lateSubject: 'Kleine vertraging voor onze afspraak', lateBody: 'Door een onverwachte omstandigheid ben ik ongeveer {minutes} minuten later. Onze afspraak gaat gewoon door, ik ben er zo snel mogelijk. Bedankt voor je geduld.', lateBye: 'Tot zo,' },
};

export function reminderTexts(locale: string | null | undefined) {
  return T[normalizeLocale(locale)] || T.fr;
}

export function typeLabel(locale: string | null | undefined, type: string): string {
  const t = reminderTexts(locale);
  return t.types[type as ApptType] || t.types.physique;
}

export function fmtTime(iso: string, locale: string | null | undefined, tz: string): string {
  return new Date(iso).toLocaleTimeString(reminderTexts(locale).intl, { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

export function fmtDay(iso: string, locale: string | null | undefined, tz: string): string {
  return new Date(iso).toLocaleDateString(reminderTexts(locale).intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
}

export function lateEmail(locale: string | null | undefined, prospectName: string, minutes: number): { subject: string; body: string } {
  const t = reminderTexts(locale);
  return {
    subject: t.lateSubject,
    body: [t.hello.replace('{name}', prospectName), '', t.lateBody.replace('{minutes}', String(minutes)), '', t.lateBye].join('\n'),
  };
}
