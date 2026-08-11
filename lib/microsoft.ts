// lib/microsoft.ts
// Interactions avec Outlook Calendar via Microsoft Graph, pour un utilisateur donné.

import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';

interface OAuthConnection {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function getValidAccessToken(userId: string): Promise<string> {
  const { data: connection, error } = await supabaseAdmin
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .single<OAuthConnection>();

  if (error || !connection) {
    throw new Error(`Aucune connexion Microsoft trouvée pour l'utilisateur ${userId}`);
  }

  const isExpired = new Date(connection.expires_at).getTime() < Date.now() + 60_000;

  if (!isExpired) {
    return decryptToken(connection.access_token);
  }

  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('Échec du rafraîchissement du token Microsoft — reconnexion requise');
  }

  const newTokens = await response.json();
  const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from('oauth_connections')
    .update({
      access_token: encryptToken(newTokens.access_token),
      refresh_token: encryptToken(newTokens.refresh_token), // Microsoft renvoie un nouveau refresh_token à chaque fois
      expires_at: newExpiresAt,
    })
    .eq('id', connection.id);

  return newTokens.access_token;
}

// Envoie un email via Microsoft Graph (boîte Outlook du commercial), pour que
// Outlook soit un vrai second fournisseur au même titre que Gmail (prospection,
// relances, annulations...) et pas seulement pour la création de RDV.
export async function sendOutlookEmail(userId: string, to: string, subject: string, body: string) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur envoi Outlook: ${err}`);
  }

  // /sendMail répond 202 sans corps — on renvoie un objet simple pour rester
  // cohérent avec la forme de retour de sendGmailEmail côté appelant.
  return { sent: true };
}

// Créneaux occupés du calendrier Outlook du commercial sur la plage demandée
// (équivalent de getGoogleFreeBusy, utilisé pour la détection de conflit RDV).
export async function getOutlookFreeBusy(userId: string, timeMinISO: string, timeMaxISO: string) {
  const accessToken = await getValidAccessToken(userId);

  const params = new URLSearchParams({ startDateTime: timeMinISO, endDateTime: timeMaxISO });

  const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur calendarView Outlook: ${err}`);
  }

  const data = await response.json();
  return (data.value || []).map((event: any) => ({
    start: event.start.dateTime.endsWith('Z') ? event.start.dateTime : `${event.start.dateTime}Z`,
    end: event.end.dateTime.endsWith('Z') ? event.end.dateTime : `${event.end.dateTime}Z`,
  })) as { start: string; end: string }[];
}

// Liste les nouveaux messages reçus depuis une date donnée (pour le cron de lecture)
export async function listNewOutlookMessages(userId: string, afterTimestamp: number) {
  const accessToken = await getValidAccessToken(userId);
  const afterISO = new Date(afterTimestamp).toISOString();

  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${afterISO}`,
    $select: 'id',
    $orderby: 'receivedDateTime desc',
  });

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error('Erreur lecture messages Outlook');
  }

  const data = await response.json();
  return (data.value || []) as { id: string }[]; // même forme que listNewGmailMessages
}

// Récupère le contenu complet d'un message Outlook
export async function getOutlookMessage(userId: string, messageId: string) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=from,body,subject,receivedDateTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error('Erreur récupération message Outlook');
  }

  return response.json(); // { from: { emailAddress: { address, name } }, body: { contentType, content }, ... }
}

// Crée un événement dans le calendrier Outlook du commercial
export async function createOutlookCalendarEvent(
  userId: string,
  params: { title: string; description: string; startISO: string; endISO: string; attendeeEmail: string }
) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: params.title,
      body: { contentType: 'Text', content: params.description },
      start: { dateTime: params.startISO, timeZone: 'UTC' },
      end: { dateTime: params.endISO, timeZone: 'UTC' },
      attendees: [
        { emailAddress: { address: params.attendeeEmail }, type: 'required' },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur création événement Outlook: ${err}`);
  }

  return response.json(); // contient event.id -> à stocker dans appointments.calendar_event_id
}
