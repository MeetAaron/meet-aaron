// lib/outlook-diagnostics.ts
// Diagnostic complet de l'intégration Outlook d'un commercial (08/09/2026).
//
// Pourquoi ce fichier existe : pendant trois semaines, « le dossier / la
// catégorie Géré par Aaron n'apparaissent pas dans Outlook » a été corrigé à
// l'aveugle, sur des causes probables, parce que le code avalait les réponses
// de Microsoft Graph. Ce diagnostic rejoue CHAQUE étape avec le vrai token du
// commercial et renvoie les réponses brutes (statut HTTP + corps) :
//
//   1. la connexion en base (adresse, scopes réellement accordés, dernière
//      erreur Graph mémorisée) ;
//   2. /me — la boîte réellement liée au token (ce n'est pas forcément celle
//      que le commercial regarde dans son Outlook bureau !) ;
//   3. la liste des dossiers de premier niveau, et la présence du dossier
//      « 🤖 Géré par Aaron » (avec son nombre de messages) ;
//   4. la liste des catégories maîtresses, et la présence de la catégorie ;
//   5. les derniers messages d'Éléments envoyés (catégories, en-tête
//      X-Aaron-Sent) et du dossier Géré par Aaron ;
//   6. la taille MIME du dernier email envoyé par Aaron (piste « [Message
//      tronqué] » côté Gmail : Gmail coupe au-delà de ~102 Ko) ;
//   7. avec { fix: true } : création de la catégorie et du dossier s'ils
//      manquent, puis catégorie + rangement des derniers envois d'Aaron encore
//      dans Éléments envoyés — pour vérifier immédiatement, dans le webmail,
//      que les droits suffisent.
//
// Exposé par GET /api/diagnostics/outlook (authentifié, le commercial
// lui-même). Aucune donnée de contenu : sujets et adresses seulement.

import { supabaseAdmin } from './supabase-admin';
import {
  getValidAccessToken,
  graphRequest,
  AARON_CATEGORY_NAME,
  AARON_SENT_HEADER,
  ensureAaronCategoryExists,
  getOrCreateAaronFolderId,
  applyAaronCategory,
  archiveOutlookMessage,
} from './microsoft';

interface Step {
  step: string;
  ok: boolean;
  status?: number;
  detail?: any;
  error?: string | null;
}

export async function runOutlookDiagnostics(userId: string, opts?: { fix?: boolean }) {
  const steps: Step[] = [];
  const startedAt = new Date().toISOString();

  // 1. Connexion en base
  const { data: connection } = await supabaseAdmin
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .maybeSingle();

  if (!connection) {
    steps.push({ step: 'connexion_microsoft_en_base', ok: false, error: 'Aucune connexion Microsoft pour cet utilisateur' });
    return { started_at: startedAt, steps, summary: 'Aucune boîte Outlook connectée.' };
  }
  const scopes: string[] = Array.isArray(connection.scopes) ? connection.scopes : [];
  const required = ['Mail.ReadWrite', 'Mail.Send', 'Mail.Read', 'MailboxSettings.ReadWrite'];
  const missingScopes = required.filter((s) => !scopes.some((g) => g.toLowerCase().endsWith(s.toLowerCase())));
  steps.push({
    step: 'connexion_microsoft_en_base',
    ok: missingScopes.length === 0,
    detail: {
      provider_account_email: connection.provider_account_email,
      connected_at: connection.created_at,
      token_expires_at: connection.expires_at,
      scopes_accordes: scopes,
      scopes_manquants: missingScopes,
      derniere_erreur_graph: connection.last_graph_error ?? '(colonne absente ou aucune erreur)',
      derniere_erreur_graph_le: connection.last_graph_error_at ?? null,
    },
    error: missingScopes.length ? `Scopes manquants : ${missingScopes.join(', ')} → le commercial doit RECONNECTER sa boîte` : null,
  });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId);
    steps.push({ step: 'token_valide', ok: true });
  } catch (err: any) {
    steps.push({ step: 'token_valide', ok: false, error: err.message });
    return { started_at: startedAt, steps, summary: 'Token Microsoft invalide : reconnexion nécessaire.' };
  }

  // 2. /me
  const me = await graphRequest(userId, accessToken, 'GET', '/me?$select=userPrincipalName,mail,displayName', { label: 'diag /me' });
  steps.push({
    step: 'boite_liee_au_token',
    ok: me.ok,
    status: me.status,
    detail: me.ok ? { userPrincipalName: me.data?.userPrincipalName, mail: me.data?.mail, displayName: me.data?.displayName } : me.data,
    error: me.errorText,
  });

  // 3. Dossiers
  const folders = await graphRequest(userId, accessToken, 'GET', '/me/mailFolders?$top=200&$select=id,displayName,totalItemCount,parentFolderId', {
    label: 'diag dossiers',
  });
  const folderList: any[] = folders.ok ? folders.data?.value || [] : [];
  const aaronFolder = folderList.find((f) => f.displayName === AARON_CATEGORY_NAME);
  steps.push({
    step: 'dossiers_premier_niveau',
    ok: folders.ok,
    status: folders.status,
    detail: {
      dossier_geré_par_aaron: aaronFolder ? { id: aaronFolder.id, messages: aaronFolder.totalItemCount } : null,
      dossiers: folderList.map((f) => `${f.displayName} (${f.totalItemCount})`),
    },
    error: folders.errorText,
  });

  // 4. Catégories
  const cats = await graphRequest(userId, accessToken, 'GET', '/me/outlook/masterCategories', { label: 'diag catégories' });
  const catList: any[] = cats.ok ? cats.data?.value || [] : [];
  const aaronCat = catList.find((c) => c.displayName === AARON_CATEGORY_NAME);
  steps.push({
    step: 'categories_maitresses',
    ok: cats.ok,
    status: cats.status,
    detail: { categorie_geré_par_aaron: aaronCat || null, categories: catList.map((c) => c.displayName) },
    error: cats.errorText,
  });

  // 5. Éléments envoyés + dossier Aaron
  const sentItems = await graphRequest(
    userId,
    accessToken,
    'GET',
    '/me/mailFolders/sentitems/messages?$top=10&$orderby=sentDateTime desc&$select=id,subject,sentDateTime,toRecipients,categories,internetMessageId,internetMessageHeaders',
    { headers: { Prefer: 'IdType="ImmutableId"' }, label: 'diag éléments envoyés' }
  );
  let sentList: any[] = sentItems.ok ? sentItems.data?.value || [] : [];
  let sentNote: string | null = null;
  if (!sentItems.ok) {
    // Certains locataires refusent internetMessageHeaders dans un $select de liste.
    const light = await graphRequest(
      userId,
      accessToken,
      'GET',
      '/me/mailFolders/sentitems/messages?$top=10&$orderby=sentDateTime desc&$select=id,subject,sentDateTime,toRecipients,categories,internetMessageId',
      { headers: { Prefer: 'IdType="ImmutableId"' }, label: 'diag éléments envoyés (sans en-têtes)' }
    );
    sentList = light.ok ? light.data?.value || [] : [];
    sentNote = light.ok ? 'en-têtes non lisibles en liste sur ce locataire' : light.errorText;
  }
  const describe = (m: any) => ({
    id: m.id,
    subject: m.subject,
    sentDateTime: m.sentDateTime,
    to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address),
    categories: m.categories || [],
    internetMessageId: m.internetMessageId,
    envoye_par_aaron: Array.isArray(m.internetMessageHeaders)
      ? m.internetMessageHeaders.some((h: any) => h.name?.toLowerCase() === AARON_SENT_HEADER.toLowerCase())
      : 'inconnu',
  });
  const sentDescribed = sentList.map(describe);
  steps.push({
    step: 'elements_envoyes_recents',
    ok: sentItems.ok || sentList.length > 0,
    status: sentItems.status,
    detail: { note: sentNote, messages: sentDescribed },
    error: sentItems.ok ? null : sentItems.errorText,
  });

  if (aaronFolder) {
    const inAaron = await graphRequest(
      userId,
      accessToken,
      'GET',
      `/me/mailFolders/${aaronFolder.id}/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,sentDateTime,from,categories,internetMessageId`,
      { headers: { Prefer: 'IdType="ImmutableId"' }, label: 'diag dossier Géré par Aaron' }
    );
    steps.push({
      step: 'contenu_dossier_geré_par_aaron',
      ok: inAaron.ok,
      status: inAaron.status,
      detail: (inAaron.data?.value || []).map((m: any) => ({
        subject: m.subject,
        sentDateTime: m.sentDateTime,
        from: m.from?.emailAddress?.address,
        categories: m.categories || [],
      })),
      error: inAaron.errorText,
    });
  }

  // 6. Taille MIME du dernier envoi d'Aaron (ou du dernier envoi tout court)
  const lastAaron = sentDescribed.find((m) => m.envoye_par_aaron === true) || sentDescribed[0];
  if (lastAaron) {
    const mime = await graphRequest(userId, accessToken, 'GET', `/me/messages/${lastAaron.id}/$value`, {
      headers: { Prefer: 'IdType="ImmutableId"' },
      label: 'diag MIME du dernier envoi',
    });
    const raw = typeof mime.data === 'string' ? mime.data : mime.data ? JSON.stringify(mime.data) : '';
    const bodyRes = await graphRequest(userId, accessToken, 'GET', `/me/messages/${lastAaron.id}?$select=body,hasAttachments`, {
      headers: { Prefer: 'IdType="ImmutableId"' },
      label: 'diag corps du dernier envoi',
    });
    const htmlLen = bodyRes.ok ? String(bodyRes.data?.body?.content || '').length : null;
    const headerPart = raw.split(/\r?\n\r?\n/)[0] || '';
    steps.push({
      step: 'taille_du_dernier_envoi',
      ok: mime.ok,
      status: mime.status,
      detail: {
        subject: lastAaron.subject,
        mime_octets: raw.length,
        mime_ko: Math.round(raw.length / 102.4) / 10,
        corps_html_caracteres: htmlLen,
        piece_jointe: bodyRes.data?.hasAttachments ?? null,
        seuil_gmail_ko: 102,
        depasse_seuil_gmail: raw.length > 102 * 1024,
        entetes_transfert: headerPart
          .split(/\r?\n/)
          .filter((l) => /^(content-type|content-transfer-encoding|x-aaron-sent|mime-version):/i.test(l)),
        apercu_html: bodyRes.ok ? String(bodyRes.data?.body?.content || '').slice(0, 400) : null,
      },
      error: mime.errorText,
    });
  }

  // 7. Réparation à la demande
  if (opts?.fix) {
    const catFix = await ensureAaronCategoryExists(userId, accessToken);
    steps.push({ step: 'fix_categorie', ok: catFix.ok, status: catFix.status, error: catFix.errorText, detail: catFix.data });
    const folderId = await getOrCreateAaronFolderId(userId, accessToken);
    steps.push({ step: 'fix_dossier', ok: !!folderId, detail: { folderId } });

    const toFix = sentDescribed.filter((m) => m.envoye_par_aaron === true).slice(0, 5);
    const fixed: any[] = [];
    for (const m of toFix) {
      const cat = await applyAaronCategory(userId, m.id, accessToken);
      const mv = await archiveOutlookMessage(userId, m.id, accessToken);
      fixed.push({ subject: m.subject, categorie: cat ? { ok: cat.ok, status: cat.status, error: cat.errorText } : null, deplacement: mv ? { ok: mv.ok, status: mv.status, error: mv.errorText } : null });
    }
    steps.push({ step: 'fix_derniers_envois_aaron', ok: fixed.every((f) => f.categorie?.ok !== false && f.deplacement?.ok !== false), detail: fixed });
  }

  const failed = steps.filter((s) => !s.ok).map((s) => s.step);
  const summary = failed.length
    ? `Étapes en échec : ${failed.join(', ')}. Voir le champ error de chacune.`
    : 'Toutes les étapes répondent correctement côté Microsoft. Si le dossier reste invisible dans Outlook bureau, c’est un problème de synchronisation du client (vérifier dans outlook.office.com).';

  return { started_at: startedAt, steps, summary };
}
