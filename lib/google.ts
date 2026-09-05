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
        // Couleur violette (palette imposée par l'API Gmail — pas de hex libre),
        // alignée avec le preset9 utilisé côté Outlook (lib/microsoft.ts) pour que
        // le marqueur soit visuellement cohérent quel que soit le fournisseur.
        color: { backgroundColor: '#a479e2', textColor: '#ffffff' },
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

// Sort un fil de la boîte de réception Gmail (option « Aaron range les fils
// qu'il gère », migration_aaron_archive_threads_2026-09-01.sql).
//
// Archiver = retirer le libellé INBOX. Rien n'est supprimé, le fil reste
// entièrement consultable et recherchable, et — c'est le point important —
// Gmail le REMET automatiquement en boîte de réception dès qu'un nouveau
// message y arrive. Le commercial reprend donc la main tout seul dès que le
// prospect répond, sans rien avoir à faire.
//
// Échec silencieux, comme applyAaronLabel : un problème de rangement ne doit
// jamais empêcher le traitement du message.
export async function archiveGmailThread(userId: string, threadId: string | undefined | null) {
  if (!threadId) return;
  try {
    const accessToken = await getValidAccessToken(userId);
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    });
  } catch (err: any) {
    console.error('Erreur archivage du fil Gmail:', err.message);
  }
}

// Pièce jointe au premier email (demande Alex, 27/08/2026 — voir
// lib/first-email-attachment.ts) : contenu déjà encodé en base64 par
// l'appelant (le fichier vient de Supabase Storage), on n'a plus qu'à
// l'insérer dans le MIME.
interface EmailAttachment {
  filename: string;
  contentBase64: string;
  mimeType: string;
}

// Envoie un email via l'API Gmail (au nom du commercial connecté). Avec
// opts.attachment, bascule sur un MIME multipart/mixed (corps + pièce
// jointe) plutôt que le message à une seule partie utilisé jusqu'ici — les
// deux formats sont acceptés par l'API Gmail sous la même route/paramètre
// "raw", donc aucun autre changement n'est nécessaire côté appelant.
//
// Réécriture MIME (30/08/2026, "message tronqué" constaté par Alex côté
// Gmail destinataire sur des emails pourtant minuscules) : l'ancienne
// construction violait les RFC 5322/2045 — fins de ligne LF au lieu de CRLF,
// et corps UTF-8 brut (accents = octets 8 bits) sans aucun
// Content-Transfer-Encoding déclaré. Selon le serveur qui relit le message,
// ces écarts produisent des rendus imprévisibles (affichage "[Message
// tronqué]", accents cassés, pièce jointe illisible). Désormais : CRLF
// partout, chaque partie texte/HTML encodée en base64 (lignes de 76 car.),
// et si opts.textAlternative est fourni avec opts.html, un vrai
// multipart/alternative texte + HTML — la même structure que produit le
// composeur Gmail lui-même, la mieux acceptée par tous les clients mail.
export async function sendGmailEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: { html?: boolean; textAlternative?: string; attachment?: EmailAttachment; skipAaronLabel?: boolean }
) {
  const accessToken = await getValidAccessToken(userId);

  const CRLF = '\r\n';
  const subjectHeader = `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  // Encode un contenu texte en base64 découpé en lignes de 76 caractères
  // (limite MIME/RFC 2045). Le base64 n'utilise jamais le caractère "-",
  // donc aucune ligne encodée ne peut entrer en collision avec un "--boundary".
  const base64Wrapped = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, `$1${CRLF}`);

  // Partie "contenu" du message : soit multipart/alternative (texte + HTML,
  // cas nominal des envois d'Aaron), soit une partie unique.
  let contentPart: string;
  if (opts?.html && opts?.textAlternative) {
    const altBoundary = `aaron_alt_${Date.now()}`;
    contentPart = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Wrapped(opts.textAlternative),
      `--${altBoundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Wrapped(body),
      `--${altBoundary}--`,
    ].join(CRLF);
  } else {
    contentPart = [
      opts?.html ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Wrapped(body),
    ].join(CRLF);
  }

  let rawMessage: string;
  if (opts?.attachment) {
    const mixedBoundary = `aaron_mixed_${Date.now()}`;
    const attachmentBase64Wrapped = opts.attachment.contentBase64.replace(/(.{76})/g, `$1${CRLF}`);
    rawMessage = [
      `To: ${to}`,
      subjectHeader,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      contentPart,
      '',
      `--${mixedBoundary}`,
      `Content-Type: ${opts.attachment.mimeType}; name="${opts.attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${opts.attachment.filename}"`,
      '',
      attachmentBase64Wrapped,
      `--${mixedBoundary}--`,
    ].join(CRLF);
  } else {
    rawMessage = [`To: ${to}`, subjectHeader, 'MIME-Version: 1.0', contentPart].join(CRLF);
  }

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
  //
  // AWAIT nécessaire (bug réel constaté par Alex, 27/08/2026 : premier email
  // envoyé, jamais étiqueté malgré un scope/permissions corrects) : cet appel
  // était auparavant fire-and-forget ("applyAaronLabel(...).catch(() => {})"
  // sans await). applyAaronLabel avale déjà ses propres erreurs en interne
  // (voir sa définition) — l'await ci-dessous ne peut donc jamais faire
  // échouer l'envoi — mais SANS l'attendre, la fonction serverless qui a
  // appelé sendGmailEmail peut renvoyer sa réponse HTTP et être gelée/tuée
  // par la plateforme avant que les 1-2 appels réseau internes à
  // applyAaronLabel (lister/créer le label, puis poser le label sur le fil)
  // aient eu le temps de se terminer — l'étiquette ne se pose alors jamais,
  // sans la moindre erreur visible nulle part.
  // skipAaronLabel (Alex, 04/09/2026) : les emails qu'Aaron envoie AU
  // COMMERCIAL LUI-MÊME (rapports du jour/semaine/mois, alertes) ne sont pas
  // des fils de prospection — le libellé « 🤖 Géré par Aaron » n'y a aucun
  // sens, et il poussait à archiver le rapport sans le lire.
  if (!opts?.skipAaronLabel) {
    await applyAaronLabel(userId, sent.threadId);
  }

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
//
// « in:anywhere » et non « in:inbox » (01/09/2026, question remontée par les
// commerciaux du père d'Alex : « on nous demande de supprimer les emails
// traités, doit-on faire pareil avec ceux d'Aaron ? »). Avec « in:inbox », un
// email archivé ou mis à la corbeille par le commercial AVANT le passage du
// cron (fenêtre de 5 min, ou bien plus après une coupure de connexion —
// voir computeLookbackTimestamp) devenait invisible pour Aaron : la réponse
// du prospect était perdue pour toujours, sans le moindre signal d'erreur.
// « in:anywhere » couvre la boîte de réception, les archives, la corbeille et
// les spams — le commercial peut donc ranger sa boîte comme il veut sans
// jamais casser le suivi. On exclut explicitement ses propres envois et
// brouillons, seuls dossiers que « in:inbox » excluait utilement (un message
// dont l'expéditeur est le commercial ne correspondrait de toute façon à
// aucun prospect en aval, mais autant ne pas les rapatrier du tout).
//
// Aucun risque de retraitement : le cron ignore tout message dont l'id est
// déjà en base (messages.provider_message_id — voir
// app/api/cron/check-inbox/route.ts).
export async function listNewGmailMessages(userId: string, afterTimestamp: number) {
  const accessToken = await getValidAccessToken(userId);
  const query = `after:${Math.floor(afterTimestamp / 1000)} in:anywhere -in:sent -in:draft -in:chats`;

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

// En-têtes seuls d'un message Gmail (01/09/2026, optimisation coût) :
// quelques centaines d'octets au lieu du message entier avec ses pièces
// jointes. Le cron de lecture s'en sert pour savoir QUI écrit avant de
// décider s'il vaut la peine de télécharger le corps — la très grande
// majorité des messages d'une boîte (newsletters, notifications, spam) ne
// correspond à aucun contact géré par Aaron et n'a donc pas à être
// téléchargée. Renvoie null en cas d'échec : le cron passe simplement au
// message suivant.
export async function getGmailMessageMetadata(userId: string, messageId: string) {
  try {
    const accessToken = await getValidAccessToken(userId);
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) return null;
    return await response.json(); // { id, threadId, payload: { headers: [{ name: 'From', value }] } }
  } catch (err: any) {
    console.error('Erreur lecture des en-têtes Gmail:', err.message);
    return null;
  }
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
    // Optionnel (28/08/2026) : un RDV ajouté manuellement dans l'agenda Aaron
    // avec un simple "contact_name" (sans prospect_id, donc sans email connu)
    // doit pouvoir être poussé vers Google Calendar quand même — juste sans
    // invité. Idem pour une indisponibilité (jamais d'invité).
    attendeeEmail?: string;
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
    reminders: { useDefault: true },
  };
  if (params.attendeeEmail) {
    body.attendees = [{ email: params.attendeeEmail }];
  }

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

// Supprime un événement du calendrier Google (RDV annulé côté Aaron, ou
// indisponibilité supprimée). Tolérant : un événement déjà supprimé côté
// Google (410 Gone) ou introuvable (404, ex. le commercial l'a supprimé
// lui-même directement dans Google Calendar) n'est pas une erreur — le
// résultat qu'on visait (l'événement n'existe plus) est déjà atteint.
export async function deleteGoogleCalendarEvent(userId: string, eventId: string): Promise<void> {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const err = await response.text();
    throw new Error(`Erreur suppression événement Google Calendar: ${err}`);
  }
}

// Liste les événements du calendrier Google du commercial sur la plage
// demandée (contrairement à getGoogleFreeBusy qui ne renvoie que des plages
// horaires occupées, celle-ci renvoie aussi le titre — nécessaire pour la
// synchro Google -> agenda Aaron, qui doit pouvoir distinguer un rdv médical
// d'un rdv "classique" pour le libellé posé côté Aaron, voir lib/calendar-sync.ts).
// singleEvents=true développe les événements récurrents en occurrences
// individuelles (sinon un événement récurrent ne remonterait qu'une fois,
// avec sa date de première occurrence).
export async function listGoogleCalendarEvents(
  userId: string,
  timeMinISO: string,
  timeMaxISO: string
): Promise<{ id: string; title: string; start: string; end: string }[]> {
  const accessToken = await getValidAccessToken(userId);

  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur listing événements Google Calendar: ${err}`);
  }

  const data = await response.json();
  return (data.items || [])
    // Ignore les événements annulés (encore présents dans la réponse tant
    // qu'on ne fixe pas showDeleted=false explicitement côté requête) et les
    // événements "journée entière" (date seule, sans heure — typiquement des
    // jours fériés/anniversaires importés, pas de vraies indisponibilités
    // horaires à bloquer dans l'agenda Aaron).
    .filter((e: any) => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime)
    .map((e: any) => ({
      id: e.id,
      title: e.summary || '',
      start: e.start.dateTime,
      end: e.end.dateTime,
    }));
}
