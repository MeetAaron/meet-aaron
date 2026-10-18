// lib/send-window.ts
// Créneaux d'envoi d'Aaron (demande Alex, 18/10/2026 : « as-tu mis en place
// les meilleures techniques de démarchage… le bon moment, la bonne heure, le
// bon jour, basé sur des données réelles ? »). Jusqu'ici Aaron envoyait au
// rythme des crons : un premier email pouvait partir à 3 h du matin ou un
// dimanche. Ce module décide QUAND un email de prospection a le droit de
// partir ; les crons génèrent quand ils veulent, mais n'envoient que dans
// la fenêtre, et reportent le reste au prochain créneau.
//
// Sur quoi c'est fondé (étude Belkins 2026 sur 7,5 millions d'emails à
// froid envoyés de janvier à novembre 2025 — belkins.io, « best time to send
// an email ») :
//   - heure d'envoi : 8 h–12 h = meilleur taux de réponse (0,54 %) ET de
//     rendez-vous (0,4 %, contre 0,1 % l'après-midi et le soir) ; 5 h–8 h
//     presque aussi bon ; après 12 h le taux de réponse baisse et le taux de
//     rendez-vous est divisé par quatre ;
//   - jour : mercredi et jeudi en tête (0,48 %), lundi/mardi juste derrière
//     (0,45 %), vendredi un peu moins (0,44 %), samedi nettement moins
//     (0,35 %) ;
//   - l'étude recommande l'heure LOCALE du destinataire.
// Mêmes ordres de grandeur dans les études HubSpot / Yesware / Superhuman
// des années précédentes : le matin en semaine, jamais le week-end.
//
// Règles retenues :
//   PREMIER CONTACT et RELANCES (« prospecting ») : lundi→vendredi, 8 h–11 h 59
//     heure locale. Un email généré hors créneau est stocké et part au
//     prochain créneau (voir applyAaronOutput, retry-uncontacted-prospects,
//     send-prospect-followups).
//   RÉPONSES d'Aaron à un prospect qui a écrit : lundi→vendredi, 8 h–18 h 59.
//     Un commercial humain répond dans la journée, pas à 23 h ni le dimanche
//     — et c'est bien un humain qu'Aaron doit imiter (il écrit depuis la
//     boîte du commercial). Hors créneau, la réponse part au prochain
//     créneau, avec quelques minutes de décalage aléatoire pour ne pas
//     « ouvrir le bureau » à 8 h 00 pile chaque jour.
//
// Fuseau : celui du COMMERCIAL (users.timezone relevé dans le navigateur,
// sinon pays de facturation — lib/user-timezone.ts). Les campagnes visent
// une zone proche de lui (« Lyon et alentours »), c'est le meilleur proxy
// dont on dispose sans connaître l'adresse exacte de chaque prospect.
// Limite connue : un commercial à Perth qui prospecte Paris enverrait aux
// heures de Perth — à affiner quand les campagnes porteront un fuseau.
//
// Phase 2 (pas encore faite) : apprendre les meilleurs créneaux PAR COMPTE
// à partir des réponses réellement reçues (messages sortants → réponse dans
// les 7 jours, par heure et jour d'envoi) et resserrer la fenêtre dessus
// dès qu'il y a assez de données.

import { localParts } from './user-timezone';

export type SendKind = 'prospecting' | 'reply';

interface Window {
  startHour: number; // inclus
  endHour: number; // exclu
  weekdays: number[]; // 1 = lundi … 7 = dimanche
}

export const SEND_WINDOWS: Record<SendKind, Window> = {
  prospecting: { startHour: 8, endHour: 12, weekdays: [1, 2, 3, 4, 5] },
  reply: { startHour: 8, endHour: 19, weekdays: [1, 2, 3, 4, 5] },
};

export function isSendWindowOpen(kind: SendKind, timeZone: string, now: Date = new Date()): boolean {
  const w = SEND_WINDOWS[kind];
  const { hour, weekday } = localParts(now, timeZone);
  return w.weekdays.includes(weekday) && hour >= w.startHour && hour < w.endHour;
}

// Prochain instant (UTC) où la fenêtre sera ouverte — l'instant courant si
// elle l'est déjà. Cherche heure par heure sur au plus 8 jours : simple,
// sans arithmétique de fuseau à la main, et largement assez rapide pour
// quelques dizaines d'appels par passage de cron.
export function nextSendWindowOpening(kind: SendKind, timeZone: string, now: Date = new Date()): Date {
  if (isSendWindowOpen(kind, timeZone, now)) return now;
  const w = SEND_WINDOWS[kind];
  // On se cale sur le début de l'heure suivante, puis on avance d'une heure
  // tant que la fenêtre est fermée.
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  t.setUTCHours(t.getUTCHours() + 1);
  for (let i = 0; i < 24 * 8; i += 1) {
    const { hour, weekday } = localParts(t, timeZone);
    if (w.weekdays.includes(weekday) && hour === w.startHour) return t;
    t.setUTCHours(t.getUTCHours() + 1);
  }
  return t;
}

// Décalage aléatoire (ms) ajouté à l'ouverture de fenêtre pour une réponse
// reportée : entre 5 et 40 minutes, pour que les réponses du matin ne
// partent pas toutes à la même minute.
export function replyJitterMs(): number {
  return (5 + Math.random() * 35) * 60 * 1000;
}
