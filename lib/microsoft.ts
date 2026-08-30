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

const AARON_CATEGORY_NAME = '🤖 Géré par Aaron';

// Équivalent Outlook du label Gmail "🤖 Géré par Aaron" (voir AARON_LABEL_NAME /
// applyAaronLabel dans lib/google.ts) : Outlook n'a pas de labels mais des
// "catégories". Il faut d'abord la déclarer dans la liste de catégories
// maîtresse du compte (sinon Outlook la pose sans nom/couleur lisible côté
// commercial), puis la réutiliser. On liste d'abord plutôt que de se fier à un
// cache, pour la même raison que côté Gmail (le commercial pourrait la
// supprimer lui-même).
async function ensureAaronCategoryExists(userId: string): Promise<void> {
  try {
    const accessToken = await getValidAccessToken(userId);

    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const { value } = await listRes.json();
      const exists = value?.some((c: any) => c.displayName === AARON_CATEGORY_NAME);
      if (exists) return;
    }

    await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      // "preset9" = violet dans la palette standard Outlook — couleur arbitraire,
      // choisie juste pour que la catégorie soit visuellement identifiable.
      body: JSON.stringify({ displayName: AARON_CATEGORY_NAME, color: 'preset9' }),
    });
  } catch (err: any) {
    console.error('Erreur création catégorie Outlook Aaron:', err.message);
  }
}

// Pose la catégorie "🤖 Géré par Aaron" sur un message Outlook (équivalent de
// applyAaronLabel côté Gmail). Contrairement à Gmail où un label se pose sur
// tout le FIL (thread) d'un coup, Outlook catégorise message par message : on
// l'applique donc à chaque message qu'Aaron envoie et à chaque message reçu
// qu'Aaron traite (voir sendOutlookEmail et app/api/cron/check-inbox) — les
// messages pertinents du fil (côté commercial) portent alors la catégorie,
// visible dans la liste sans avoir à ouvrir la conversation. On lit d'abord
// les catégories déjà présentes pour ne jamais écraser un tri que le
// commercial aurait posé lui-même. Échec silencieux : un souci de
// catégorisation ne doit jamais empêcher l'envoi/la lecture d'un email.
export async function applyAaronCategory(userId: string, messageId: string | undefined | null) {
  if (!messageId) return;
  try {
    await ensureAaronCategoryExists(userId);
    const accessToken = await getValidAccessToken(userId);

    const getRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=categories`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const existingCategories: string[] = getRes.ok ? (await getRes.json()).categories || [] : [];
    if (existingCategories.includes(AARON_CATEGORY_NAME)) return;

    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ categories: [...existingCategories, AARON_CATEGORY_NAME] }),
    });
  } catch (err: any) {
    console.error('Erreur pose de la catégorie Outlook Aaron:', err.message);
  }
}

// Envoie un email via Microsoft Graph (boîte Outlook du commercial), pour que
// Outlook soit un vrai second fournisseur au même titre que Gmail (prospection,
// relances, annulations...) et pas seulement pour la création de RDV.
//
// On passe par "créer un brouillon puis l'envoyer" plutôt que par l'action
// POST /me/sendMail (plus directe) car /sendMail répond 202 sans jamais
// renvoyer l'id du message envoyé — impossible de lui poser ensuite la
// catégorie "🤖 Géré par Aaron" (voir applyAaronCategory). Avec ce détour, on
// récupère l'id du brouillon dès sa création, qui reste valable une fois le
// message envoyé (déplacé de Brouillons vers Éléments envoyés).
export async function sendOutlookEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: { html?: boolean; attachment?: { filename: string; contentBase64: string; mimeType: string } }
) {
  const accessToken = await getValidAccessToken(userId);

  // Pièce jointe au premier email (demande Alex, 27/08/2026 — voir
  // lib/first-email-attachment.ts) : contrairement à Gmail (MIME multipart
  // à construire à la main), Graph accepte les pièces jointes directement
  // dans le corps de création du brouillon, en base64 — pas de format
  // spécial à gérer ici.
  //
  // 30/08/2026 ("[Message tronqué]" côté Gmail destinataire, constaté par
  // Alex) : sendEmailForUser passe désormais toujours un corps HTML construit
  // par nos soins (plainTextToEmailHtml, lib/messaging.ts) plutôt qu'un corps
  // 'Text' dont Exchange faisait sa propre conversion HTML à l'envoi — c'est
  // cette conversion déléguée que Gmail affichait tronquée.
  const createRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      body: { contentType: opts?.html ? 'HTML' : 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(opts?.attachment
        ? {
            attachments: [
              {
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: opts.attachment.filename,
                contentType: opts.attachment.mimeType,
                contentBytes: opts.attachment.contentBase64,
              },
            ],
          }
        : {}),
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Erreur création du brouillon Outlook: ${err}`);
  }
  const draft = await createRes.json();

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Erreur envoi Outlook: ${err}`);
  }

  // Best-effort : marque le message comme "géré par Aaron" une fois envoyé
  // (voir applyAaronCategory) — ne doit jamais faire échouer l'envoi lui-même.
  applyAaronCategory(userId, draft.id).catch(() => {});

  // On garde { sent: true } pour rester compatible avec l'appelant existant
  // (sendEmailForUser dans lib/messaging.ts n'utilisait jusqu'ici que ce
  // champ), et on ajoute l'id au cas où un futur appelant en aurait besoin.
  return { sent: true, id: draft.id };
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
  // attendeeEmail optionnel (28/08/2026) : un RDV manuel avec un simple
  // "contact_name" (sans email connu) ou une indisponibilité doivent pouvoir
  // être poussés vers Outlook sans invité.
  params: { title: string; description: string; startISO: string; endISO: string; attendeeEmail?: string }
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
      ...(params.attendeeEmail
        ? { attendees: [{ emailAddress: { address: params.attendeeEmail }, type: 'required' }] }
        : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur création événement Outlook: ${err}`);
  }

  return response.json(); // contient event.id -> à stocker dans appointments.calendar_event_id
}

// Supprime un événement du calendrier Outlook (RDV annulé côté Aaron, ou
// indisponibilité supprimée). Tolérant aux statuts 404/410 (déjà supprimé,
// ou introuvable — ex. le commercial l'a supprimé lui-même dans Outlook) :
// le résultat visé (l'événement n'existe plus) est déjà atteint.
export async function deleteOutlookCalendarEvent(userId: string, eventId: string): Promise<void> {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const err = await response.text();
    throw new Error(`Erreur suppression événement Outlook: ${err}`);
  }
}

// Liste les événements du calendrier Outlook du commercial sur la plage
// demandée, avec leur titre (contrairement à getOutlookFreeBusy qui ne
// renvoie que des plages horaires occupées) — nécessaire pour la synchro
// Outlook -> agenda Aaron (voir lib/calendar-sync.ts), qui doit pouvoir
// distinguer un rdv médical d'un rdv "classique" pour choisir le libellé
// posé côté Aaron.
export async function listOutlookCalendarEvents(
  userId: string,
  timeMinISO: string,
  timeMaxISO: string
): Promise<{ id: string; title: string; start: string; end: string }[]> {
  const accessToken = await getValidAccessToken(userId);

  const params = new URLSearchParams({ startDateTime: timeMinISO, endDateTime: timeMaxISO, $top: '250' });

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
  // isAllDay : idem Google, on ignore les événements "journée entière" (pas
  // de vraie plage horaire à bloquer dans l'agenda Aaron).
  return (data.value || [])
    .filter((e: any) => !e.isAllDay && !e.isCancelled)
    .map((e: any) => ({
      id: e.id,
      title: e.subject || '',
      start: e.start.dateTime.endsWith('Z') ? e.start.dateTime : `${e.start.dateTime}Z`,
      end: e.end.dateTime.endsWith('Z') ? e.end.dateTime : `${e.end.dateTime}Z`,
    }));
}
