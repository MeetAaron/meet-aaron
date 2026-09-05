// lib/inbound-triage.ts
//
// Pré-filtre des emails entrants (validé par Alex le 05/09/2026 : « go »).
//
// Avant : chaque réponse d'un contact géré — y compris « Je suis absent
// jusqu'au 15 », un rebond « adresse inexistante » ou un accusé de réception
// automatique — partait à Sonnet avec tout le prompt d'Aaron (~12 000 tokens
// + profil + historique) : 0,03 à 0,05 $ par message, pour ne rien produire.
// Sur de la prospection à froid, un bon tiers des messages entrants sont de
// ce type.
//
// Trois étages, du gratuit vers le cher :
//   1. EN-TÊTES (0 $) : Auto-Submitted, Precedence: bulk/auto_reply,
//      X-Autoreply, X-Auto-Response-Suppress, expéditeur MAILER-DAEMON /
//      postmaster, sujets « Delivery Status Notification ». Fiable : ces
//      en-têtes sont posés par les serveurs, pas par des humains.
//   2. HAIKU (~0,002 $) : lit le message SEUL (sans le prompt d'Aaron) et
//      rend un JSON de quelques tokens : catégorie + confiance.
//   3. SONNET : uniquement si le message mérite une réponse d'Aaron, ou si
//      Haiku doute (confiance < 0,8). Dans le doute, on garde Aaron.
//
// Seules `auto_reply` et `bounce` court-circuitent Sonnet : un « pas
// intéressé » y va toujours, parce qu'Aaron peut proposer une tentative de
// sauvetage (voir rescue_proposal dans lib/aaron.ts) — c'est son métier.
// Rien n'est jamais supprimé : le message est enregistré dans la
// conversation quoi qu'il arrive (c'est aussi ce qui évite les doublons).

import { callClaude } from './anthropic-client';

export type InboundCategory =
  | 'auto_reply' // absence, accusé de réception automatique, message généré
  | 'bounce' // adresse inexistante, boîte pleine, rejet serveur
  | 'not_interested'
  | 'question'
  | 'positive'
  | 'meeting_proposal'
  | 'other';

export interface InboundTriage {
  category: InboundCategory;
  confidence: number; // 0..1
  needsAaron: boolean;
  source: 'headers' | 'body' | 'haiku' | 'fallback';
  reason?: string;
}

export interface InboundHeaders {
  autoSubmitted?: string | null;
  precedence?: string | null;
  xAutoreply?: string | null;
  xAutoResponseSuppress?: string | null;
  returnPath?: string | null;
  subject?: string | null;
}

const SKIP_CATEGORIES: InboundCategory[] = ['auto_reply', 'bounce'];

function decide(category: InboundCategory, confidence: number, source: InboundTriage['source'], reason?: string): InboundTriage {
  const skip = SKIP_CATEGORIES.includes(category) && confidence >= 0.8;
  return { category, confidence, needsAaron: !skip, source, reason };
}

// ── Étage 1 : en-têtes et expéditeur ────────────────────────────────────────
export function triageByHeaders(fromEmail: string, headers: InboundHeaders): InboundTriage | null {
  const from = (fromEmail || '').toLowerCase();
  const subject = (headers.subject || '').toLowerCase();

  if (/^(mailer-daemon|postmaster|mail-daemon|no-?reply\+bounces?)@/.test(from) || /mailer-daemon|postmaster/.test(from)) {
    return decide('bounce', 0.98, 'headers', 'expéditeur serveur');
  }
  if (/(delivery status notification|undeliverable|undelivered mail|mail delivery failed|échec de (la )?livraison|non remis|delivery failure)/i.test(subject)) {
    return decide('bounce', 0.95, 'headers', 'sujet de non-remise');
  }
  const auto = (headers.autoSubmitted || '').toLowerCase();
  if (auto && auto !== 'no') {
    return decide('auto_reply', 0.97, 'headers', `Auto-Submitted: ${auto}`);
  }
  const precedence = (headers.precedence || '').toLowerCase();
  if (precedence === 'auto_reply' || precedence === 'bulk' || precedence === 'junk') {
    return decide('auto_reply', 0.95, 'headers', `Precedence: ${precedence}`);
  }
  if (headers.xAutoreply || headers.xAutoResponseSuppress) {
    return decide('auto_reply', 0.95, 'headers', 'X-Autoreply');
  }
  if (/^(automatic reply|réponse automatique|out of office|absence du bureau|autoreply|auto-reply)/i.test(subject)) {
    return decide('auto_reply', 0.93, 'headers', 'sujet de réponse automatique');
  }
  return null;
}

// ── Étage 2 : corps (heuristiques sans IA) ──────────────────────────────────
export function triageByBody(bodyText: string): InboundTriage | null {
  const body = (bodyText || '').slice(0, 1500).toLowerCase();
  if (!body.trim()) return null;
  const oof = /(je suis (actuellement )?absent|absent(e)? du bureau|out of (the )?office|i am (currently )?(away|out of the office)|de retour le|will be back on|réponse automatique|automatic reply|this is an automated|ceci est un message automatique|accusé de réception automatique)/i;
  if (oof.test(body)) return decide('auto_reply', 0.9, 'body', 'formule d’absence');
  const bounce = /(address not found|adresse (introuvable|inexistante)|user unknown|mailbox (full|unavailable|not found)|550[- ]5\.1\.1|recipient address rejected|message could not be delivered|n'a pas pu être remis)/i;
  if (bounce.test(body)) return decide('bounce', 0.9, 'body', 'texte de rejet serveur');
  return null;
}

// ── Étage 3 : Haiku ─────────────────────────────────────────────────────────
const HAIKU_SYSTEM = `Tu classes des emails reçus par un commercial en réponse à sa prospection. Réponds UNIQUEMENT par un JSON compact, sans texte autour :
{"category":"auto_reply|bounce|not_interested|question|positive|meeting_proposal|other","confidence":0.0-1.0}
- auto_reply : message automatique (absence, accusé de réception, notification générée).
- bounce : échec de remise, adresse inexistante, boîte pleine.
- not_interested : la personne décline ou demande d'arrêter.
- question : la personne pose une question ou demande des précisions.
- positive : intérêt, ouverture, demande d'échange.
- meeting_proposal : propose ou accepte un créneau / un rendez-vous.
- other : tout le reste (un vrai message humain qui ne rentre pas ci-dessus).
Un message écrit par un humain, même court (« ok », « merci »), n'est JAMAIS auto_reply.`;

export async function triageWithHaiku(
  subject: string,
  bodyText: string,
  companyId: string | null,
  userId?: string | null
): Promise<InboundTriage> {
  const excerpt = `${subject ? `Sujet : ${subject}\n\n` : ''}${(bodyText || '').slice(0, 2500)}`;
  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 60,
        system: HAIKU_SYSTEM,
        messages: [{ role: 'user', content: excerpt }],
      },
      companyId,
      'ap',
      userId
    );
    const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    const category = String(json.category || 'other') as InboundCategory;
    const confidence = Math.max(0, Math.min(1, Number(json.confidence) || 0));
    const known: InboundCategory[] = ['auto_reply', 'bounce', 'not_interested', 'question', 'positive', 'meeting_proposal', 'other'];
    return decide(known.includes(category) ? category : 'other', confidence, 'haiku');
  } catch (err: any) {
    // Haiku indisponible ou réponse illisible : on garde Aaron (Sonnet).
    return { category: 'other', confidence: 0, needsAaron: true, source: 'fallback', reason: err?.message };
  }
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
export async function triageInbound(params: {
  fromEmail: string;
  subject?: string | null;
  bodyText: string;
  headers?: InboundHeaders;
  companyId: string | null;
  userId?: string | null;
}): Promise<InboundTriage> {
  const byHeaders = triageByHeaders(params.fromEmail, { ...(params.headers || {}), subject: params.headers?.subject ?? params.subject });
  if (byHeaders) return byHeaders;
  const byBody = triageByBody(params.bodyText);
  if (byBody) return byBody;
  return triageWithHaiku(params.subject || '', params.bodyText, params.companyId, params.userId);
}
