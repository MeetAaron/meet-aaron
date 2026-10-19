// lib/referral.ts
// Parrainage automatique (validé par Alex le 18/10/2026) : « trente jours
// après une première commande confirmée, Aaron demande au client, dans le
// même ton que le reste : vous connaissez deux confrères que ça pourrait
// aider ? Un client content qui recommande vaut dix emails à froid. »
//
// Pour TOUS les comptes (pas seulement le compte interne qui a le module
// Clients) : c'est une source de nouveaux prospects, donc de la
// prospection. Conditions pour un client :
//   - première commande confirmée depuis au moins MIN_DAYS_AFTER_ORDER jours ;
//   - pas perdu (le réglage « je reprends la main » ne compte pas : il est
//     mis automatiquement à la passation, voir lib/prospect-handover.ts) ;
//   - au moins une réponse reçue de lui un jour (on ne demande rien à
//     quelqu'un qui n'a jamais écrit) ;
//   - jamais demandé (referral_asked_at NULL) ;
//   - si le module Clients calcule une santé, elle n'est pas « à risque ».
// L'email part depuis la boîte du commercial, dans le créneau de
// prospection, et s'ajoute au fil de la conversation : la réponse du client
// arrive dans check-inbox comme n'importe quelle réponse, Aaron la lit et
// le commercial voit les noms proposés dans les échanges.

import { supabaseAdmin } from './supabase-admin';
import { callClaude, MonthlyCapExceededError } from './anthropic-client';
import { localeInstruction, normalizeLocale } from './locale-instruction';
import { sendEmailForUser, DailySendCapExceededError, DomainNotDeliverableError, MailboxAuthBrokenError } from './messaging';
import { sendPushNotification } from './push';
import { extractJsonObject } from './extract-json';
import { resolveUserTimeZone } from './user-timezone';
import { isProspectingWindowOpenForUser } from './send-window';

export const MIN_DAYS_AFTER_ORDER = 30;
const MAX_PER_USER_PER_RUN = 3;

const FALLBACK: Record<string, { subject: string; body: string }> = {
  fr: { subject: 'Une petite question', body: "Bonjour {name},\n\nUn mois déjà depuis votre première commande : j'espère que tout se passe bien de votre côté.\n\nUne question en passant : connaissez-vous un ou deux confrères à qui cela pourrait aussi rendre service ? Un simple nom suffit, je m'occupe du reste — et je ne mentionnerai votre nom que si vous êtes d'accord.\n\nMerci, et à bientôt." },
  en: { subject: 'A quick question', body: "Hello {name},\n\nA month since your first order: I hope everything is going well on your side.\n\nA quick question: do you know one or two peers this could also help? A name is enough, I'll take it from there — and I'll only mention you if you're happy with that.\n\nThanks, and talk soon." },
};

interface ReferralEmail { subject: string; body: string }

async function loadCandidate(prospectId: string) {
  const { data, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, job_title, company_id, assigned_user_id, first_order_confirmed_at, prospect_companies(name), users(locale, full_name, first_name)')
    .eq('id', prospectId)
    .single();
  if (error || !data) throw new Error('Client introuvable');
  return data as any;
}

async function loadMessages(prospectId: string) {
  const { data: conversation } = await supabaseAdmin.from('conversations').select('id').eq('prospect_id', prospectId).eq('channel', 'email').maybeSingle();
  if (!conversation) return { conversationId: null as string | null, messages: [] as any[] };
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: true })
    .limit(30);
  return { conversationId: conversation.id as string, messages: messages || [] };
}

export async function generateReferralEmail(prospectId: string): Promise<ReferralEmail> {
  const prospect = await loadCandidate(prospectId);
  const locale = normalizeLocale(prospect?.users?.locale);
  const { messages } = await loadMessages(prospectId);
  const sellerName = prospect?.users?.first_name || prospect?.users?.full_name || '';
  const fallbackBase = FALLBACK[locale] || FALLBACK.fr;
  const fallback = { subject: fallbackBase.subject, body: fallbackBase.body.replace('{name}', prospect.full_name) };
  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-5',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, l'assistant commercial de ${sellerName || 'un commercial'}, et tu écris EN SON NOM (première personne, c'est lui qui signe). ` +
              `Le client "${prospect.full_name}"${prospect.prospect_companies?.name ? ` (${prospect.prospect_companies.name})` : ''} a passé sa première commande il y a un mois. ` +
              `Rédige un email court et naturel qui prend de ses nouvelles en une phrase, puis lui demande s'il connaît un ou deux confrères ou contacts à qui cela pourrait aussi rendre service — un simple nom suffit, le commercial s'occupe du reste, et il ne citera le client que s'il est d'accord. ` +
              `Ton : le même que dans les échanges ci-dessous (reprends leur niveau de familiarité), chaleureux, jamais insistant, pas de formule marketing, pas de « réseau », pas de récompense promise.\n` +
              (messages.length ? `Historique des échanges (pour le ton et la LANGUE du client) :\n${JSON.stringify(messages.slice(-8), null, 2)}\n\n` : '') +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"subject": "objet court et naturel", "body": "corps de l'email, 4 à 6 phrases, sans balises HTML, sans signature — LANGUE : si l'historique montre que le client écrit dans une autre langue que celle du commercial, écris dans SA langue ; sinon ${localeInstruction(locale)}"}`,
          },
        ],
      },
      prospect.company_id,
      'ap',
      prospect.assigned_user_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (!textBlock) throw new Error('Aucune réponse texte');
    const result = extractJsonObject<ReferralEmail>(textBlock.text);
    if (!result?.subject?.trim() || !result?.body?.trim()) throw new Error('JSON incomplet');
    return result;
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération demande de parrainage (repli sur template):', err?.message);
    }
    return fallback;
  }
}

export interface ReferralRunReport {
  sent: number;
  skipped_window: number;
  skipped_other: number;
  errors: { prospect_id: string; error: string }[];
}

// Appelé par app/api/cron/referral-requests (quotidien).
export async function runReferralRequests(now: Date = new Date()): Promise<ReferralRunReport> {
  const report: ReferralRunReport = { sent: 0, skipped_window: 0, skipped_other: 0, errors: [] };
  const cutoff = new Date(now.getTime() - MIN_DAYS_AFTER_ORDER * 24 * 60 * 60 * 1000).toISOString();

  let res: any = await supabaseAdmin
    .from('prospects')
    .select('id, email, full_name, assigned_user_id, ai_managed, customer_health_label, churn_risk, first_order_confirmed_at, referral_asked_at')
    .eq('is_won', true)
    .eq('is_lost', false)
    .not('first_order_confirmed_at', 'is', null)
    .lte('first_order_confirmed_at', cutoff)
    .is('referral_asked_at', null)
    .order('first_order_confirmed_at', { ascending: true })
    .limit(200);
  if (res.error?.code === '42703') {
    // Migration parrainage pas jouée : rien à faire, sans bruit.
    return report;
  }
  const candidates: any[] = res.data || [];
  if (candidates.length === 0) return report;

  const userIds = Array.from(new Set(candidates.map((c) => c.assigned_user_id).filter(Boolean)));
  let usersRes: any = await supabaseAdmin.from('users').select('id, email, timezone, billing_country').in('id', userIds);
  if (usersRes.error?.code === '42703') usersRes = await supabaseAdmin.from('users').select('id, email').in('id', userIds);
  const users = new Map<string, any>();
  for (const u of usersRes.data || []) users.set(u.id, u);

  const windowOpen = new Map<string, boolean>();
  const perUser: Record<string, number> = {};
  const blocked = new Set<string>();

  for (const c of candidates) {
    const user = users.get(c.assigned_user_id);
    if (!user || !c.email) { report.skipped_other += 1; continue; }
    // ai_managed n'est PAS un critère ici : handOverWonProspect le met à
    // false pour TOUS les clients gagnés des comptes sans module Clients
    // (lib/prospect-handover.ts). Le commercial est prévenu dès la passation
    // que cette demande, et elle seule, reste chez Aaron (Alex, 19/10/2026).
    if (c.customer_health_label === 'a_risque' || c.churn_risk === true) { report.skipped_other += 1; continue; }
    if (blocked.has(user.id)) continue;

    if (!windowOpen.has(user.id)) windowOpen.set(user.id, await isProspectingWindowOpenForUser(user.id, resolveUserTimeZone(user)));
    if (!windowOpen.get(user.id)) { report.skipped_window += 1; continue; }

    const { conversationId, messages } = await loadMessages(c.id);
    // Jamais écrit un mot : on ne lui demande pas une faveur.
    if (!messages.some((m: any) => m.direction === 'inbound')) { report.skipped_other += 1; continue; }

    perUser[user.id] = (perUser[user.id] || 0) + 1;
    if (perUser[user.id] > MAX_PER_USER_PER_RUN) continue;

    // Réclamation AVANT génération : deux passages de cron ne génèrent
    // ni n'envoient jamais deux fois pour le même client.
    const { data: claimed } = await supabaseAdmin
      .from('prospects')
      .update({ referral_asked_at: now.toISOString() })
      .eq('id', c.id)
      .is('referral_asked_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      const email = await generateReferralEmail(c.id);
      await sendEmailForUser(user.id, c.email, email.subject, email.body);
      await supabaseAdmin.from('prospects').update({ referral_email_subject: email.subject, referral_email_body: email.body }).eq('id', c.id);
      if (conversationId) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversationId,
          direction: 'outbound',
          sender_email: user.email || '',
          recipient_email: c.email,
          body: email.body,
        });
      }
      report.sent += 1;
      try {
        await sendPushNotification(user.id, {
          title: 'Demande de parrainage envoyée',
          body: `Aaron a demandé à ${c.full_name} s'il connaît des confrères à qui parler de toi. Sa réponse arrivera dans ses échanges.`,
          url: `/app/prospects?user_id=${user.id}&contact=${c.id}`,
        });
      } catch {
        // push best-effort
      }
    } catch (err: any) {
      // Plafond, domaine, boîte en panne : on rend le créneau au client, il
      // sera retenté un autre jour. Autre erreur : idem, mais remontée.
      await supabaseAdmin.from('prospects').update({ referral_asked_at: null }).eq('id', c.id);
      blocked.add(user.id);
      const soft = err instanceof DailySendCapExceededError || err instanceof DomainNotDeliverableError || err instanceof MailboxAuthBrokenError;
      if (!soft) report.errors.push({ prospect_id: c.id, error: err?.message || String(err) });
    }
  }
  return report;
}
