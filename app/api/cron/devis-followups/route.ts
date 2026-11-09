// app/api/cron/devis-followups/route.ts
// Toutes les heures (vercel.json). RELANCES APRÈS DEVIS — question d'Alex
// (docx 08/11/2026) : « que se passe-t-il si l'utilisateur n'a pas appelé
// dans les 48 h ? » Réponse retenue : Aaron reprend la main par email, sans
// jamais mettre le prospect devant le silence du commercial.
//
// Calendrier, à compter de l'envoi du devis (devis_sent_at), tant que le
// prospect n'a pas répondu depuis :
//   J+3   relance n°1 — « avez-vous pu regarder la proposition ? un point de
//         10 minutes ? » (sautée si le commercial a cliqué « Appel fait » :
//         ils se sont parlé, Aaron n'écrit pas par-dessus)
//   J+7   relance n°2 — élément nouveau (un cas client, une précision), pas
//         une répétition
//   J+14  relance n°3, la dernière — porte ouverte, sans pression
//   J+21  toujours rien : push au commercial « trois relances sans réponse,
//         à toi : un appel, ou tu clos » — un devis ne se classe jamais perdu
//         tout seul, c'est de l'argent.
// Aaron connaît l'ouverture du devis (date, nombre de fois) et le choix du
// commercial : il adapte le ton, mais ne dit JAMAIS au prospect « vous avez
// ouvert mon devis » (pixel = information interne). Créneau d'envoi du
// commercial (lib/send-window.ts), plafond quotidien, Haiku en lot.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { applyAaronOutput, pendingBatchProspectIds, type BatchItemInput } from '@/lib/aaron-batch';
import { hasReachedProspectingCap, DailySendCapExceededError, DomainNotDeliverableError, MailboxAuthBrokenError } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';
import { serverError } from '@/lib/http';
import { isProspectingWindowOpenForUser } from '@/lib/send-window';
import { resolveUserTimeZone } from '@/lib/user-timezone';
import { technicalCompanyIds } from '@/lib/technical-accounts';

const SCHEDULE_DAYS = [3, 7, 14];
const GIVE_UP_PUSH_DAY = 21;
const MAX_PER_USER_PER_RUN = 10;

const PUSH_TEXTS: Record<string, { relanced: string; giveUp: string }> = {
  fr: { relanced: 'J’ai relancé {name} par email après le devis ({n}/3). Tu n’as rien à faire.', giveUp: '{name} n’a pas répondu à trois relances après le devis. À toi : un appel, ou tu clos.' },
  en: { relanced: 'I followed up with {name} by email after the quote ({n}/3). Nothing to do on your side.', giveUp: '{name} has not answered three follow-ups after the quote. Your call: phone them, or close it.' },
  de: { relanced: 'Ich habe bei {name} nach dem Angebot per E-Mail nachgefasst ({n}/3). Nichts zu tun für dich.', giveUp: '{name} hat auf drei Nachfassaktionen nach dem Angebot nicht geantwortet. Deine Entscheidung: anrufen oder abschließen.' },
  it: { relanced: 'Ho ricontattato {name} via email dopo il preventivo ({n}/3). Non devi fare nulla.', giveUp: '{name} non ha risposto a tre solleciti dopo il preventivo. A te: una chiamata, o chiudi.' },
  es: { relanced: 'He hecho seguimiento a {name} por correo tras el presupuesto ({n}/3). No tienes nada que hacer.', giveUp: '{name} no ha respondido a tres seguimientos tras el presupuesto. Tú decides: una llamada, o cierras.' },
  pt: { relanced: 'Relancei {name} por email depois do orçamento ({n}/3). Não tens nada a fazer.', giveUp: '{name} não respondeu a três relances depois do orçamento. Decides tu: uma chamada, ou fechas.' },
  nl: { relanced: 'Ik heb {name} per e-mail opgevolgd na de offerte ({n}/3). Jij hoeft niets te doen.', giveUp: '{name} heeft niet gereageerd op drie opvolgingen na de offerte. Aan jou: bellen, of afsluiten.' },
};

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let res: any = await supabaseAdmin
    .from('prospects')
    .select('id, email, full_name, assigned_user_id, company_id, deal_stage, devis_sent_at, devis_opened_at, devis_open_count, devis_call_done_at, devis_followups_sent, devis_followup_last_at, devis_giveup_pushed_at, ai_managed, conversations(id, messages(id, direction, sent_at))')
    .eq('is_won', false)
    .eq('is_lost', false)
    .eq('deal_stage', 'devis_envoye')
    .not('devis_sent_at', 'is', null);
  if (res.error?.code === '42703') {
    return NextResponse.json({ skipped: true, reason: 'migration_devis_followups_2026-11-09.sql pas encore lancée' });
  }
  if (res.error) return serverError(res.error, '/api/cron/devis-followups');

  const technical = await technicalCompanyIds();
  const pendingIds = await pendingBatchProspectIds();
  const now = Date.now();
  const windowOpenByUser = new Map<string, boolean>();
  const cappedUsers = new Map<string, boolean>();
  const localeByUser = new Map<string, string>();
  const perUser: Record<string, number> = {};
  let relanced = 0; let pushed = 0;

  for (const p of (res.data || []) as any[]) {
    try {
      if (!p.email || p.ai_managed === false || technical.has(p.company_id)) continue;
      const sentAt = new Date(p.devis_sent_at).getTime();
      const days = (now - sentAt) / 86_400_000;
      const messages: { direction: string; sent_at: string }[] = (p.conversations?.[0]?.messages || []);
      // Le prospect a écrit depuis le devis : check-inbox s'en occupe.
      if (messages.some((m) => m.direction === 'inbound' && new Date(m.sent_at).getTime() > sentAt)) continue;

      const done = Number(p.devis_followups_sent || 0);
      if (done >= SCHEDULE_DAYS.length) {
        if (days >= GIVE_UP_PUSH_DAY && !p.devis_giveup_pushed_at) {
          const { error } = await supabaseAdmin.from('prospects').update({ devis_giveup_pushed_at: new Date().toISOString() }).eq('id', p.id).is('devis_giveup_pushed_at', null);
          if (!error) {
            const locale = await userLocale(p.assigned_user_id, localeByUser);
            await sendPushNotification(p.assigned_user_id, { title: p.full_name || '', body: (PUSH_TEXTS[locale] || PUSH_TEXTS.fr).giveUp.replace('{name}', p.full_name || ''), url: `/app/prospects?user_id=${p.assigned_user_id}&contact=${p.id}`, tag: `devis_relances:${p.id}` });
            pushed++;
          }
        }
        continue;
      }

      let next = done; // index de la prochaine relance
      // Le commercial a appelé : la relance J+3 n'a pas lieu d'être.
      if (next === 0 && p.devis_call_done_at) next = 1;
      if (next >= SCHEDULE_DAYS.length) continue;
      if (days < SCHEDULE_DAYS[next]) continue;
      // Jamais deux relances à moins de 3 jours d'écart (sécurité).
      if (p.devis_followup_last_at && now - new Date(p.devis_followup_last_at).getTime() < 3 * 86_400_000) continue;
      if (pendingIds.has(p.id)) continue;

      const uid = p.assigned_user_id;
      if (!windowOpenByUser.has(uid)) {
        let tz: any = await supabaseAdmin.from('users').select('timezone, billing_country').eq('id', uid).maybeSingle();
        if (tz.error?.code === '42703') tz = { data: {} };
        windowOpenByUser.set(uid, await isProspectingWindowOpenForUser(uid, resolveUserTimeZone(tz.data || {})));
      }
      if (!windowOpenByUser.get(uid)) continue;
      if (!cappedUsers.has(uid)) cappedUsers.set(uid, await hasReachedProspectingCap(uid));
      if (cappedUsers.get(uid)) continue;
      perUser[uid] = (perUser[uid] || 0) + 1;
      if (perUser[uid] > MAX_PER_USER_PER_RUN) continue;

      const conversationId = p.conversations?.[0]?.id;
      if (!conversationId) continue;

      const opened = p.devis_opened_at ? `Le devis a été ouvert par le prospect (${p.devis_open_count || 1} fois, la première le ${new Date(p.devis_opened_at).toISOString().slice(0, 10)}) — information INTERNE, ne jamais l'écrire au prospect.` : 'Rien n’indique que le devis ait été ouvert — ne pas le mentionner.';
      const called = p.devis_call_done_at ? 'Le commercial a eu le prospect au téléphone après le devis.' : 'Le commercial n’a pas réussi à joindre le prospect depuis le devis.';
      const tone = next === 0
        ? 'Relance n°1, courte et chaleureuse : demander si la proposition a pu être regardée, proposer un échange de 10 minutes (deux créneaux libres si tu en as), rappeler en une phrase le bénéfice principal.'
        : next === 1
          ? 'Relance n°2 : apporter un élément NOUVEAU (un cas client comparable, une précision utile, une réponse à une objection probable), pas une répétition. Proposer de nouveau un échange.'
          : 'Relance n°3, la dernière : porte ouverte sans pression (« je reste disponible, dites-moi simplement si ce n’est plus d’actualité »), une phrase de bénéfice, pas de nouvelle demande de rendez-vous insistante.';
      const situation = `Relance après envoi d’un DEVIS, il y a ${Math.floor(days)} jours, resté sans réponse. ${opened} ${called} ${tone} L’email part depuis la boîte du commercial, dans la langue du prospect ; les champs de détection valent false/null.`;

      const item: BatchItemInput = { prospectId: p.id, userId: uid, companyId: p.company_id || null, conversationId, kind: 'followup' };
      const out = await generateAaronResponse(p.id, { model: 'claude-haiku-4-5', feature: 'relance', situation });
      if (out.truncated || !out.email_draft?.body?.trim()) continue;
      // Pas de tentative de sauvetage ici : on veut un email, pas un brouillon.
      out.rescue_proposal = null as any;
      await applyAaronOutput(item, out);
      await supabaseAdmin.from('prospects').update({ devis_followups_sent: next + 1, devis_followup_last_at: new Date().toISOString() }).eq('id', p.id);
      relanced++;
      try {
        const locale = await userLocale(uid, localeByUser);
        await sendPushNotification(uid, { title: p.full_name || '', body: (PUSH_TEXTS[locale] || PUSH_TEXTS.fr).relanced.replace('{name}', p.full_name || '').replace('{n}', String(next + 1)), url: `/app/prospects?user_id=${uid}&contact=${p.id}`, tag: `devis_relances:${p.id}` });
      } catch {}
    } catch (err: any) {
      if (!(err instanceof MonthlyCapExceededError) && !(err instanceof DailySendCapExceededError) && !(err instanceof DomainNotDeliverableError) && !(err instanceof MailboxAuthBrokenError)) {
        console.error(`[devis-followups] ${p.id}:`, err?.message || err);
      }
    }
  }
  return NextResponse.json({ relanced, pushed });
}

async function userLocale(userId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!;
  const { data } = await supabaseAdmin.from('users').select('locale').eq('id', userId).maybeSingle();
  const l = String((data as any)?.locale || 'fr').slice(0, 2).toLowerCase();
  cache.set(userId, l);
  return l;
}
