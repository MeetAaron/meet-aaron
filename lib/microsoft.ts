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

// Sort un message de la boîte de réception Outlook (option « Aaron range les
// fils qu'il gère », migration_aaron_archive_threads_2026-09-01.sql).
//
// Graph n'a pas d'« archivage » au sens Gmail : on DÉPLACE le message vers le
// dossier bien connu `archive`. Rien n'est supprimé, et les réponses
// suivantes du prospect arrivent normalement en boîte de réception — le
// commercial reprend donc la main dès qu'il se passe quelque chose, comme
// côté Gmail.
//
// Échec silencieux, comme applyAaronCategory.
// Récupère (ou crée) le dossier Outlook « 🤖 Géré par Aaron ».
//
// Outlook n'a pas de libellés comme Gmail : pour que le commercial retrouve
// ses échanges à un endroit qui porte un nom parlant — et pas noyés dans
// l'Archive générique avec tout le reste — on crée un vrai dossier de premier
// niveau au même nom que la catégorie posée sur les messages.
async function getOrCreateAaronFolderId(userId: string): Promise<string | null> {
  try {
    const accessToken = await getValidAccessToken(userId);
    const listRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$select=id,displayName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const { value } = await listRes.json();
      const existing = value?.find((f: any) => f.displayName === AARON_CATEGORY_NAME);
      if (existing) return existing.id;
    }
    const createRes = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: AARON_CATEGORY_NAME }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return created.id;
  } catch (err: any) {
    console.error('Erreur récupération/création du dossier Outlook Aaron:', err.message);
    return null;
  }
}

export async function archiveOutlookMessage(userId: string, messageId: string | undefined | null) {
  if (!messageId) return;
  try {
    const accessToken = await getValidAccessToken(userId);
    // Dossier nommé si on arrive à l'obtenir, Archive standard sinon : mieux
    // vaut ranger dans l'Archive que laisser le message en boîte de réception
    // alors que le commercial a demandé qu'elle reste propre.
    const destinationId = (await getOrCreateAaronFolderId(userId)) || 'archive';
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ destinationId }),
    });
  } catch (err: any) {
    console.error('Erreur archivage du message Outlook:', err.message);
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
  opts?: { html?: boolean; attachment?: { filename: string; contentBase64: string; mimeType: string }; skipAaronLabel?: boolean }
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

  // Marque le message comme "géré par Aaron" une fois envoyé.
  //
  // AWAIT nécessaire (01/09/2026) — même bug que celui déjà corrigé côté
  // Gmail le 27/08 : sans await, la fonction serverless peut renvoyer sa
  // réponse HTTP et être gelée par la plateforme avant que les appels
  // internes d'applyAaronCategory (lister/créer la catégorie, puis la poser
  // sur le message) n'aient abouti — la catégorie ne se pose alors jamais,
  // sans la moindre erreur visible. applyAaronCategory avale déjà ses
  // propres erreurs, l'await ne peut donc pas faire échouer l'envoi.
  //
  // Doit aussi rester AVANT le déplacement éventuel dans le dossier « Géré
  // par Aaron » (voir sendEmailForUser) : le libellé doit être posé sur
  // CHAQUE email, rangé ou non (demande Alex, 01/09/2026).
  // Voir skipAaronLabel dans lib/google.ts : pas de catégorie sur les emails
  // destinés au commercial lui-même (rapports, alertes).
  if (!opts?.skipAaronLabel) {
    await applyAaronCategory(userId, draft.id);
  }

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
//
// /me/messages (toute la boîte) et non /me/mailFolders/inbox/messages
// (01/09/2026) — même correctif que côté Gmail (voir listNewGmailMessages) :
// un email déplacé dans un dossier, archivé ou supprimé par le commercial
// avant le passage du cron disparaissait de la vue d'Aaron, et la réponse du
// prospect était perdue sans aucun signal. /me/messages couvre tous les
// dossiers, y compris Éléments supprimés et Archive.
//
// Les Éléments envoyés et les Brouillons y sont aussi : on les écarte par
// isDraft eq false, et le traitement en aval ne retient de toute façon que
// les messages dont l'expéditeur correspond à un prospect connu (un email
// envoyé PAR le commercial ne matche personne). Aucun risque de
// retraitement non plus : le cron ignore tout id déjà en base
// (messages.provider_message_id).
export async function listNewOutlookMessages(userId: string, afterTimestamp: number) {
  const accessToken = await getValidAccessToken(userId);
  const afterISO = new Date(afterTimestamp).toISOString();

  // $select inclut `from` (01/09/2026, optimisation coût) : l'expéditeur
  // arrive donc avec la liste, et le cron sait immédiatement si le message
  // concerne un contact géré par Aaron — sans AUCUNE requête supplémentaire.
  // Le corps n'est téléchargé que pour les messages qui correspondent.
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${afterISO} and isDraft eq false`,
    $select: 'id,from',
    $orderby: 'receivedDateTime desc',
    $top: '100',
  });

  let response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Repli sur l'ancienne requête (boîte de réception seule) si Graph refuse
  // la requête toute-boîte : selon le locataire, la combinaison
  // $filter + $orderby peut être rejetée. Mieux vaut relire au moins la
  // boîte de réception que de ne rien relire du tout et perdre le passage
  // du cron pour ce commercial.
  if (!response.ok) {
    const inboxParams = new URLSearchParams({
      $filter: `receivedDateTime ge ${afterISO}`,
      $select: 'id,from',
      $orderby: 'receivedDateTime desc',
    });
    response = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${inboxParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }

  if (!response.ok) {
    throw new Error('Erreur lecture messages Outlook');
  }

  const data = await response.json();
  return (data.value || []) as { id: string; from?: any }[]; // id + expéditeur
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
