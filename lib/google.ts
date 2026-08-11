// lib/google.ts
// Toutes les interactions avec Gmail et Google Calendar pour un utilisateur donné.

import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';

interface OAuthConnection {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

// Récupère un access_token valide pour l'utilisateur (le rafraîchit si expiré)
async function getValidAccessToken(userId: string): Promise<string> {
  const { data: connection, error } = await supabaseAdmin
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single<OAuthConnection>();

  if (error || !connection) {
    throw new Error(`Aucune connexion Google trouvée pour l'utilisateur ${userId}`);
  }

  const isExpired = new Date(connection.expires_at).getTime() < Date.now() + 60_000; // marge 1 min

  if (!isExpired) {
    return decryptToken(connection.access_token);
  }

  // Rafraîchit le token
  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('Échec du rafraîchissement du token Google — reconnexion requise');
  }

  const newTokens = await response.json();
  const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from('oauth_connections')
    .update({
      access_token: encryptToken(newTokens.access_token),
      expires_at: newExpiresAt,
    })
    .eq('id', connection.id);

  return newTokens.access_token;
}

// Envoie un email via l'API Gmail (au nom du commercial connecté)
export async function sendGmailEmail(userId: string, to: string, subject: string, body: string) {
  const accessToken = await getValidAccessToken(userId);

  const rawMessage = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur envoi Gmail: ${err}`);
  }

  return response.json(); // { id, threadId, labelIds }
}

// Envoie un email "système" (confirmation de compte, etc.), pas encore lié à un
// commercial précis (ex: juste après l'inscription, avant même la création de
// la société). En attendant qu'aaron@meetaaron.app ait sa propre connexion OAuth
// dans l'app, on réutilise un compte Google déjà connecté et fonctionnel
// (configurable via SYSTEM_EMAIL_SENDER_USER_ID) pour ne pas dépendre du SMTP
// par défaut de Supabase (peu fiable / rate-limité).
export async function sendSystemEmail(to: string, subject: string, body: string) {
  const senderUserId = process.env.SYSTEM_EMAIL_SENDER_USER_ID;
  if (!senderUserId) {
    throw new Error(
      'SYSTEM_EMAIL_SENDER_USER_ID manquant — ajouter cette variable d\'environnement ' +
      '(id de la ligne users dont le compte Google est connecté) pour activer l\'envoi ' +
      'des emails système (confirmation de compte, etc.).'
    );
  }
  return sendGmailEmail(senderUserId, to, subject, body);
}

// Vérifie les créneaux déjà occupés sur le calendrier Google du commercial
// (RDV client existant, RDV docteur, etc.) via l'API freebusy.
// Retourne un tableau de { start, end } (ISO strings) représentant les
// créneaux occupés dans la plage demandée.
export async function getGoogleFreeBusy(userId: string, timeMinISO: string, timeMaxISO: string) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: 'primary' }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur freeBusy Google Calendar: ${err}`);
  }

  const data = await response.json();
  const busy = data.calendars?.primary?.busy || [];
  return busy as { start: string; end: string }[];
}

// Liste les nouveaux messages reçus depuis une date donnée (pour le cron de lecture)
export async function listNewGmailMessages(userId: string, afterTimestamp: number) {
  const accessToken = await getValidAccessToken(userId);
  const query = `after:${Math.floor(afterTimestamp / 1000)} in:inbox`;

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error('Erreur lecture Gmail');
  }

  const data = await response.json();
  return data.messages || []; // liste de { id, threadId } — à récupérer en détail ensuite
}

// Récupère le contenu complet d'un message Gmail
export async function getGmailMessage(userId: string, messageId: string) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error('Erreur récupération message Gmail');
  }

  return response.json();
}

// Crée un événement dans Google Calendar
export async function createGoogleCalendarEvent(
  userId: string,
  params: { title: string; description: string; startISO: string; endISO: string; attendeeEmail: string }
) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.title,
        description: params.description,
        start: { dateTime: params.startISO },
        end: { dateTime: params.endISO },
        attendees: [{ email: params.attendeeEmail }],
        reminders: { useDefault: true },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur création événement Google Calendar: ${err}`);
  }

  return response.json(); // contient event.id -> à stocker dans appointments.calendar_event_id
}
