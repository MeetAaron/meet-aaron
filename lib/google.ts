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

const AARON_LABEL_NAME = '🤖 Géré par Aaron';

// Le commercial voit ses échanges dans SA propre boîte Gmail (Aaron envoie/lit
// en son nom). Pour qu'il sache, en un coup d'œil dans sa boîte, quels fils il
// ne doit PAS traiter lui-même, on pose un label Gmail dédié sur chaque fil
// qu'Aaron gère. Créé une seule fois par compte, puis réutilisé (Gmail renvoie
// une erreur si on tente de recréer un label existant — on gère ça en listant
// d'abord plutôt qu'en se fiant à un cache qui pourrait devenir périmé si le
// commercial supprime le label lui-même).
async function getOrCreateAaronLabelId(userId: string): Promise<string | null> {
  try {
    const accessToken = await getValidAccessToken(userId);

    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const { labels } = await listRes.json();
      const existing = labels?.find((l: any) => l.name === AARON_LABEL_NAME);
      if (existing) return existing.id;
    }

    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: AARON_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return created.id;
  } catch (err: any) {
    console.error('Erreur récupération/création du label Gmail Aaron:', err.message);
    return null;
  }
}

// Pose le label "🤖 Géré par Aaron" sur un fil Gmail entier (donc sur tous les
// messages du fil, passés et à venir tant qu'ils y restent rattachés). Échec
// silencieux : un souci de label ne doit jamais empêcher l'envoi/la lecture
// d'un email, c'est purement un repère visuel pour le commercial.
export async function applyAaronLabel(userId: string, threadId: string | undefined | null) {
  if (!threadId) return;
  try {
    const labelId = await getOrCreateAaronLabelId(userId);
    if (!labelId) return;

    const accessToken = await getValidAccessToken(userId);
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  } catch (err: any) {
    console.error('Erreur pose du label Gmail Aaron:', err.message);
  }
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

  const sent = await response.json(); // { id, threadId, labelIds }

  // Best-effort : n'importe quel email envoyé par Aaron au nom du commercial
  // marque le fil comme "géré par Aaron" dans sa boîte (voir applyAaronLabel).
  // sendSystemEmail (confirmation de compte, etc.) passe aussi par ici mais ce
  // n'est pas un souci : ce ne sont pas des fils de prospection.
  applyAaronLabel(userId, sent.threadId).catch(() => {});

  return sent;
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

// Récupère le texte brut du dernier email ENVOYÉ par le commercial (dossier
// "Envoyés"), pour tenter d'en extraire sa signature (voir lib/signature.ts).
// Renvoie null s'il n'y a aucun email envoyé ou si le contenu est illisible.
export async function getLastSentGmailBodyText(userId: string): Promise<string | null> {
  const accessToken = await getValidAccessToken(userId);

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('in:sent')}&maxResults=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error('Erreur lecture Gmail (envoyés)');
  const listData = await listRes.json();
  const messageId = listData.messages?.[0]?.id;
  if (!messageId) return null;

  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error('Erreur récupération email envoyé');
  const msg = await msgRes.json();

  const payload = msg.payload;
  if (payload?.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  const textPart = payload?.parts?.find((p: any) => p.mimeType === 'text/plain');
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
  }
  return null;
}

// Crée un événement dans Google Calendar
export async function createGoogleCalendarEvent(
  userId: string,
  params: {
    title: string;
    description: string;
    startISO: string;
    endISO: string;
    attendeeEmail: string;
    // Si true (RDV de type "visio"), demande à Google de générer automatiquement
    // un lien Google Meet rattaché à l'événement.
    wantsMeetLink?: boolean;
  }
) {
  const accessToken = await getValidAccessToken(userId);

  const body: any = {
    summary: params.title,
    description: params.description,
    start: { dateTime: params.startISO },
    end: { dateTime: params.endISO },
    attendees: [{ email: params.attendeeEmail }],
    reminders: { useDefault: true },
  };

  if (params.wantsMeetLink) {
    body.conferenceData = {
      createRequest: {
        // Identifiant unique requis par l'API pour éviter les doublons de création
        requestId: `meetaaron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  // sendUpdates=all : sans ce paramètre, Google n'envoie aucune notification au
  // prospect invité — il ne recevrait jamais l'invitation ni le lien Google Meet.
  const query = params.wantsMeetLink ? 'conferenceDataVersion=1&sendUpdates=all' : 'sendUpdates=all';
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur création événement Google Calendar: ${err}`);
  }

  const event = await response.json();
  return {
    ...event,
    meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || null,
  };
  // contient event.id -> à stocker dans appointments.calendar_event_id, et meetLink si visio
}
