// lib/appointment-flow.ts
//
// LE RENDEZ-VOUS SANS DEVOIRS (décision Alex, 08/11/2026).
//
// Avant : chaque créneau accepté par un prospect créait un rendez-vous
// « proposé » que le commercial devait valider à la main (story « Rendez-
// vous à valider ») — et tant qu'il ne cliquait pas, le prospect ne recevait
// ni invitation ni confirmation. Axel ne l'a jamais fait.
//
// Maintenant :
//   1. Aaron ne propose QUE des créneaux où le commercial est disponible
//      (computeFreeSlots : plages déclarées — sinon lundi–vendredi 8h–19h du
//      fuseau du commercial —, moins les indisponibilités, les rendez-vous
//      déjà validés et l'agenda Google/Outlook).
//   2. Dès que le prospect accepte un créneau (appointment_proposal), le
//      rendez-vous est confirmé tout seul : événement d'agenda, lien visio,
//      email de confirmation dans la langue du prospect (confirmAppointment).
//   3. UNE exception : un rendez-vous à moins de 24 h reste « proposé » et
//      attend la validation du commercial — le seul cas où le risque qu'il
//      ne voie pas la notification à temps justifie un clic (Alex proposait
//      3 jours ; 24 h, parce qu'au-delà les notifications push et le rappel
//      30 min avant suffisent, et 3 jours recréerait les devoirs).
//   4. Un créneau hors disponibilités (le prospect contre-propose) reste
//      « proposé » lui aussi, mais Aaron repropose de lui-même des créneaux
//      libres dans sa réponse (voir le contexte `creneaux_disponibles` dans
//      lib/aaron.ts) — le commercial n'a rien à faire sauf s'il veut forcer.
//   5. Depuis un rendez-vous, le commercial peut annuler (Aaron prépare
//      l'email, le commercial l'envoie) ou reporter (nouveau créneau, le
//      prospect est prévenu) — textes en 7 langues plus bas.

import { supabaseAdmin } from './supabase-admin';
import { createGoogleCalendarEvent } from './google';
import { createOutlookCalendarEvent } from './microsoft';
import { deleteGoogleCalendarEvent, deleteOutlookCalendarEvent } from './calendar-sync';
import { sendEmailForUser, getFreeBusyForUser } from './messaging';
import { resolveMeetingLink } from './meeting-link';
import { resolveProspectLocale } from './prospect-locale';
import { resolveUserTimeZone } from './user-timezone';
import { runInBackground } from './background';

export const AUTO_CONFIRM_MIN_HOURS = 24;

export type AppointmentType = 'visio' | 'telephonique' | 'physique';

// 18/10/2026 (Alex : « de base ça se met sur 1 h ») : la durée saisie prime,
// sinon 60 min.
export function durationMinutesFor(stored?: number | null): number {
  if (Number.isFinite(Number(stored)) && Number(stored) >= 15) return Number(stored);
  return 60;
}

// ---------------------------------------------------------------------------
// Disponibilités
// ---------------------------------------------------------------------------

// Heure locale (dans le fuseau du commercial) d'un instant : jour de semaine
// (0 = dimanche), « HH:MM:SS », et la date « YYYY-MM-DD ».
function localParts(d: Date, tz: string): { dow: number; time: string; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { dow: dowMap[get('weekday')] ?? 0, time: `${hour}:${get('minute')}:${get('second')}`, ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

// Décalage (minutes) entre UTC et le fuseau à un instant donné.
function tzOffsetMinutes(d: Date, tz: string): number {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(Number(p.ymd.slice(0, 4)), Number(p.ymd.slice(5, 7)) - 1, Number(p.ymd.slice(8, 10)), Number(p.time.slice(0, 2)), Number(p.time.slice(3, 5)), Number(p.time.slice(6, 8)));
  return Math.round((asUtc - d.getTime()) / 60000);
}

// Instant UTC correspondant à « ce jour à HH:MM » dans le fuseau.
function localToUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi, 0));
  const off = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off * 60000);
  // Deuxième passe pour les jours de changement d'heure.
  const off2 = tzOffsetMinutes(first, tz);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}

type Rule = { day_of_week: number; start_time: string; end_time: string; appointment_type: string | null };

// Plages par défaut quand aucune règle n'est déclarée : lundi–vendredi
// 08:00–19:00 (avant : « disponible en permanence », donc aussi le dimanche à
// 3 h du matin si un prospect le proposait).
const DEFAULT_RULES: Rule[] = [1, 2, 3, 4, 5].map((dow) => ({ day_of_week: dow, start_time: '08:00:00', end_time: '19:00:00', appointment_type: null }));

function ruleMatchesType(rule: Rule, type?: string | null): boolean {
  if (!rule.appointment_type || !type) return true;
  const norm = (v: string) => (v === 'tel' ? 'telephonique' : v);
  return norm(rule.appointment_type) === norm(type);
}

async function loadRules(userId: string): Promise<{ rules: Rule[]; declared: boolean }> {
  const { data } = await supabaseAdmin
    .from('availability_rules')
    .select('day_of_week, start_time, end_time, appointment_type')
    .eq('user_id', userId);
  const rules = (data || []) as Rule[];
  return rules.length ? { rules, declared: true } : { rules: DEFAULT_RULES, declared: false };
}

// Raisons pour lesquelles [startISO, endISO] n'est PAS disponible (vide =
// disponible). Fuseau du commercial pour les plages (avant : UTC du serveur,
// donc faux de sept heures à Perth).
export async function schedulingConflicts(userId: string, startISO: string, endISO: string, type?: string | null): Promise<string[]> {
  const reasons: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);

  const { data: seller } = await supabaseAdmin.from('users').select('timezone, billing_country').eq('id', userId).maybeSingle();
  const tz = resolveUserTimeZone((seller as any) || {});

  const { data: blocks } = await supabaseAdmin
    .from('availability_blocks')
    .select('start_at, end_at, reason')
    .eq('user_id', userId)
    .lt('start_at', endISO)
    .gt('end_at', startISO);
  if (blocks && blocks.length > 0) {
    reasons.push(`Chevauche une indisponibilité déclarée${blocks[0].reason ? ` (${blocks[0].reason})` : ''}.`);
  }

  const { rules } = await loadRules(userId);
  const p = localParts(start, tz);
  const pe = localParts(new Date(end.getTime() - 1), tz);
  const within = rules.some((r) => ruleMatchesType(r, type) && r.day_of_week === p.dow && p.time >= r.start_time && pe.time <= r.end_time && pe.ymd === p.ymd);
  if (!within) reasons.push('En dehors des créneaux de disponibilité déclarés.');

  const { data: taken } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, duration_minutes')
    .eq('user_id', userId)
    .eq('status', 'validé')
    .gte('proposed_at', new Date(start.getTime() - 4 * 3600 * 1000).toISOString())
    .lte('proposed_at', endISO);
  const clash = (taken || []).some((a: any) => {
    const s = new Date(a.proposed_at).getTime();
    const e = s + durationMinutesFor(a.duration_minutes) * 60000;
    return s < end.getTime() && e > start.getTime();
  });
  if (clash) reasons.push('Chevauche un rendez-vous déjà confirmé.');

  try {
    const busy = await getFreeBusyForUser(userId, startISO, endISO);
    if (busy.some((b) => new Date(b.start) < end && new Date(b.end) > start)) {
      reasons.push('Chevauche un événement déjà présent sur votre agenda (Google ou Outlook).');
    }
  } catch {
    /* agenda injoignable : on ne bloque pas sur ce critère */
  }
  return reasons;
}

export type FreeSlot = { startISO: string; endISO: string; label: string };

// Créneaux libres à proposer au prospect : jusqu'à `max` créneaux répartis
// sur `days` jours, en évitant de tout concentrer le même jour (au plus
// `perDay` par jour). Libellés dans la langue demandée et le fuseau du
// commercial.
export async function computeFreeSlots(
  userId: string,
  options: { days?: number; slotMinutes?: number; max?: number; perDay?: number; type?: string | null; locale?: string; fromISO?: string } = {}
): Promise<{ slots: FreeSlot[]; timeZone: string; declared: boolean }> {
  const days = options.days ?? 10;
  const slotMinutes = options.slotMinutes ?? 60;
  const max = options.max ?? 6;
  const perDay = options.perDay ?? 2;
  const locale = options.locale || 'fr';

  const { data: seller } = await supabaseAdmin.from('users').select('timezone, billing_country').eq('id', userId).maybeSingle();
  const tz = resolveUserTimeZone((seller as any) || {});
  const { rules, declared } = await loadRules(userId);
  const now = options.fromISO ? new Date(options.fromISO) : new Date();
  // Pas avant demain : un créneau « dans deux heures » est rarement tenable.
  const earliest = new Date(now.getTime() + AUTO_CONFIRM_MIN_HOURS * 3600 * 1000);
  const horizon = new Date(now.getTime() + days * 86400 * 1000);

  const [{ data: blocks }, { data: taken }] = await Promise.all([
    supabaseAdmin.from('availability_blocks').select('start_at, end_at').eq('user_id', userId).lt('start_at', horizon.toISOString()).gt('end_at', now.toISOString()),
    supabaseAdmin.from('appointments').select('proposed_at, duration_minutes').eq('user_id', userId).eq('status', 'validé').gte('proposed_at', now.toISOString()).lte('proposed_at', horizon.toISOString()),
  ]);
  let busy: { start: string; end: string }[] = [];
  try {
    busy = await getFreeBusyForUser(userId, now.toISOString(), horizon.toISOString());
  } catch {
    busy = [];
  }
  const blocked = [
    ...(blocks || []).map((b: any) => [new Date(b.start_at).getTime(), new Date(b.end_at).getTime()]),
    ...(taken || []).map((a: any) => [new Date(a.proposed_at).getTime(), new Date(a.proposed_at).getTime() + durationMinutesFor(a.duration_minutes) * 60000]),
    ...busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]),
  ];
  const isFree = (s: number, e: number) => !blocked.some(([bs, be]) => bs < e && be > s);

  const fmt = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const slots: FreeSlot[] = [];
  for (let i = 0; i < days && slots.length < max; i++) {
    const day = new Date(now.getTime() + i * 86400 * 1000);
    const { dow, ymd } = localParts(day, tz);
    const dayRules = rules.filter((r) => r.day_of_week === dow && ruleMatchesType(r, options.type));
    let countDay = 0;
    // Deux créneaux par jour, pris au début et au milieu de la plage : plus
    // naturel que deux créneaux collés à 8h et 9h.
    for (const r of dayRules) {
      const startMin = Number(r.start_time.slice(0, 2)) * 60 + Number(r.start_time.slice(3, 5));
      const endMin = Number(r.end_time.slice(0, 2)) * 60 + Number(r.end_time.slice(3, 5));
      const candidates = [startMin + 60, Math.floor((startMin + endMin) / 2 / 30) * 30, endMin - slotMinutes - 60].filter((m) => m >= startMin && m + slotMinutes <= endMin);
      for (const m of Array.from(new Set(candidates)).sort((a, b) => a - b)) {
        if (countDay >= perDay || slots.length >= max) break;
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const s = localToUtc(ymd, `${hh}:${mm}`, tz);
        const e = new Date(s.getTime() + slotMinutes * 60000);
        if (s < earliest) continue;
        if (!isFree(s.getTime(), e.getTime())) continue;
        slots.push({ startISO: s.toISOString(), endISO: e.toISOString(), label: fmt.format(s) });
        countDay++;
      }
    }
  }
  return { slots, timeZone: tz, declared };
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export const CONFIRMATION_TEXTS: Record<string, { intl: string; subject: string; hello: string; confirmed: string; moved: string; movedSubject: string; types: Record<AppointmentType, string>; link: string; linkLater: string; address: string; invite: string; reschedule: string; bye: string; cancelSubject: string; cancelBody: string; cancelBye: string }> = {
  fr: { intl: 'fr-FR', subject: "C'est confirmé pour notre rendez-vous", hello: 'Bonjour {name},', confirmed: "C'est confirmé pour notre rendez-vous {type}, le {date}.", movedSubject: 'Notre rendez-vous est décalé', moved: "J'ai dû décaler notre rendez-vous {type} : il est maintenant prévu le {date}. J'espère que ce nouveau créneau vous convient ; sinon, dites-moi ce qui vous arrange.", types: { visio: 'en visio', telephonique: 'par téléphone', physique: 'sur place' }, link: 'Voici le lien pour nous rejoindre : {link}', linkLater: 'Je vous envoie le lien de connexion dans un second email.', address: 'Adresse : {address}', invite: 'Vous recevrez également une invitation pour votre agenda.', reschedule: 'Si vous avez besoin de décaler, répondez simplement à cet email.', bye: 'À très vite,', cancelSubject: 'Concernant notre rendez-vous', cancelBody: "Je suis désolé, je dois annuler notre rendez-vous {type} prévu le {date}. Je reviens vers vous très vite pour vous proposer un nouveau créneau ; si vous avez une préférence, dites-la-moi simplement en réponse à cet email.", cancelBye: 'Avec mes excuses pour ce contretemps,' },
  en: { intl: 'en-GB', subject: 'Our meeting is confirmed', hello: 'Hello {name},', confirmed: 'Our meeting {type} is confirmed for {date}.', movedSubject: 'Our meeting has moved', moved: 'I had to move our meeting {type}: it is now scheduled for {date}. I hope the new time works for you; if not, just tell me what suits you.', types: { visio: 'by video call', telephonique: 'by phone', physique: 'in person' }, link: 'Here is the link to join: {link}', linkLater: 'I will send you the connection link in a second email.', address: 'Address: {address}', invite: 'You will also receive a calendar invitation.', reschedule: 'If you need to reschedule, just reply to this email.', bye: 'Speak soon,', cancelSubject: 'About our meeting', cancelBody: 'I am sorry, I have to cancel our meeting {type} planned for {date}. I will come back to you very soon with a new time; if you have a preference, just reply to this email.', cancelBye: 'With my apologies for the inconvenience,' },
  de: { intl: 'de-DE', subject: 'Unser Termin ist bestätigt', hello: 'Guten Tag {name},', confirmed: 'Unser Termin {type} ist bestätigt: {date}.', movedSubject: 'Unser Termin wurde verschoben', moved: 'Ich musste unseren Termin {type} verschieben: er findet nun am {date} statt. Ich hoffe, der neue Zeitpunkt passt Ihnen; falls nicht, sagen Sie mir einfach, was Ihnen besser passt.', types: { visio: 'per Videoanruf', telephonique: 'per Telefon', physique: 'vor Ort' }, link: 'Hier ist der Link zur Teilnahme: {link}', linkLater: 'Den Zugangslink sende ich Ihnen in einer zweiten E-Mail.', address: 'Adresse: {address}', invite: 'Sie erhalten außerdem eine Kalendereinladung.', reschedule: 'Falls Sie verschieben müssen, antworten Sie einfach auf diese E-Mail.', bye: 'Bis bald,', cancelSubject: 'Zu unserem Termin', cancelBody: 'Es tut mir leid, ich muss unseren Termin {type} am {date} absagen. Ich melde mich sehr bald mit einem neuen Vorschlag; wenn Sie eine Präferenz haben, antworten Sie einfach auf diese E-Mail.', cancelBye: 'Mit der Bitte um Entschuldigung,' },
  it: { intl: 'it-IT', subject: 'Il nostro appuntamento è confermato', hello: 'Buongiorno {name},', confirmed: 'Il nostro appuntamento {type} è confermato per {date}.', movedSubject: 'Il nostro appuntamento è stato spostato', moved: 'Ho dovuto spostare il nostro appuntamento {type}: ora è previsto per {date}. Spero che il nuovo orario le vada bene; in caso contrario, mi dica cosa preferisce.', types: { visio: 'in videochiamata', telephonique: 'per telefono', physique: 'di persona' }, link: 'Ecco il link per collegarsi: {link}', linkLater: 'Le invierò il link di collegamento in una seconda email.', address: 'Indirizzo: {address}', invite: 'Riceverà anche un invito per la sua agenda.', reschedule: 'Se ha bisogno di spostarlo, risponda semplicemente a questa email.', bye: 'A presto,', cancelSubject: 'Riguardo al nostro appuntamento', cancelBody: 'Mi dispiace, devo annullare il nostro appuntamento {type} previsto per {date}. La ricontatto molto presto per proporle un nuovo orario; se ha una preferenza, me lo dica rispondendo a questa email.', cancelBye: 'Con le mie scuse per il contrattempo,' },
  es: { intl: 'es-ES', subject: 'Nuestra reunión está confirmada', hello: 'Hola {name},', confirmed: 'Nuestra reunión {type} está confirmada para el {date}.', movedSubject: 'Nuestra reunión se ha movido', moved: 'He tenido que mover nuestra reunión {type}: ahora está prevista para el {date}. Espero que el nuevo horario le convenga; si no, dígame qué le viene mejor.', types: { visio: 'por videollamada', telephonique: 'por teléfono', physique: 'presencial' }, link: 'Aquí tiene el enlace para unirse: {link}', linkLater: 'Le enviaré el enlace de conexión en un segundo correo.', address: 'Dirección: {address}', invite: 'También recibirá una invitación para su agenda.', reschedule: 'Si necesita cambiar la fecha, responda simplemente a este correo.', bye: 'Hasta pronto,', cancelSubject: 'Sobre nuestra reunión', cancelBody: 'Lo siento, debo cancelar nuestra reunión {type} prevista para el {date}. Le escribiré muy pronto para proponerle un nuevo horario; si tiene una preferencia, dígamela respondiendo a este correo.', cancelBye: 'Con mis disculpas por el contratiempo,' },
  pt: { intl: 'pt-PT', subject: 'A nossa reunião está confirmada', hello: 'Olá {name},', confirmed: 'A nossa reunião {type} está confirmada para {date}.', movedSubject: 'A nossa reunião foi adiada', moved: 'Tive de adiar a nossa reunião {type}: está agora marcada para {date}. Espero que o novo horário lhe convenha; caso contrário, diga-me o que prefere.', types: { visio: 'por videochamada', telephonique: 'por telefone', physique: 'presencial' }, link: 'Aqui está o link para entrar: {link}', linkLater: 'Envio-lhe o link de ligação num segundo email.', address: 'Morada: {address}', invite: 'Receberá também um convite para a sua agenda.', reschedule: 'Se precisar de remarcar, basta responder a este email.', bye: 'Até breve,', cancelSubject: 'Sobre a nossa reunião', cancelBody: 'Lamento, tenho de cancelar a nossa reunião {type} prevista para {date}. Volto a contactá-lo muito em breve com um novo horário; se tiver uma preferência, basta responder a este email.', cancelBye: 'Com as minhas desculpas pelo contratempo,' },
  nl: { intl: 'nl-NL', subject: 'Onze afspraak is bevestigd', hello: 'Hallo {name},', confirmed: 'Onze afspraak {type} is bevestigd voor {date}.', movedSubject: 'Onze afspraak is verplaatst', moved: 'Ik moest onze afspraak {type} verplaatsen: hij staat nu gepland op {date}. Ik hoop dat het nieuwe tijdstip schikt; zo niet, laat me dan weten wat je beter uitkomt.', types: { visio: 'via videogesprek', telephonique: 'telefonisch', physique: 'ter plaatse' }, link: 'Hier is de link om deel te nemen: {link}', linkLater: 'De verbindingslink stuur ik je in een tweede e-mail.', address: 'Adres: {address}', invite: 'Je ontvangt ook een agenda-uitnodiging.', reschedule: 'Moet je verzetten? Beantwoord dan gewoon deze e-mail.', bye: 'Tot snel,', cancelSubject: 'Over onze afspraak', cancelBye: 'Met mijn excuses voor het ongemak,', cancelBody: 'Het spijt me, ik moet onze afspraak {type} van {date} annuleren. Ik kom heel snel bij je terug met een nieuw tijdstip; heb je een voorkeur, antwoord dan gewoon op deze e-mail.' },
};

type AppointmentRow = {
  id: string;
  user_id: string;
  prospect_id: string | null;
  type: string;
  proposed_at: string;
  duration_minutes?: number | null;
  status: string;
  calendar_provider?: string | null;
  calendar_event_id?: string | null;
  meet_link?: string | null;
  prospects?: { full_name: string | null; email: string | null; assigned_user_id: string | null; prospect_companies?: { address?: string | null; found_by_campaign_id?: string | null } | null } | null;
};

export async function loadAppointment(appointmentId: string): Promise<AppointmentRow | null> {
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('*, prospects(full_name, email, assigned_user_id, prospect_companies(address, found_by_campaign_id))')
    .eq('id', appointmentId)
    .single();
  return (data as any) || null;
}

async function prospectLanguageAndZone(appointment: AppointmentRow, userId: string) {
  const [{ data: seller }, { data: campaign }] = await Promise.all([
    supabaseAdmin.from('users').select('timezone, billing_country, locale, full_name').eq('id', userId).maybeSingle(),
    appointment.prospects?.prospect_companies?.found_by_campaign_id
      ? supabaseAdmin.from('prospecting_campaigns').select('target_locale').eq('id', appointment.prospects.prospect_companies.found_by_campaign_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  const locale = resolveProspectLocale({
    campaignLocale: (campaign as any)?.target_locale || null,
    address: appointment.prospects?.prospect_companies?.address || null,
    email: appointment.prospects?.email || null,
    sellerLocale: (seller as any)?.locale || null,
  });
  const tz = resolveUserTimeZone((seller as any) || {});
  return { locale, tz, seller: seller as any };
}

function fmtDate(iso: string, T: (typeof CONFIRMATION_TEXTS)['fr'], tz: string) {
  return new Date(iso).toLocaleString(T.intl, { dateStyle: 'full', timeStyle: 'short', timeZone: tz });
}

export type ConfirmResult =
  | { ok: true; calendarWarning: string | null; meetLink: string | null; reasons?: undefined }
  | { ok: false; conflict: true; reasons: string[]; calendarWarning?: undefined };

// Confirme un rendez-vous : conflits (sauf force), événement d'agenda, lien
// visio, email de confirmation dans la langue du prospect, prospect en bleu.
// `moved` : le même parcours pour un report (texte « décalé » au lieu de
// « confirmé »).
export async function confirmAppointment(
  appointmentId: string,
  userId: string,
  options: { force?: boolean; moved?: boolean; meetingAddress?: string | null } = {}
): Promise<ConfirmResult> {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment) throw new Error('RDV introuvable');

  const startISO = appointment.proposed_at;
  const endISO = new Date(new Date(startISO).getTime() + durationMinutesFor(appointment.duration_minutes) * 60000).toISOString();

  if (!options.force) {
    const reasons = await schedulingConflicts(userId, startISO, endISO, appointment.type);
    if (reasons.length) return { ok: false, conflict: true, reasons };
  }

  const { data: connections } = await supabaseAdmin.from('oauth_connections').select('provider').eq('user_id', userId);
  const hasGoogle = connections?.some((c) => c.provider === 'google');
  const hasMicrosoft = connections?.some((c) => c.provider === 'microsoft');
  const name = appointment.prospects?.full_name || '';

  let calendarEvent: any = null;
  let calendarProvider: 'google' | 'microsoft' | null = null;
  let calendarWarning: string | null = null;
  if (hasGoogle) {
    try {
      calendarEvent = await createGoogleCalendarEvent(userId, { title: `RDV avec ${name}`, description: `Rendez-vous ${appointment.type} avec ${name}.`, startISO, endISO, attendeeEmail: appointment.prospects?.email || undefined, wantsMeetLink: appointment.type === 'visio' });
      calendarProvider = 'google';
    } catch (err: any) {
      console.error('Erreur creation evenement Google Calendar:', err?.message);
      calendarWarning = "Le rendez-vous est validé, mais l'invitation d'agenda Google n'a pas pu être créée. Vérifiez la connexion Google dans Mon compte.";
    }
  } else if (hasMicrosoft) {
    try {
      calendarEvent = await createOutlookCalendarEvent(userId, { title: `RDV avec ${name}`, description: `Rendez-vous ${appointment.type} avec ${name}.`, startISO, endISO, attendeeEmail: appointment.prospects?.email || undefined, wantsMeetLink: appointment.type === 'visio' });
      calendarProvider = 'microsoft';
    } catch (err: any) {
      console.error('Erreur creation evenement Outlook Calendar:', err?.message);
      calendarWarning = "Le rendez-vous est validé, mais l'invitation d'agenda Outlook n'a pas pu être créée. Vérifiez la connexion Microsoft dans Mon compte.";
    }
  }

  const meetLink = appointment.type === 'visio' ? await resolveMeetingLink(userId, (calendarEvent as any)?.meetLink, startISO) : null;

  await supabaseAdmin
    .from('appointments')
    .update({ status: 'validé', calendar_provider: calendarProvider, calendar_event_id: calendarEvent?.id || null, meet_link: meetLink })
    .eq('id', appointmentId);

  if (appointment.prospects?.email) {
    const { locale, tz, seller } = await prospectLanguageAndZone(appointment, userId);
    const T = CONFIRMATION_TEXTS[locale] || CONFIRMATION_TEXTS.fr;
    const typeLabel = T.types[appointment.type as AppointmentType] || T.types.physique;
    const dateStr = fmtDate(startISO, T, tz);
    const lines = [T.hello.replace('{name}', name), '', (options.moved ? T.moved : T.confirmed).replace('{type}', typeLabel).replace('{date}', dateStr)];
    if (meetLink) lines.push('', T.link.replace('{link}', meetLink));
    else if (appointment.type === 'visio') lines.push('', T.linkLater);
    // Rendez-vous physique : l'adresse du commercial (sa société) si elle est
    // connue — « si c'est un rdv physique alors l'adresse » (Alex).
    if (appointment.type === 'physique') {
      const address = options.meetingAddress ?? (await sellerAddress(userId));
      if (address) lines.push('', T.address.replace('{address}', address));
    }
    if (calendarProvider) lines.push('', T.invite);
    lines.push('', T.reschedule, '', T.bye);
    const subject = options.moved ? T.movedSubject : T.subject;
    runInBackground(`confirmation RDV ${appointmentId}`, () => sendEmailForUser(userId, appointment.prospects!.email!, subject, lines.join('\n')));
    void seller;
  }

  if (appointment.prospect_id) {
    await supabaseAdmin.from('prospects').update({ status: 'bleu', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);
  }
  return { ok: true, calendarWarning, meetLink };
}

async function sellerAddress(userId: string): Promise<string | null> {
  const { data: u } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).maybeSingle();
  if (!u?.company_id) return null;
  const { data: c } = await supabaseAdmin.from('companies').select('billing_address').eq('id', u.company_id).maybeSingle();
  const raw: any = (c as any)?.billing_address || null;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  const parts = [raw.line1, raw.line2, [raw.postal_code, raw.city].filter(Boolean).join(' '), raw.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Confirmation automatique d'un rendez-vous que le prospect vient d'accepter.
// Renvoie 'confirmed' ou la raison pour laquelle il reste « proposé ».
export async function autoConfirmIfPossible(appointmentId: string, userId: string): Promise<{ result: 'confirmed' | 'too_soon' | 'unavailable' | 'error'; reasons?: string[] }> {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment || appointment.status !== 'proposé') return { result: 'error' };
  const hoursAhead = (new Date(appointment.proposed_at).getTime() - Date.now()) / 3600000;
  if (hoursAhead < AUTO_CONFIRM_MIN_HOURS) return { result: 'too_soon' };
  try {
    const r = await confirmAppointment(appointmentId, userId, { force: false });
    if (r.ok) return { result: 'confirmed' };
    return { result: 'unavailable', reasons: r.reasons };
  } catch (err: any) {
    console.error('[appointment-flow] confirmation automatique:', err?.message || err);
    return { result: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Annulation et report
// ---------------------------------------------------------------------------

// Brouillon d'annulation (langue du prospect) que le commercial relit et
// envoie lui-même.
export async function cancellationDraft(appointmentId: string, userId: string): Promise<{ subject: string; body: string } | null> {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment || !appointment.prospects?.email) return null;
  const { locale, tz } = await prospectLanguageAndZone(appointment, userId);
  const T = CONFIRMATION_TEXTS[locale] || CONFIRMATION_TEXTS.fr;
  const typeLabel = T.types[appointment.type as AppointmentType] || T.types.physique;
  const body = [T.hello.replace('{name}', appointment.prospects.full_name || ''), '', T.cancelBody.replace('{type}', typeLabel).replace('{date}', fmtDate(appointment.proposed_at, T, tz)), '', T.cancelBye].join('\n');
  return { subject: T.cancelSubject, body };
}

export async function removeCalendarEvent(appointment: AppointmentRow, userId: string) {
  if (!appointment.calendar_event_id || !appointment.calendar_provider) return;
  try {
    if (appointment.calendar_provider === 'google') await deleteGoogleCalendarEvent(userId, appointment.calendar_event_id);
    else if (appointment.calendar_provider === 'microsoft') await deleteOutlookCalendarEvent(userId, appointment.calendar_event_id);
  } catch (err: any) {
    console.error('[appointment-flow] suppression événement agenda:', err?.message || err);
  }
}

// Report : nouvelle date, ancien événement retiré, nouveau créé, prospect
// prévenu (« décalé »). Force : le commercial a choisi lui-même la date.
export async function rescheduleAppointment(appointmentId: string, userId: string, newStartISO: string): Promise<ConfirmResult> {
  const appointment = await loadAppointment(appointmentId);
  if (!appointment) throw new Error('RDV introuvable');
  await removeCalendarEvent(appointment, userId);
  await supabaseAdmin
    .from('appointments')
    .update({ proposed_at: newStartISO, status: 'proposé', calendar_event_id: null, calendar_provider: null, meet_link: null })
    .eq('id', appointmentId);
  return confirmAppointment(appointmentId, userId, { force: true, moved: true });
}
