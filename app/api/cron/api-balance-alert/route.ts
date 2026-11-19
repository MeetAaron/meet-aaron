// app/api/cron/api-balance-alert/route.ts
// Tous les jours : prévient Alex quand le solde d'un fournisseur d'IA ne
// couvre plus que 10 jours, puis 3 jours, de consommation moyenne
// (22/10/2026) — voir lib/api-balance.ts. Une seule alerte par seuil et par
// solde saisi : une nouvelle saisie dans /app/marge (après recharge) remet
// les compteurs à zéro. Notification push sur les appareils du compte
// fondateur + email système à l'adresse d'alerte opérateur.
//
// DEUX FOURNISSEURS depuis le 03/11/2026 (Alex : « sois au courant du solde,
// dépenses etc, comme pour Anthropic »). Aaron envoie le palier « cheap »
// chez OpenAI quand OPENAI_API_KEY est posée — c'est le cas en production.
// Chacun a son solde et ses seuils ; une panne sur l'un ne doit pas priver
// l'autre de son alerte, donc chaque fournisseur est traité dans son propre
// try/catch.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { FOUNDER_EMAILS } from '@/lib/founder';
import {
  getBalanceStatus,
  BALANCE_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_CONSOLES,
  type BalanceProvider,
} from '@/lib/api-balance';
import { sendPushNotification } from '@/lib/push';
import { sendSystemEmail } from '@/lib/google';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const OPERATOR_EMAIL = process.env.OPERATOR_ALERT_EMAIL || 'aaron@meetaaron.app';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

async function notify(title: string, body: string, tag: string) {
  const { data: founders } = await supabaseAdmin.from('users').select('id, email').in('email', FOUNDER_EMAILS);
  for (const founder of founders || []) {
    await sendPushNotification((founder as any).id, { title, body, url: '/app/marge', tag } as any).catch(() => {});
  }
  await sendSystemEmail(OPERATOR_EMAIL, `Meet Aaron — ${title}`, body, 'fr').catch(() => {});
}

async function checkProvider(provider: BalanceProvider): Promise<Record<string, unknown>> {
  const label = PROVIDER_LABELS[provider];
  const console_ = PROVIDER_CONSOLES[provider];
  const st = await getBalanceStatus(provider);

  if (!st.configured || !st.snapshotId) {
    return { provider, configured: st.configured, daysLeft: st.daysLeft };
  }

  // DÉPENSE INCONNUE (OpenAI sans clé d'administration). On ne peut ni
  // annoncer un reste ni se taire : se taire ferait disparaître le filet
  // sans bruit. On alerte donc une fois sur la CAUSE.
  if (st.spendUnknown) {
    if (st.alerted10At || st.alerted3At) return { provider, spendUnknown: true, alreadyAlerted: true };
    await notify(
      `Solde ${label} non surveillé`,
      `Un solde ${label} a été saisi, mais je ne peux pas lire la dépense réelle : ` +
        `la clé d'administration manque. Pose OPENAI_ADMIN_KEY dans Vercel (clé sk-admin-… ` +
        `créée depuis ${console_}) pour que l'alerte fonctionne. ` +
        `Tant qu'elle manque, personne ne surveille ce solde.`,
      `api-balance-unknown-${provider}`
    );
    await supabaseAdmin
      .from('api_balance_snapshots')
      .update({ alerted_10_at: new Date().toISOString() })
      .eq('id', st.snapshotId);
    return { provider, alerted: 'spendUnknown' };
  }

  // SOLDE PÉRIMÉ. Au-delà de dix jours sans nouvelle saisie, on n'annonce
  // plus de chiffre — un rechargement a pu avoir lieu entre-temps sans être
  // ressaisi, et c'est exactement ce qui a produit une alerte « il reste
  // 1,43 $ » alors que le solde réel était de 9,48 $.
  //
  // Mais se taire serait pire : le filet de sécurité disparaîtrait
  // silencieusement. On alerte donc sur l'ANCIENNETÉ au lieu du montant, une
  // seule fois par solde (on réutilise alerted_10_at comme marqueur).
  if (st.stale) {
    // PIRE CAS, CHIFFRÉ (19/11/2026, Alex : « j'ai reçu un email, d'où ça
    // vient ? »). L'alerte disait seulement « je ne peux plus dire combien
    // il reste », sans rien pour juger de l'urgence. Or, depuis que les
    // recharges sont créditées toutes seules à partir du reçu
    // (lib/anthropic-receipts.ts), un solde périmé veut le plus souvent dire
    // qu'AUCUNE recharge n'a eu lieu : le reste réel est alors proche de
    // « solde saisi moins dépense constatée ». On le donne comme hypothèse,
    // jamais comme un fait.
    const worstRemaining = Math.max(0, (st.balanceUsd || 0) - st.spentSinceUsd);
    const worstDays = st.avgDailyUsd > 0 ? worstRemaining / st.avgDailyUsd : null;
    const usd = (n: number) => n.toFixed(2).replace('.', ',');
    const worstLine =
      `Si tu n'as pas rechargé depuis, il resterait environ ${usd(worstRemaining)} $ sur les ` +
      `${usd(st.balanceUsd || 0)} $ saisis` +
      (worstDays !== null ? `, soit ${Math.max(0, Math.floor(worstDays))} jour${Math.floor(worstDays) > 1 ? 's' : ''} au rythme des 7 derniers jours` : '') +
      `. À zéro, Aaron s'arrête pour TOUS les clients.`;

    if (!st.alerted10At && !st.alerted3At) {
      await notify(
        `Solde ${label} à revérifier`,
        `Ce message vient de Meet Aaron, pas de ${label} : rien n'a été débité. Le dernier solde ${label} ` +
          `saisi date d'il y a ${st.balanceAgeDays} jours, il n'est plus fiable. ` +
          `Dépense constatée depuis : ${usd(st.spentSinceUsd)} $. ${worstLine} ` +
          `Ouvre ${console_}, lis le solde réel et saisis-le dans /app/marge.`,
        `api-balance-stale-${provider}`
      );
      await supabaseAdmin
        .from('api_balance_snapshots')
        .update({ alerted_10_at: new Date().toISOString() })
        .eq('id', st.snapshotId);
      return { provider, alerted: 'stale', balanceAgeDays: st.balanceAgeDays };
    }

    // FILET DE SÉCURITÉ. Avant, un solde périmé ne déclenchait plus JAMAIS
    // d'alerte après la première : les seuils 10 jours et 3 jours ont besoin
    // d'un reste chiffré, et un solde périmé n'en a plus. Avec une petite
    // consommation (un solde de 5 $ dure plus de dix jours), on passait donc
    // de « à revérifier » à la panne sans rien entre les deux. Une seconde
    // alerte part désormais quand le pire cas descend à 3 jours.
    if (worstDays !== null && worstDays <= 3 && !st.alerted3At) {
      await notify(
        `Solde ${label} peut-être presque vide`,
        `Le solde ${label} n'a toujours pas été ressaisi (dernière saisie il y a ${st.balanceAgeDays} jours). ` +
          `${worstLine} Vérifie sur ${console_}, recharge si besoin, puis saisis le solde dans /app/marge.`,
        `api-balance-stale-urgent-${provider}`
      );
      await supabaseAdmin
        .from('api_balance_snapshots')
        .update({ alerted_3_at: new Date().toISOString() })
        .eq('id', st.snapshotId);
      return { provider, alerted: 'stale_urgent', balanceAgeDays: st.balanceAgeDays };
    }
    return { provider, stale: true, alreadyAlerted: true };
  }

  if (st.daysLeft === null) {
    return { provider, checked: true, daysLeft: null };
  }

  // Seuil le plus grave atteint et pas encore signalé pour ce solde.
  let level: 3 | 10 | null = null;
  if (st.daysLeft <= 3 && !st.alerted3At) level = 3;
  else if (st.daysLeft <= 10 && !st.alerted10At && !st.alerted3At) level = 10;
  if (!level) return { provider, checked: true, daysLeft: st.daysLeft };

  const days = Math.max(0, Math.floor(st.daysLeft));
  const remaining = Math.max(0, st.remainingUsd || 0).toFixed(2);
  const title = level === 3 ? `Solde ${label} presque vide` : `Solde ${label} à recharger`;
  // D'où vient le rythme (Alex, 04/11/2026 : « pourquoi j'ai reçu cet
  // email ? »). La moyenne des 7 derniers jours contenait encore deux
  // journées exceptionnelles d'avant le verrou de stock, et l'email
  // annonçait 6 jours là où le rythme réel en donnait 17. Le calcul reste
  // volontairement pessimiste — pour une alerte de carburant, c'est le bon
  // sens d'erreur — mais il doit dire sur quoi il se fonde.
  const body =
    `Il reste environ ${remaining} $, soit ${days} jour${days > 1 ? 's' : ''} au rythme des 7 derniers jours ` +
    `(${st.avgDailyUsd.toFixed(2)} $/jour en moyenne — si une journée récente a été exceptionnelle, ` +
    `l'autonomie réelle est plus longue que ça). À zéro, Aaron s'arrête pour TOUS les clients. ` +
    `Recharge sur ${console_}, puis saisis le nouveau solde dans /app/marge.\n\n` +
    // D'où vient le chiffre : une alerte fondée sur une estimation ne se lit
    // pas comme une alerte fondée sur la facture du fournisseur.
    (st.spentSource === 'fournisseur'
      ? `Dépense lue chez ${label} (${st.spentSinceUsd.toFixed(2)} $ depuis le solde saisi il y a ${st.balanceAgeDays} jour${(st.balanceAgeDays || 0) > 1 ? 's' : ''}).`
      : `Dépense ESTIMÉE (${st.spentSinceUsd.toFixed(2)} $ depuis le solde saisi il y a ${st.balanceAgeDays} jour${(st.balanceAgeDays || 0) > 1 ? 's' : ''}) — pose la clé d'administration pour lire la dépense réelle.`);

  await notify(title, body, `api-balance-${provider}-${level}`);

  await supabaseAdmin
    .from('api_balance_snapshots')
    .update(level === 3 ? { alerted_3_at: new Date().toISOString() } : { alerted_10_at: new Date().toISOString() })
    .eq('id', st.snapshotId);

  return { provider, alerted: level, daysLeft: st.daysLeft };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const results: Record<string, unknown>[] = [];
    for (const provider of BALANCE_PROVIDERS) {
      try {
        results.push(await checkProvider(provider));
      } catch (err: any) {
        console.error(`[solde ${provider}] vérification impossible :`, err?.message || err);
        results.push({ provider, error: String(err?.message || err) });
      }
    }
    return NextResponse.json({ results });
  } catch (err) {
    return serverError(err, '/api/cron/api-balance-alert');
  }
}
