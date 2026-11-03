// app/api/cron/anthropic-receipts/route.ts
// Une fois par jour : cherche les reçus de recharge Anthropic dans la boîte
// Meet Aaron et met le solde à jour tout seul (voir lib/anthropic-receipts.ts).
// Alex reçoit un email à chaque crédit — une erreur de lecture doit se voir
// le jour même, pas trois semaines plus tard.

import { NextRequest, NextResponse } from 'next/server';
import { scanAnthropicReceipts } from '@/lib/anthropic-receipts';
import { sendSystemEmail } from '@/lib/google';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const OPERATOR_EMAIL = process.env.OPERATOR_ALERT_EMAIL || 'aaron@meetaaron.app';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const result = await scanAnthropicReceipts();
    if (!result.mailbox) {
      return NextResponse.json({ skipped: true, reason: 'aucune boîte configurée' });
    }

    const credited = result.outcomes.filter((o) => o.credited);
    const needsHand = result.outcomes.filter(
      (o) => !o.credited && (o.reason === 'montant_introuvable' || o.reason === 'montant_aberrant')
    );
    const blocked = result.outcomes.filter((o) => o.reason === 'colonne_absente');

    if (credited.length > 0) {
      const lines = [
        'Recharge Anthropic détectée, solde mis à jour tout seul :',
        '',
        ...credited.map(
          (o) => `• +${o.amountUsd?.toFixed(2)} $ → nouveau solde ${o.newBalanceUsd?.toFixed(2)} $`
        ),
        '',
        "Si l'un de ces montants est faux, corrige le solde dans /app/marge : la saisie",
        'manuelle reste prioritaire, elle écrase celui-ci.',
      ];
      await sendSystemEmail(OPERATOR_EMAIL, 'Meet Aaron — solde Anthropic mis à jour', lines.join('\n'), 'fr').catch(
        () => {}
      );
    }

    if (needsHand.length > 0) {
      const lines = [
        "J'ai trouvé un reçu Anthropic mais je n'ai pas réussi à en lire le montant de façon sûre,",
        "donc je n'ai rien écrit — un solde faux serait pire que pas de solde.",
        '',
        ...needsHand.map((o) =>
          o.reason === 'montant_aberrant'
            ? `• montant lu invraisemblable (${o.amountUsd} $), ignoré`
            : '• aucun montant étiqueté trouvé dans le reçu'
        ),
        '',
        'Saisis le solde à la main dans /app/marge.',
      ];
      await sendSystemEmail(
        OPERATOR_EMAIL,
        'Meet Aaron — reçu Anthropic à saisir à la main',
        lines.join('\n'),
        'fr'
      ).catch(() => {});
    }

    if (blocked.length > 0) {
      console.error(
        '[reçus Anthropic] colonne source_message_id absente : lancer migration_recus_anthropic_2026-11-02.sql'
      );
    }

    return NextResponse.json({
      scanned: result.scanned,
      credited: credited.length,
      needsHand: needsHand.length,
      blocked: blocked.length,
    });
  } catch (err: any) {
    return serverError(err, 'Reçus Anthropic');
  }
}
