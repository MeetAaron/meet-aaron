// lib/microsoft.ts
// Interactions avec Outlook (mail + calendrier) via Microsoft Graph, pour un utilisateur donné.

import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';

interface OAuthConnection {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export async function getValidAccessToken(userId: string): Promise<string> {
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

export const AARON_CATEGORY_NAME = '🤖 Géré par Aaron';

// ---------------------------------------------------------------------------
// Appel Graph « qui ne se tait jamais » (08/09/2026).
//
// Pendant trois semaines, les échecs de catégorie / dossier / déplacement
// Outlook ont été avalés : `fetch` ne lève pas sur un 4xx, et le code ne
// regardait pas `ok` — on a donc corrigé des causes PROBABLES sans jamais
// voir ce que Microsoft répondait. Désormais, TOUT passe par graphRequest :
//   - le statut ET le corps de la réponse sont logués en cas d'échec ;
//   - le dernier échec est mémorisé sur la connexion (oauth_connections
//     .last_graph_error / last_graph_error_at, migration
//     migration_oauth_last_graph_error_2026-09-08.sql — ignoré tant que la
//     colonne n'existe pas) pour être lisible sans les logs serveur ;
//   - l'endpoint /api/diagnostics/outlook (lib/outlook-diagnostics.ts) rejoue
//     chaque étape et renvoie ces réponses brutes.
// Les appels « confort » (catégorie, dossier) restent non bloquants pour
// l'envoi : on renvoie le résultat au lieu de lever.
// ---------------------------------------------------------------------------
export interface GraphResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  errorText: string | null;
}

export async function graphRequest<T = any>(
  userId: string,
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts?: { body?: any; headers?: Record<string, string>; label?: string }
): Promise<GraphResult<T>> {
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const label = opts?.label || `${method} ${path.split('?')[0]}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts?.headers || {}),
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const errorText = `${res.status} ${text.slice(0, 600)}`;
      console.error(`[Graph] ${label} → ${errorText}`);
      await recordGraphError(userId, `${label} → ${errorText}`);
      return { ok: false, status: res.status, data, errorText };
    }
    return { ok: true, status: res.status, data, errorText: null };
  } catch (err: any) {
    const errorText = `réseau: ${err?.message || err}`;
    console.error(`[Graph] ${label} → ${errorText}`);
    await recordGraphError(userId, `${label} → ${errorText}`);
    return { ok: false, status: 0, data: null, errorText };
  }
}

async function recordGraphError(userId: string, message: string) {
  try {
    const { error } = await supabaseAdmin
      .from('oauth_connections')
      .update({ last_graph_error: message.slice(0, 1000), last_graph_error_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'microsoft');
    if (error && error.code !== '42703') {
      console.error('[Graph] impossible de mémoriser l’erreur sur la connexion:', error.message);
    }
  } catch {
    // best-effort
  }
}

// Équivalent Outlook du label Gmail "🤖 Géré par Aaron" (voir AARON_LABEL_NAME /
// applyAaronLabel dans lib/google.ts) : Outlook n'a pas de labels mais des
// "catégories". Il faut d'abord la déclarer dans la liste de catégories
// maîtresse du compte (sinon Outlook la pose sans nom/couleur lisible côté
// commercial), puis la réutiliser. On liste d'abord plutôt que de se fier à un
// cache, pour la même raison que côté Gmail (le commercial pourrait la
// supprimer lui-même). Nécessite le scope MailboxSettings.ReadWrite.
export async function ensureAaronCategoryExists(userId: string, accessToken?: string): Promise<GraphResult> {
  const token = accessToken || (await getValidAccessToken(userId));
  const list = await graphRequest(userId, token, 'GET', '/me/outlook/masterCategories', { label: 'liste des catégories' });
  if (list.ok) {
    const exists = list.data?.value?.some((c: any) => c.displayName === AARON_CATEGORY_NAME);
    if (exists) return list;
  }
  // "preset9" = violet dans la palette standard Outlook — couleur arbitraire,
  // choisie juste pour que la catégorie soit visuellement identifiable.
  return graphRequest(userId, token, 'POST', '/me/outlook/masterCategories', {
    body: { displayName: AARON_CATEGORY_NAME, color: 'preset9' },
    label: 'création de la catégorie',
  });
}

// Pose la catégorie "🤖 Géré par Aaron" sur un message Outlook (équivalent de
// applyAaronLabel côté Gmail). Contrairement à Gmail où un label se pose sur
// tout le FIL (thread) d'un coup, Outlook catégorise message par message : on
// l'applique donc à chaque message qu'Aaron envoie et à chaque message reçu
// qu'Aaron traite (voir sendOutlookEmail et app/api/cron/check-inbox). On lit
// d'abord les catégories déjà présentes pour ne jamais écraser un tri que le
// commercial aurait posé lui-même. Non bloquant : un souci de catégorisation
// ne doit jamais empêcher l'envoi/la lecture d'un email — mais il est logué
// et mémorisé (voir graphRequest), plus jamais avalé.
export async function applyAaronCategory(
  userId: string,
  messageId: string | undefined | null,
  accessToken?: string
): Promise<GraphResult | null> {
  if (!messageId) return null;
  try {
    const token = accessToken || (await getValidAccessToken(userId));
    await ensureAaronCategoryExists(userId, token);

    const current = await graphRequest(userId, token, 'GET', `/me/messages/${messageId}?$select=categories`, {
      label: 'lecture des catégories du message',
    });
    const existingCategories: string[] = current.ok ? current.data?.categories || [] : [];
    if (existingCategories.includes(AARON_CATEGORY_NAME)) return current;

    return await graphRequest(userId, token, 'PATCH', `/me/messages/${messageId}`, {
      body: { categories: [...existingCategories, AARON_CATEGORY_NAME] },
      label: 'pose de la catégorie sur le message',
    });
  } catch (err: any) {
    console.error('Erreur pose de la catégorie Outlook Aaron:', err.message);
    return { ok: false, status: 0, data: null, errorText: err.message };
  }
}

// Récupère (ou crée) le dossier Outlook « 🤖 Géré par Aaron ».
//
// Outlook n'a pas de libellés comme Gmail : pour que le commercial retrouve
// ses échanges à un endroit qui porte un nom parlant — et pas noyés dans
// l'Archive générique avec tout le reste — on crée un vrai dossier de premier
// niveau au même nom que la catégorie posée sur les messages.
export async function getOrCreateAaronFolderId(userId: string, accessToken?: string): Promise<string | null> {
  try {
    const token = accessToken || (await getValidAccessToken(userId));
    const list = await graphRequest(userId, token, 'GET', '/me/mailFolders?$top=200&$select=id,displayName', {
      label: 'liste des dossiers',
    });
    if (list.ok) {
      const existing = list.data?.value?.find((f: any) => f.displayName === AARON_CATEGORY_NAME);
      if (existing) return existing.id;
    }
    const created = await graphRequest(userId, token, 'POST', '/me/mailFolders', {
      body: { displayName: AARON_CATEGORY_NAME },
      label: 'création du dossier Géré par Aaron',
    });
    return created.ok ? created.data?.id || null : null;
  } catch (err: any) {
    console.error('Erreur récupération/création du dossier Outlook Aaron:', err.message);
    return null;
  }
}

// Sort un message de la boîte de réception / des Éléments envoyés Outlook
// (option « Aaron range les fils qu'il gère »,
// migration_aaron_archive_threads_2026-09-01.sql).
//
// Graph n'a pas d'« archivage » au sens Gmail : on DÉPLACE le message vers le
// dossier « 🤖 Géré par Aaron » (Archive standard en repli). Rien n'est
// supprimé, et les réponses suivantes du prospect arrivent normalement en
// boîte de réception — le commercial reprend donc la main dès qu'il se passe
// quelque chose, comme côté Gmail.
export async function archiveOutlookMessage(
  userId: string,
  messageId: string | undefined | null,
  accessToken?: string
): Promise<GraphResult | null> {
  if (!messageId) return null;
  try {
    const token = accessToken || (await getValidAccessToken(userId));
    const destinationId = (await getOrCreateAaronFolderId(userId, token)) || 'archive';
    return await graphRequest(userId, token, 'POST', `/me/messages/${messageId}/move`, {
      body: { destinationId },
      headers: { Prefer: 'IdType="ImmutableId"' },
      label: 'déplacement du message vers Géré par Aaron',
    });
  } catch (err: any) {
    console.error('Erreur archivage du message Outlook:', err.message);
    return { ok: false, status: 0, data: null, errorText: err.message };
  }
}

// Retrouve dans « Éléments envoyés » le message qu'Aaron vient d'envoyer, par
// son Message-ID RFC 5322 (internetMessageId, attribué dès la création du
// brouillon et conservé à l'envoi). Exchange copie le message dans Éléments
// envoyés de façon asynchrone après /send : on réessaie quelques secondes.
//
// C'est LA façon fiable de désigner l'email envoyé : elle ne dépend ni du
// format d'id (immuable ou non), ni du moment où Exchange finit de déplacer
// le brouillon. Renvoie null si le message n'est pas (encore) visible.
export async function findSentOutlookMessageId(
  userId: string,
  accessToken: string,
  internetMessageId: string,
  opts?: { attempts?: number; delayMs?: number }
): Promise<{ id: string; categories: string[] } | null> {
  const attempts = opts?.attempts ?? 6;
  const delayMs = opts?.delayMs ?? 1500;
  const filter = `internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`;
  for (let i = 0; i < attempts; i++) {
    const res = await graphRequest(
      userId,
      accessToken,
      'GET',
      `/me/mailFolders/sentitems/messages?$filter=${encodeURIComponent(filter)}&$select=id,categories,isDraft&$top=2`,
      { headers: { Prefer: 'IdType="ImmutableId"' }, label: 'recherche du message dans Éléments envoyés' }
    );
    const found = res.ok ? (res.data?.value || []).find((m: any) => !m.isDraft) : null;
    if (found) return { id: found.id, categories: found.categories || [] };
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// Envoie un email via Microsoft Graph (boîte Outlook du commercial), pour que
// Outlook soit un vrai second fournisseur au même titre que Gmail (prospection,
// relances, annulations...) et pas seulement pour la création de RDV.
//
// On passe par "créer un brouillon puis l'envoyer" plutôt que par l'action
// POST /me/sendMail (plus directe) car /sendMail répond 202 sans jamais
// renvoyer quoi que ce soit — impossible de retrouver ensuite le message pour
// lui poser la catégorie "🤖 Géré par Aaron" ou le ranger. Avec ce détour, on
// connaît le Message-ID (internetMessageId) dès la création du brouillon, et
// on retrouve l'email envoyé grâce à lui (findSentOutlookMessageId).
export const AARON_SENT_HEADER = 'X-Aaron-Sent';

// Tous les messages d'une conversation Outlook (l'équivalent du fil Gmail),
// pour retrouver les réponses écrites à la main par le commercial — voir
// lib/manual-replies.ts. En-têtes et corps sont demandés directement ; si
// Graph refuse `internetMessageHeaders` dans un $select de liste (ça dépend
// du locataire), on retombe sur une lecture message par message, qui ne
// concerne de toute façon que les quelques candidats. [] en cas d'échec.
export async function listOutlookConversationMessages(userId: string, conversationId: string): Promise<any[]> {
  try {
    const accessToken = await getValidAccessToken(userId);
    const params = new URLSearchParams({
      $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
      $select: 'id,from,sentDateTime,isDraft,body,internetMessageId,internetMessageHeaders',
      $top: '50',
    });
    let response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const light = new URLSearchParams({
        $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
        $select: 'id,from,sentDateTime,isDraft',
        $top: '50',
      });
      response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${light.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      const out: any[] = [];
      for (const m of data.value || []) {
        try {
          out.push(await getOutlookMessage(userId, m.id));
        } catch {
          // message illisible : on l'ignore, les autres suffisent
        }
      }
      return out.map((m, i) => ({ ...m, id: m.id || (data.value || [])[i]?.id }));
    }
    const data = await response.json();
    return data.value || [];
  } catch (err: any) {
    console.error('Erreur lecture de la conversation Outlook:', err.message);
    return [];
  }
}

export async function sendOutlookEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: {
    html?: boolean;
    attachment?: { filename: string; contentBase64: string; mimeType: string };
    skipAaronLabel?: boolean;
    // Fil auquel rattacher cet envoi — voir lib/email-threading.ts.
    reply?: { internetMessageId?: string | null };
  }
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
  // 'Text' dont Exchange faisait sa propre conversion HTML à l'envoi.
  //
  // Prefer IdType="ImmutableId" (08/09/2026) : un id Exchange classique dépend
  // du DOSSIER et change quand /send déplace le message vers Éléments
  // envoyés. L'id immuable survit au déplacement. Uniquement ici, sur la
  // création : la lecture de la boîte (listNewOutlookMessages) garde ses ids
  // par défaut, car les provider_message_id déjà stockés sont dans ce format.
  // Rattachement au fil (11/09/2026, voir lib/email-threading.ts).
  //
  // Graph documente n'accepter, dans internetMessageHeaders, que des en-têtes
  // personnalisés préfixés « X- ». En pratique il tolère souvent In-Reply-To
  // et References — mais « souvent » n'est pas « toujours », et un refus
  // ferait échouer l'envoi entier. D'où la stratégie : on tente avec, et si
  // Graph refuse la création du brouillon, on recommence sans. Dans ce
  // second cas le fil tient quand même côté Outlook grâce à l'objet
  // « Re: <objet d'origine> », qui est le principal critère de regroupement.
  const threadHeaders = opts?.reply?.internetMessageId
    ? [
        { name: 'In-Reply-To', value: opts.reply.internetMessageId },
        { name: 'References', value: opts.reply.internetMessageId },
      ]
    : [];

  const draftBody = (withThreadHeaders: boolean) => ({
      subject,
      body: { contentType: opts?.html ? 'HTML' : 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
      // Marqueur des envois d'Aaron — même rôle que côté Gmail, voir
      // lib/google.ts (AARON_SENT_HEADER) et lib/manual-replies.ts.
      internetMessageHeaders: [
        { name: AARON_SENT_HEADER, value: '1' },
        ...(withThreadHeaders ? threadHeaders : []),
      ],
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
  });

  let created = await graphRequest(userId, accessToken, 'POST', '/me/messages', {
    headers: { Prefer: 'IdType="ImmutableId"' },
    label: 'création du brouillon',
    body: draftBody(threadHeaders.length > 0),
  });

  // Graph a refusé les en-têtes de fil : on renvoie sans eux plutôt que de
  // perdre l'email.
  if (!created.ok && threadHeaders.length > 0) {
    console.error(
      "[Outlook] création du brouillon refusée avec les en-têtes de fil, nouvelle tentative sans :",
      String(created.errorText || '').slice(0, 300)
    );
    created = await graphRequest(userId, accessToken, 'POST', '/me/messages', {
      headers: { Prefer: 'IdType="ImmutableId"' },
      label: 'création du brouillon (sans en-têtes de fil)',
      body: draftBody(false),
    });
  }

  if (!created.ok) {
    throw new Error(`Erreur création du brouillon Outlook: ${created.errorText}`);
  }
  const draft = created.data;
  const internetMessageId: string | undefined = draft?.internetMessageId;

  // Catégorie posée sur le BROUILLON, avant l'envoi : une catégorie est une
  // propriété de l'élément, elle suit le message dans Éléments envoyés.
  // Voir skipAaronLabel dans lib/google.ts : pas de catégorie sur les emails
  // destinés au commercial lui-même (rapports, alertes).
  if (!opts?.skipAaronLabel) {
    await applyAaronCategory(userId, draft.id, accessToken);
  }

  const sent = await graphRequest(userId, accessToken, 'POST', `/me/messages/${draft.id}/send`, {
    label: 'envoi du brouillon',
  });
  if (!sent.ok) {
    throw new Error(`Erreur envoi Outlook: ${sent.errorText}`);
  }

  // On retrouve ensuite l'email dans Éléments envoyés par son Message-ID et
  // on y (re)pose la catégorie : c'est l'id de CE message — et non celui du
  // brouillon — qui est renvoyé à l'appelant pour le rangement
  // (archiveOutlookMessage dans sendEmailForUser).
  let sentId: string = draft.id;
  if (internetMessageId) {
    const found = await findSentOutlookMessageId(userId, accessToken, internetMessageId);
    if (found) {
      sentId = found.id;
      if (!opts?.skipAaronLabel && !found.categories.includes(AARON_CATEGORY_NAME)) {
        await applyAaronCategory(userId, sentId, accessToken);
      }
    } else {
      console.error('[Graph] message envoyé introuvable dans Éléments envoyés après envoi', internetMessageId);
    }
  }

  return { sent: true, id: sentId, internetMessageId };
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
    // internetMessageId (08/09/2026) : l'identifiant RFC 5322 du message,
    // identique quel que soit le dossier et le format d'id Graph — c'est
    // désormais la clé anti-doublon du cron (voir check-inbox).
    $select: 'id,from,internetMessageId',
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
      $select: 'id,from,internetMessageId',
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
  return (data.value || []) as { id: string; from?: any; internetMessageId?: string }[]; // id + expéditeur + Message-ID
}

// Récupère le contenu complet d'un message Outlook
export async function getOutlookMessage(userId: string, messageId: string) {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=from,body,subject,receivedDateTime,sentDateTime,conversationId,internetMessageId,internetMessageHeaders`,
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
  params: {
    title: string;
    description: string;
    startISO: string;
    endISO: string;
    attendeeEmail?: string;
    // RDV de type « visio » (10/09/2026) : demande à Microsoft de créer une
    // réunion Teams rattachée à l'événement, exactement comme
    // createGoogleCalendarEvent demande un lien Google Meet. Sans ça, un RDV
    // visio validé depuis un compte Microsoft n'avait AUCUN lien — ni pour
    // le commercial, ni pour le prospect (trou constaté avec Open X, qui est
    // sur Microsoft 365).
    wantsMeetLink?: boolean;
  }
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
      // teamsForBusiness : le seul fournisseur disponible pour un compte
      // Microsoft 365 professionnel. Un compte Outlook.com PERSONNEL n'a pas
      // Teams — d'où le repli plus bas (l'événement est recréé sans réunion
      // en ligne plutôt que de faire échouer la validation du RDV).
      ...(params.wantsMeetLink ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    // Repli sans réunion en ligne : mieux vaut un RDV posé sans lien Teams
    // qu'un RDV non posé du tout. Le lien de visio permanent des Préférences
    // (users.meeting_link) prend alors le relais côté email.
    if (params.wantsMeetLink) {
      console.error('[Graph] réunion Teams refusée, création sans lien:', err.slice(0, 300));
      return createOutlookCalendarEvent(userId, { ...params, wantsMeetLink: false });
    }
    throw new Error(`Erreur création événement Outlook: ${err}`);
  }

  const event = await response.json();
  return {
    ...event,
    // Même forme de retour que createGoogleCalendarEvent, pour que les
    // appelants n'aient rien à savoir du fournisseur.
    meetLink: event.onlineMeeting?.joinUrl || null,
  };
  // contient event.id -> à stocker dans appointments.calendar_event_id
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
