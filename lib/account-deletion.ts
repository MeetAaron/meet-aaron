// lib/account-deletion.ts
// Exécution RÉELLE d'une suppression de compte "Supprimer mon compte"
// (self-service, app/app/connexions/page.jsx, 4e onglet), demandée 24h plus
// tôt via POST /api/account/deletion. Appelé uniquement par
// app/api/cron/execute-account-deletions/route.ts, une fois le délai de
// 24h écoulé (users.deletion_scheduled_for <= now()).
//
// Même portée de suppression que migration_account_deletion_2026-08-25.sql
// (trigger SQL déclenché par une suppression brute côté Supabase Auth), en
// TypeScript ici car Postgres ne peut pas appeler l'API Stripe : ce chemin-ci
// résilie donc en plus l'abonnement Stripe quand la société est entièrement
// supprimée — c'est la différence entre les deux mécanismes, voir le
// commentaire en tête de la migration SQL.

import { supabaseAdmin } from './supabase-admin';
import { stripe } from './stripe';
import { chunk, forEachChunk } from './chunked-in';

// Tous les ids d'une table pour une valeur (ou une liste courte) de colonne,
// par pages de 1 000 (limite par défaut d'une lecture Supabase).
async function allIds(table: string, column: string, value: string | string[]): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q: any = supabaseAdmin.from(table).select('id');
    q = Array.isArray(value) ? q.in(column, value) : q.eq(column, value);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data.map((r: any) => r.id));
    if (data.length < PAGE) break;
  }
  return out;
}

export interface DeletionTarget {
  id: string; // users.id
  auth_user_id: string;
  company_id: string | null;
}

// Supprime uniquement les données personnelles d'un membre d'une équipe
// (pas seul·e dans sa société) : son propre profil "users" et tout ce qui
// lui appartient en propre. Les données de la société ne sont PAS touchées.
async function deleteUserOwnData(user: DeletionTarget): Promise<void> {
  await supabaseAdmin.from('chat_messages').delete().eq('user_id', user.id);
  await supabaseAdmin.from('push_subscriptions').delete().eq('user_id', user.id);
  await supabaseAdmin.from('email_send_counters').delete().eq('user_id', user.id);
  await supabaseAdmin.from('availability_blocks').delete().eq('user_id', user.id);
  await supabaseAdmin.from('availability_rules').delete().eq('user_id', user.id);
  await supabaseAdmin.from('oauth_connections').delete().eq('user_id', user.id);
  await supabaseAdmin.from('email_verifications').delete().eq('auth_user_id', user.auth_user_id);
  await supabaseAdmin.from('users').delete().eq('id', user.id);
}

// Supprime une société entière et toutes ses données — même ordre de tables
// que cleanup_alex_account_2026-08-19.sql et le trigger SQL de
// migration_account_deletion_2026-08-25.sql (voir ces fichiers pour le
// détail table par table), plus la résiliation Stripe que ni l'un ni
// l'autre ne peut faire depuis leur contexte respectif (nettoyage manuel /
// trigger Postgres).
async function deleteWholeCompany(companyId: string): Promise<void> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, stripe_subscription_id')
    .eq('id', companyId)
    .maybeSingle();

  if (company?.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(company.stripe_subscription_id);
    } catch (err: any) {
      // On log mais on continue quand même la suppression des données —
      // l'abonnement peut déjà avoir été annulé manuellement (voir avertissement
      // de migration_account_deletion_2026-08-25.sql), et bloquer toute la
      // suppression pour ça serait pire que de laisser un abonnement orphelin
      // à vérifier manuellement dans le dashboard Stripe.
      console.error('[account-deletion] Erreur résiliation Stripe (company_id=' + companyId + '):', err.message);
    }
  }

  // Listes complètes (24/10/2026) : une lecture Supabase s'arrête à 1 000
  // lignes par défaut, et un filtre .in() sur des centaines d'ids dépasse la
  // longueur d'URL. Avec un gros fichier de contacts, la suppression
  // laissait donc des lignes liées derrière elle. On pagine les lectures et
  // on découpe les suppressions en paquets (lib/chunked-in.ts).
  const prospectIds = await allIds('prospects', 'company_id', companyId);
  const quoteIds = await allIds('quotes', 'company_id', companyId);

  const conversationIds: string[] = [];
  for (const part of chunk(prospectIds)) {
    conversationIds.push(...(await allIds('conversations', 'prospect_id', part)));
  }

  await forEachChunk(conversationIds, (part) => supabaseAdmin.from('messages').delete().in('conversation_id', part));

  for (const table of ['customer_checkins', 'customer_health_alerts', 'customer_support_drafts', 'deal_stage_alerts', 'appointments']) {
    await forEachChunk(prospectIds, (part) => supabaseAdmin.from(table).delete().in('prospect_id', part));
  }

  const { data: companyUsers } = await supabaseAdmin.from('users').select('id, auth_user_id').eq('company_id', companyId);
  const userIds = (companyUsers || []).map((u) => u.id);
  const authUserIds = (companyUsers || []).map((u) => u.auth_user_id);

  if (userIds.length) {
    await supabaseAdmin.from('notifications_log').delete().in('user_id', userIds);
  }
  await forEachChunk(prospectIds, (part) => supabaseAdmin.from('conversations').delete().in('prospect_id', part));

  await forEachChunk(quoteIds, (part) => supabaseAdmin.from('quote_line_items').delete().in('quote_id', part));
  await supabaseAdmin.from('quotes').delete().eq('company_id', companyId);

  await supabaseAdmin.from('prospects').delete().eq('company_id', companyId);
  await supabaseAdmin.from('prospect_companies').delete().eq('company_id', companyId);
  await supabaseAdmin.from('prospecting_campaigns').delete().eq('company_id', companyId);
  await supabaseAdmin.from('company_documents').delete().eq('company_id', companyId);
  await supabaseAdmin.from('feedback_messages').delete().eq('company_id', companyId);
  await supabaseAdmin.from('products').delete().eq('company_id', companyId);
  await supabaseAdmin.from('crm_connections').delete().eq('company_id', companyId);
  await supabaseAdmin.from('credit_transactions').delete().eq('company_id', companyId);
  await supabaseAdmin.from('api_usage_monthly').delete().eq('company_id', companyId);
  await supabaseAdmin.from('api_usage_daily').delete().eq('company_id', companyId);

  const { data: campaigns } = await supabaseAdmin.from('marketing_campaigns').select('id').eq('company_id', companyId);
  const campaignIds = (campaigns || []).map((c) => c.id);
  if (campaignIds.length) {
    await forEachChunk(campaignIds, (part) => supabaseAdmin.from('marketing_campaign_recipients').delete().in('campaign_id', part));
  }
  await supabaseAdmin.from('marketing_campaigns').delete().eq('company_id', companyId);
  await supabaseAdmin.from('client_invoices').delete().eq('company_id', companyId);
  await supabaseAdmin.from('reactivation_batches').delete().eq('company_id', companyId);

  if (userIds.length) {
    await supabaseAdmin.from('chat_messages').delete().in('user_id', userIds);
    await supabaseAdmin.from('push_subscriptions').delete().in('user_id', userIds);
    await supabaseAdmin.from('email_send_counters').delete().in('user_id', userIds);
    await supabaseAdmin.from('availability_blocks').delete().in('user_id', userIds);
    await supabaseAdmin.from('availability_rules').delete().in('user_id', userIds);
    await supabaseAdmin.from('oauth_connections').delete().in('user_id', userIds);
  }
  if (authUserIds.length) {
    await supabaseAdmin.from('email_verifications').delete().in('auth_user_id', authUserIds);
  }

  await supabaseAdmin.from('users').delete().eq('company_id', companyId);
  await supabaseAdmin.from('companies').delete().eq('id', companyId);

  // Supprime aussi le(s) compte(s) Supabase Auth de la société — sans ça,
  // exactement le bug remonté par Alex le 25/08 se reproduirait à l'envers :
  // le compte Auth resterait vivant, prêt à se relier à une nouvelle ligne
  // "users" si quelqu'un se réinscrit avec le même email.
  for (const authUserId of authUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (err: any) {
      console.error('[account-deletion] Erreur suppression compte Auth (auth_user_id=' + authUserId + '):', err.message);
    }
  }
}

// Point d'entrée appelé par le cron pour chaque ligne "users" dont
// deletion_scheduled_for est dépassé. Détermine solo vs équipe puis délègue
// à la fonction correspondante.
export async function executeAccountDeletion(user: DeletionTarget): Promise<void> {
  if (!user.company_id) {
    // Profil orphelin (ne devrait normalement pas arriver) : on supprime au
    // moins ses propres données et son compte Auth.
    await deleteUserOwnData(user);
    try {
      await supabaseAdmin.auth.admin.deleteUser(user.auth_user_id);
    } catch (err: any) {
      console.error('[account-deletion] Erreur suppression compte Auth (auth_user_id=' + user.auth_user_id + '):', err.message);
    }
    return;
  }

  const { count } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', user.company_id);

  if ((count || 0) > 1) {
    await deleteUserOwnData(user);
    try {
      await supabaseAdmin.auth.admin.deleteUser(user.auth_user_id);
    } catch (err: any) {
      console.error('[account-deletion] Erreur suppression compte Auth (auth_user_id=' + user.auth_user_id + '):', err.message);
    }
    return;
  }

  await deleteWholeCompany(user.company_id);
}
