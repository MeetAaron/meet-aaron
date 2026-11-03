// app/api/admin/api-balance/route.ts
// Solde du compte Anthropic d'Alex et autonomie estimée (22/10/2026) — voir
// lib/api-balance.ts. RÉSERVÉ AU COMPTE FONDATEUR, double authentification
// obligatoire, même garde-fou que /api/admin/margin.
// GET  -> état (solde saisi, dépensé depuis, reste, jours d'autonomie)
// POST -> { balance_usd } : nouveau solde lu dans la console Anthropic
//         (après une recharge) ; remet les alertes à zéro.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse, requireMfa } from '@/lib/auth-helpers';
import { isFounderEmail } from '@/lib/founder';
import { getBalanceStatus, BALANCE_PROVIDERS, type BalanceProvider } from '@/lib/api-balance';
import { readJsonBody, serverError } from '@/lib/http';


async function guard(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return { error: unauthorizedResponse() };
  if (!isFounderEmail(authedUser.email)) return { error: forbiddenResponse() };
  const mfa = requireMfa(authedUser);
  if (mfa) return { error: mfa };
  return { user: authedUser };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;
  try {
    // Les deux fournisseurs d'un coup : l'écran les affiche côte à côte, et
    // `status` reste là pour ne rien casser pendant le déploiement.
    const statuses = await Promise.all(BALANCE_PROVIDERS.map((p) => getBalanceStatus(p)));
    return NextResponse.json({ status: statuses[0], statuses });
  } catch (err) {
    return serverError(err, '/api/admin/api-balance');
  }
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;
  const body: any = await readJsonBody(request);
  const balance = Number(String(body?.balance_usd ?? '').replace(',', '.'));
  if (!Number.isFinite(balance) || balance < 0 || balance > 1_000_000) {
    return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  }
  // Repli sur Anthropic quand le fournisseur n'est pas transmis : l'ancien
  // écran n'envoyait pas ce champ, et une saisie perdue vaut moins qu'une
  // saisie rangée au bon endroit par défaut.
  const provider: BalanceProvider = BALANCE_PROVIDERS.includes(body?.provider) ? body.provider : 'anthropic';
  const { error } = await supabaseAdmin
    .from('api_balance_snapshots')
    .insert({ provider, balance_usd: Math.round(balance * 100) / 100, as_of: new Date().toISOString() });
  if (error) {
    if ((error as any).code === '42P01') {
      return NextResponse.json({ error: 'Table api_balance_snapshots absente : lance migration_solde_api_2026-10-22.sql' }, { status: 409 });
    }
    return serverError(error, '/api/admin/api-balance');
  }
  const statuses = await Promise.all(BALANCE_PROVIDERS.map((p) => getBalanceStatus(p)));
  return NextResponse.json({ status: statuses[0], statuses });
}
