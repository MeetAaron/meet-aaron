// lib/first-email-deferred.ts
// Envoi des premiers emails REPORTÉS par le créneau d'envoi (lib/send-window.ts).
//
// Quand Aaron génère un premier email en mode « envoi automatique » (pas de
// relecture par le commercial) hors du créneau 8 h–12 h en semaine, le
// brouillon est stocké dans prospects.pending_first_email_* au lieu de
// partir (voir applyAaronOutput, lib/aaron-batch.ts). Cette fonction,
// appelée par app/api/cron/retry-uncontacted-prospects toutes les 20 min,
// les envoie dès que la fenêtre du commercial est ouverte.
//
// Comment on distingue un brouillon « à relire » d'un brouillon « reporté » :
// par le réglage du commercial. require_first_email_approval = true → le
// brouillon attend SA validation (bouton dans la fiche), on n'y touche pas.
// false → personne ne doit valider, le brouillon n'attend que l'heure. Si un
// commercial désactive la relecture alors que des brouillons attendaient,
// ils partent au créneau suivant — c'est le sens du réglage.
//
// Même réclamation atomique que l'action envoyer_premier_email
// (app/api/prospects/[id]/route.ts) : l'UPDATE … WHERE pending non nul ne
// rend une ligne qu'à un seul appelant, jamais d'envoi en double.

import { supabaseAdmin } from './supabase-admin';
import { sendEmailForUser, hasReachedProspectingCap, DailySendCapExceededError, DomainNotDeliverableError, MailboxAuthBrokenError } from './messaging';
import { isSendWindowOpen } from './send-window';
import { resolveUserTimeZone } from './user-timezone';

const MAX_PER_USER_PER_RUN = 5;

export interface DeferredSendReport {
  sent: number;
  skipped_window: number;
  skipped_cap: number;
  errors: { prospect_id: string; error: string }[];
}

export async function sendDeferredFirstEmails(): Promise<DeferredSendReport> {
  const report: DeferredSendReport = { sent: 0, skipped_window: 0, skipped_cap: 0, errors: [] };

  const { data: drafts, error } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, ai_managed, pending_first_email_subject, pending_first_email_body, pending_first_email_generated_at')
    .not('pending_first_email_subject', 'is', null)
    .eq('is_won', false)
    .eq('is_lost', false)
    .order('pending_first_email_generated_at', { ascending: true });
  if (error || !drafts || drafts.length === 0) return report;

  const userIds = Array.from(new Set(drafts.map((d) => d.assigned_user_id).filter(Boolean)));
  let usersRes: any = await supabaseAdmin
    .from('users')
    .select('id, email, require_first_email_approval, timezone, billing_country')
    .in('id', userIds);
  if (usersRes.error?.code === '42703') {
    usersRes = await supabaseAdmin.from('users').select('id, email, require_first_email_approval').in('id', userIds);
  }
  const users = new Map<string, any>();
  for (const u of usersRes.data || []) users.set(u.id, u);

  const perUser: Record<string, number> = {};
  const blockedUsers = new Set<string>();

  for (const draft of drafts) {
    const user = users.get(draft.assigned_user_id);
    if (!user) continue;
    // Brouillon à relire par le commercial : pas pour nous.
    if (user.require_first_email_approval === true) continue;
    // Le commercial a repris ce prospect en main : Aaron n'envoie rien.
    if (draft.ai_managed === false) continue;
    if (blockedUsers.has(user.id)) continue;

    if (!isSendWindowOpen('prospecting', resolveUserTimeZone(user))) {
      report.skipped_window += 1;
      continue;
    }
    if (await hasReachedProspectingCap(user.id)) {
      report.skipped_cap += 1;
      blockedUsers.add(user.id);
      continue;
    }
    perUser[user.id] = (perUser[user.id] || 0) + 1;
    if (perUser[user.id] > MAX_PER_USER_PER_RUN) continue;

    const subject = draft.pending_first_email_subject as string;
    const body = draft.pending_first_email_body as string;
    const generatedAt = draft.pending_first_email_generated_at;

    const { data: claimed } = await supabaseAdmin
      .from('prospects')
      .update({ pending_first_email_subject: null, pending_first_email_body: null, pending_first_email_generated_at: null })
      .eq('id', draft.id)
      .not('pending_first_email_subject', 'is', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      await sendEmailForUser(user.id, draft.email, subject, body, { emailType: 'prospecting' });
      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('prospect_id', draft.id)
        .eq('channel', 'email')
        .maybeSingle();
      if (conversation) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          sender_email: user.email || '',
          recipient_email: draft.email,
          body,
        });
      }
      report.sent += 1;
    } catch (err: any) {
      // Plafond atteint, domaine sans SPF/DMARC, boîte qui refuse le mot de
      // passe : le brouillon est remis en place tel quel et repartira au
      // prochain passage — rien n'est perdu. Autre erreur : idem, mais on
      // la remonte dans le rapport du cron.
      await supabaseAdmin
        .from('prospects')
        .update({ pending_first_email_subject: subject, pending_first_email_body: body, pending_first_email_generated_at: generatedAt })
        .eq('id', draft.id);
      blockedUsers.add(user.id);
      const soft = err instanceof DailySendCapExceededError || err instanceof DomainNotDeliverableError || err instanceof MailboxAuthBrokenError;
      if (!soft) report.errors.push({ prospect_id: draft.id, error: err?.message || String(err) });
    }
  }

  return report;
}
