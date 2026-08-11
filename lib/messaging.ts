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

// Envoie un email depuis la boîte du commercial, en choisissant automatiquement
// Gmail ou Outlook selon ce qu'il a connecté. Si les deux sont connectés,
// Google reste prioritaire (comportement historique inchangé pour ces comptes).
export async function sendEmailForUser(userId: string, to: string, subject: string, body: string) {
  const providers = await getConnectedProviders(userId);

  if (providers.has('google')) {
    return sendGmailEmail(userId, to, subject, body);
  }
  if (providers.has('microsoft')) {
    return sendOutlookEmail(userId, to, subject, body);
  }
  throw new Error(`Aucune boîte mail connectée (Google ou Microsoft) pour l'utilisateur ${userId}`);
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
