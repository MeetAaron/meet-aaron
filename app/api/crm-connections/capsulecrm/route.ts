// app/api/crm-connections/capsulecrm/route.ts
// Capsule CRM (capsulecrm.com, Royaume-Uni) — 6e CRM du chantier "pas à pas",
// 1er dont la documentation officielle publique est complète et fiable
// (developer.capsulecrm.com/v2), contrairement à plancraft et ToolTime
// (recherchés juste avant, tous deux avec une API en beta fermée/gated sans
// aucune doc technique publique — non construits, voir claude/statut pour le
// détail, à reprendre si Alex obtient un accès direct auprès d'eux).
//
// Authentification par jeton d'accès personnel statique ("Personal Access
// Token"), généré par l'utilisateur dans Capsule (My Preferences -> API
// Authentication Tokens) — Capsule propose aussi un flux OAuth2 à
// redirection pour les apps multi-comptes publiées sur leur marketplace,
// mais pour une intégration serveur-à-serveur sur un seul compte comme ici,
// la documentation officielle recommande explicitement le jeton statique
// (plus simple, pas de redirection ni de client_id/secret à enregistrer).
// Même architecture qu'Axonaut/Housecall Pro : ce endpoint remplace la paire
// app/api/auth/<provider>/route.ts + callback/route.ts des CRM OAuth — pas
// de redirection externe, juste un jeton collé dans un formulaire (voir
// carte Capsule CRM dans app/app/connexions/page.jsx, réutilise le même
// composant ApiKeyCrmConnectionCard qu'Axonaut/Housecall Pro).
//
// POST -> valide le jeton auprès de Capsule (GET /api/v2/users/current) puis
// le stocke chiffré dans crm_connections, réservé au patron (même garde que
// les connexions existantes).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { encryptToken } from '@/lib/encryption';

const CAPSULECRM_BASE_URL = 'https://api.capsulecrm.com/api/v2';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') {
    return forbiddenResponse();
  }
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte.' }, { status: 400 });
  }

  let apiKey: string | null = null;
  try {
    const body = await request.json();
    apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : null;
  } catch {
    // corps absent/invalide -> traité comme clé manquante ci-dessous
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'Jeton API manquant.' }, { status: 400 });
  }

  // Validation : GET /users/current est l'endpoint officiel "utilisateur
  // associé au jeton" de Capsule CRM, il échoue (401/403) si le jeton est
  // invalide — même principe de validation que /me pour Axonaut et /company
  // pour Housecall Pro.
  let userRes: Response;
  try {
    userRes = await fetch(`${CAPSULECRM_BASE_URL}/users/current`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  } catch (err) {
    console.error('Erreur réseau validation jeton Capsule CRM:', err);
    return NextResponse.json({ error: 'Impossible de joindre Capsule CRM pour valider le jeton — réessayez.' }, { status: 502 });
  }

  if (!userRes.ok) {
    const message =
      userRes.status === 401 || userRes.status === 403
        ? 'Jeton API Capsule CRM invalide — vérifiez le jeton copié depuis Capsule (My Preferences -> API Authentication Tokens).'
        : `Erreur Capsule CRM lors de la validation du jeton (HTTP ${userRes.status}).`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let accountLabel: string | null = null;
  try {
    const userBody = await userRes.json();
    const user = userBody?.user;
    accountLabel = user?.name || user?.email || null;
  } catch (err) {
    console.error('Réponse /users/current Capsule CRM non-JSON (non bloquant):', err);
  }

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: authedUser.company_id,
        provider: 'capsulecrm',
        portal_id: accountLabel,
        access_token: encryptToken(apiKey),
        refresh_token: null,
        expires_at: null,
        connected_by_user_id: authedUser.id,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage jeton Capsule CRM:', dbError);
    return NextResponse.json({ error: 'Erreur serveur — réessayez.' }, { status: 500 });
  }

  await supabaseAdmin.from('companies').update({ crm_provider: 'capsulecrm' }).eq('id', authedUser.company_id);

  return NextResponse.json({ success: true });
}
