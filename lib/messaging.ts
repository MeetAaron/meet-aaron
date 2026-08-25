// lib/messaging.ts
// Point d'entrée unique pour envoyer un email "au nom du commercial" ou pour
// vérifier ses disponibilités, quel que soit le fournisseur qu'il a connecté
// (Google ou Microsoft). Les crons et routes API doivent passer par ici plutôt
// que d'appeler directement sendGmailEmail/sendOutlookEmail — sinon un
// commercial qui n'a connecté qu'Outlook se retrouve avec des emails jamais
// envoyés (c'était le cas avant l'ajout du support Microsoft complet).

import { supabaseAdmin } from './supabase-admin';
import { sendGmailEmail, getGoogleFreeBusy } from './google';
import { sendOutlookEmail, getOutlookFreeBusy } from './microsoft';

async function getConnectedProviders(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider')
    .eq('user_id', userId);
  return new Set((data || []).map((c) => c.provider));
}

// Protection délivrabilité (ajoutée le 15/08, voir migration
// migration_email_deliverability_2026-08-15.sql) : plafond quotidien d'emails
// DE PROSPECTION (premiers contacts, relances automatiques, tentatives de
// sauvetage) par commercial, tous points d'entrée confondus (campagnes,
// ajout manuel, relances programmées, filet de rattrapage). Recommandation
// issue de la recherche marché — les taux de réponse chutent nettement à mesure
// que le volume d'envois automatisés grimpe sans plafond, et un domaine qui
// envoie trop d'un coup risque le spam plutôt que la boîte de réception.
// Les emails "transactionnels" (rappels de RDV, debriefs, confirmations à un
// client déjà engagé) ne sont PAS comptés ici : seul le volume de démarchage
// à froid menace la réputation du domaine, un rappel de RDV à quelqu'un qui a
// déjà répondu ne présente pas ce risque et ne doit jamais être bloqué par ce
// plafond.
export const DEFAULT_DAILY_PROSPECTING_CAP = 40;

export class DailySendCapExceededError extends Error {
  cap: number;
  constructor(userId: string, cap: number) {
    super(`Plafond quotidien d'emails de prospection atteint (${cap}/jour) pour l'utilisateur ${userId}`);
    this.name = 'DailySendCapExceededError';
    this.cap = cap;
  }
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Lecture seule, sans écrire — permet aux crons de sauter tôt un commercial
// déjà au plafond, AVANT de dépenser un appel Claude pour générer un email qui
// ne sera de toute façon pas envoyé. sendEmailForUser revérifie de toute façon
// au moment de l'envoi (protection même en cas d'appel direct hors cron, ou de
// concurrence entre deux crons pour le même commercial).
export async function hasReachedProspectingCap(userId: string): Promise<boolean> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('daily_prospecting_email_cap')
    .eq('id', userId)
    .maybeSingle();
  const cap = user?.daily_prospecting_email_cap ?? DEFAULT_DAILY_PROSPECTING_CAP;

  const { data: counter } = await supabaseAdmin
    .from('email_send_counters')
    .select('count')
    .eq('user_id', userId)
    .eq('day', todayISODate())
    .maybeSingle();

  return (counter?.count || 0) >= cap;
}

async function incrementProspectingCounter(userId: string): Promise<void> {
  const day = todayISODate();
  const { data: existing } = await supabaseAdmin
    .from('email_send_counters')
    .select('id, count')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from('email_send_counters').update({ count: existing.count + 1 }).eq('id', existing.id);
  } else {
    await supabaseAdmin.from('email_send_counters').insert({ user_id: userId, day, count: 1 });
  }
}

// Envoie un email depuis la boîte du commercial, en choisissant automatiquement
// Gmail ou Outlook selon ce qu'il a connecté. Si les deux sont connectés,
// Google reste prioritaire (comportement historique inchangé pour ces comptes).
// Ajoute automatiquement la signature du commercial en bas du message si elle
// est enregistrée (voir app/api/signature, app/app/preferences/page.jsx) —
// les brouillons générés par Aaron n'en contiennent pas eux-mêmes.
//
// opts.emailType : 'prospecting' (défaut 'transactional') soumet cet envoi au
// plafond quotidien de démarchage à froid — voir commentaire au-dessus de
// DEFAULT_DAILY_PROSPECTING_CAP. Ne marquer 'prospecting' que les envois de
// démarchage à froid (premier contact, relance automatique, sauvetage) —
// jamais les emails transactionnels vers un contact déjà engagé.
export async function sendEmailForUser(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: { emailType?: 'prospecting' | 'transactional' }
) {
  const emailType = opts?.emailType || 'transactional';

  if (emailType === 'prospecting' && (await hasReachedProspectingCap(userId))) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('daily_prospecting_email_cap')
      .eq('id', userId)
      .maybeSingle();
    throw new DailySendCapExceededError(userId, user?.daily_prospecting_email_cap ?? DEFAULT_DAILY_PROSPECTING_CAP);
  }

  const providers = await getConnectedProviders(userId);

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email_signature, email_signature_image_url')
    .eq('id', userId)
    .maybeSingle();

  // Signature avec image (carte de visite, demande Alex 2026-08-25) : un
  // texte brut ne peut pas afficher d'image, on bascule donc TOUT le message
  // en HTML uniquement dans ce cas précis — le chemin texte brut existant
  // (immense majorité des envois, signature texte seule ou aucune signature)
  // reste strictement inchangé pour ne rien casser ailleurs.
  let fullBody = body;
  let isHtml = false;
  if (user?.email_signature_image_url) {
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
    const signatureHtml = user.email_signature
      ? `<p style="margin:0 0 8px;">${escapeHtml(user.email_signature).replace(/\n/g, '<br>')}</p>`
      : '';
    fullBody = `<div>${bodyHtml}</div><br>${signatureHtml}<img src="${user.email_signature_image_url}" alt="Signature" style="max-width:280px;display:block;">`;
    isHtml = true;
  } else if (user?.email_signature) {
    fullBody = `${body}\n\n${user.email_signature}`;
  }

  let result;
  if (providers.has('google')) {
    result = await sendGmailEmail(userId, to, subject, fullBody, { html: isHtml });
  } else if (providers.has('microsoft')) {
    result = await sendOutlookEmail(userId, to, subject, fullBody, { html: isHtml });
  } else {
    throw new Error(`Aucune boîte mail connectée (Google ou Microsoft) pour l'utilisateur ${userId}`);
  }

  if (emailType === 'prospecting') {
    await incrementProspectingCounter(userId);
  }

  return result;
}

// Renvoie les créneaux occupés du commercial, en combinant Google ET Microsoft
// si les deux sont connectés (plutôt que d'en ignorer un des deux).
export async function getFreeBusyForUser(userId: string, timeMinISO: string, timeMaxISO: string) {
  const providers = await getConnectedProviders(userId);
  const busy: { start: string; end: string }[] = [];

  if (providers.has('google')) {
    try {
      busy.push(...(await getGoogleFreeBusy(userId, timeMinISO, timeMaxISO)));
    } catch (err: any) {
      console.error('Erreur vérification freebusy Google:', err.message);
    }
  }
  if (providers.has('microsoft')) {
    try {
      busy.push(...(await getOutlookFreeBusy(userId, timeMinISO, timeMaxISO)));
    } catch (err: any) {
      console.error('Erreur vérification freebusy Microsoft:', err.message);
    }
  }

  return busy;
}
