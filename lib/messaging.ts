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
import { isDomainHealthyForSending } from './email-deliverability';

// Demande Alex (2026-08-26, captures ordinateur vs téléphone à l'appui) :
// les emails générés par Aaron sont parfois "wrappés à la main" par le
// modèle — un retour à la ligne après ~50-70 caractères à l'intérieur d'un
// même paragraphe, habitude héritée du texte brut classique — plutôt qu'un
// seul paragraphe fluide laissé au client mail à reformater. Sur un écran
// large (ordinateur), chaque ligne ainsi coupée tient dans la largeur du
// volet de lecture : l'ensemble ressemble, par coïncidence, à un paragraphe
// normal. Sur mobile, la largeur est bien plus étroite : chaque ligne déjà
// coupée est à son tour re-coupée par le client mail, ce qui donne des
// lignes très inégales (une grande ligne suivie d'un mot ou deux esseulés) —
// exactement le rendu "haché" observé par Alex sur son téléphone. Le prompt
// système demande désormais explicitement à Aaron de ne jamais faire ça
// (voir lib/aaron_system_prompt.md), mais un prompt seul n'est pas une
// garantie fiable à 100% : ceci est le filet de sécurité exécuté juste avant
// l'envoi, pour TOUT email sortant quel que soit son origine (premier
// contact, relance, sauvetage, debrief...), puisque sendEmailForUser est le
// point d'entrée unique d'envoi.
//
// Ne touche qu'aux sauts de ligne UNIQUES à l'intérieur d'un même bloc (un
// wrap de paragraphe) : un saut de ligne DOUBLE (paragraphe intentionnel,
// ligne vide) est toujours préservé tel quel. Parmi les sauts uniques, on ne
// fusionne que ceux entourés d'au moins une ligne "longue" (~une bribe de
// phrase) : une salutation ("Bonjour Fabrice,") ou une signature
// ("Cordialement,\nAlexandre") sont par nature des lignes courtes des deux
// côtés du saut, donc jamais fusionnées — seul le vrai wrap de paragraphe
// (lignes consécutives proches de la largeur de wrap) est reconstruit en une
// phrase fluide.
const EMAIL_WRAP_MERGE_MIN_LINE_LENGTH = 30;

function normalizeEmailBodyLineBreaks(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      let result = lines[0] ?? '';
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        const prevLine = lines[i - 1].trim();
        const looksLikeManualWrap =
          prevLine.length >= EMAIL_WRAP_MERGE_MIN_LINE_LENGTH || line.length >= EMAIL_WRAP_MERGE_MIN_LINE_LENGTH;
        result += looksLikeManualWrap ? ` ${line}` : `\n${line}`;
      }
      return result.trim();
    })
    .filter((block) => block.length > 0)
    .join('\n\n');
}

// Exportée (28/08/2026) pour être réutilisée par lib/calendar-sync.ts, qui a
// besoin de savoir quel(s) provider(s) interroger sans dupliquer cette requête.
export async function getConnectedProviders(userId: string): Promise<Set<string>> {
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

// Demande Alex (30/08/2026) : blocage strict des emails de prospection quand
// le domaine pro connecté n'a pas SPF + DMARC en place — voir
// lib/email-deliverability.ts::isDomainHealthyForSending pour le détail (et
// pourquoi c'est mis en cache plutôt que vérifié en direct à chaque envoi).
export class DomainNotDeliverableError extends Error {
  domain: string;
  constructor(domain: string) {
    super(
      `Domaine ${domain} sans SPF/DMARC valide — envoi de prospection bloqué pour protéger la délivrabilité (voir Connexions)`
    );
    this.name = 'DomainNotDeliverableError';
    this.domain = domain;
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

// Demande Alex (30/08/2026) : "si aaron doit envoyer un long email, il ne
// réponde pas en 5 minutes, ça fait quand même suspect non ?". Un email court
// (accusé de réception, "merci, à bientôt"...) peut plausiblement être tapé en
// quelques minutes — pas la peine de le retarder. Un email plus long/travaillé
// arrivant 3 minutes après le message du prospect, en revanche, ne fait pas
// crédible. Seuil au nombre de mots plutôt qu'au nombre de caractères (plus
// stable face aux variations de ponctuation/mise en forme).
//
// Utilisée par app/api/cron/check-inbox/route.ts pour décider d'envoyer tout
// de suite (comportement historique, emails courts) ou de passer par la file
// pending_aaron_replies (emails longs, voir migration_pending_aaron_replies_
// 2026-08-30.sql + app/api/cron/send-pending-replies/route.ts).
export const LONG_EMAIL_WORD_THRESHOLD = 80;

// Retourne le délai (en ms) avant lequel un email ne doit PAS être envoyé —
// 0 si l'email est assez court pour partir tout de suite. Aléatoire dans une
// fourchette large : un délai fixe (toujours "22 minutes pile") serait, à la
// longue, tout aussi détectable/suspect qu'un envoi instantané.
export function computeHumanReplyDelayMs(bodyText: string): number {
  const wordCount = (bodyText || '').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= LONG_EMAIL_WORD_THRESHOLD) return 0;

  const MIN_DELAY_MS = 15 * 60 * 1000; // 15 min
  const MAX_DELAY_MS = 90 * 60 * 1000; // 1h30
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
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
//
// opts.attachment (demande Alex, 27/08/2026) : pièce jointe à inclure dans
// cet envoi précis (ex : la plaquette Aaron sur le tout premier email d'un
// prospect) — voir lib/first-email-attachment.ts pour la récupérer avant
// d'appeler cette fonction. Transmise telle quelle à Gmail ou Outlook selon
// le fournisseur connecté.
export async function sendEmailForUser(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: {
    emailType?: 'prospecting' | 'transactional';
    attachment?: { filename: string; contentBase64: string; mimeType: string };
  }
) {
  const emailType = opts?.emailType || 'transactional';
  // Voir normalizeEmailBodyLineBreaks ci-dessus — corrige les retours à la
  // ligne manuels avant même le plafond de démarchage/le choix du
  // fournisseur, pour couvrir tous les envois sans exception.
  body = normalizeEmailBodyLineBreaks(body);

  if (emailType === 'prospecting' && (await hasReachedProspectingCap(userId))) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('daily_prospecting_email_cap')
      .eq('id', userId)
      .maybeSingle();
    throw new DailySendCapExceededError(userId, user?.daily_prospecting_email_cap ?? DEFAULT_DAILY_PROSPECTING_CAP);
  }

  if (emailType === 'prospecting') {
    // La connexion qui va réellement servir à l'envoi (même priorité Google
    // > Microsoft que le choix de fournisseur plus bas) : c'est SON domaine
    // qu'il faut vérifier, pas un domaine générique. Requête dédiée (plutôt
    // que réutiliser getConnectedProviders, qui ne renvoie que les noms de
    // fournisseurs) car il faut ici provider_account_email + le cache santé.
    const { data: sendingConnections } = await supabaseAdmin
      .from('oauth_connections')
      .select('id, provider, provider_account_email, domain_health_ok, domain_health_checked_at')
      .eq('user_id', userId)
      .in('provider', ['google', 'microsoft']);
    const sendingConnection =
      (sendingConnections || []).find((c) => c.provider === 'google') ||
      (sendingConnections || []).find((c) => c.provider === 'microsoft');

    if (sendingConnection) {
      const { healthy, domain } = await isDomainHealthyForSending(sendingConnection);
      if (!healthy && domain) {
        throw new DomainNotDeliverableError(domain);
      }
    }
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
    result = await sendGmailEmail(userId, to, subject, fullBody, { html: isHtml, attachment: opts?.attachment });
  } else if (providers.has('microsoft')) {
    result = await sendOutlookEmail(userId, to, subject, fullBody, { html: isHtml, attachment: opts?.attachment });
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
