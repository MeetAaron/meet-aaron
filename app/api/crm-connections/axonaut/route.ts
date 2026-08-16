// app/api/crm-connections/axonaut/route.ts
// Axonaut n'a PAS de flux OAuth centralisé (contrairement à HubSpot/Salesforce/
// Pipedrive) : l'authentification se fait par une clé API statique, une par
// compte Axonaut, que le patron trouve lui-même dans Axonaut (icône clé à
// molette -> API -> "afficher votre clé API"). Ce endpoint remplace donc le
// couple app/api/auth/<provider>/route.ts + callback/route.ts des CRM OAuth :
// pas de redirection externe, juste une clé collée dans un formulaire (voir
// carte Axonaut dans app/app/connexions/page.jsx).
//
// POST -> valide la clé auprès d'Axonaut (GET /api/v2/me) puis la stocke
// chiffrée dans crm_connections, réservé au patron (même garde que les
// connexions OAuth existantes).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { encryptToken } from '@/lib/encryption';

const AXONAUT_BASE_URL = 'https://axonaut.com/api/v2';

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
    return NextResponse.json({ error: 'Clé API manquante.' }, { status: 400 });
  }

  // Validation : GET /me est le endpoint "qui suis-je" d'Axonaut, il échoue
  // (401/403) si la clé est invalide — même principe que l'introspection de
  // token utilisée pour HubSpot dans app/api/auth/hubspot/callback/route.ts.
  let meRes: Response;
  try {
    meRes = await fetch(`${AXONAUT_BASE_URL}/me`, {
      headers: { userApiKey: apiKey, Accept: 'application/json' },
    });
  } catch (err) {
    console.error('Erreur réseau validation clé API Axonaut:', err);
    return NextResponse.json({ error: "Impossible de joindre Axonaut pour valider la clé — réessayez." }, { status: 502 });
  }

  if (!meRes.ok) {
    const message =
      meRes.status === 401 || meRes.status === 403
        ? 'Clé API Axonaut invalide — vérifiez la clé copiée depuis Axonaut (icône clé à molette -> API).'
        : `Erreur Axonaut lors de la validation de la clé (HTTP ${meRes.status}).`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Libellé informatif seulement (affiché comme "compte connecté" dans
  // Connexions, même rôle que hubId pour HubSpot) — best-effort, la forme
  // exacte de la réponse /me n'est pas garantie donc on ne bloque jamais
  // dessus.
  let accountLabel: string | null = null;
  try {
    const me = await meRes.json();
    accountLabel = me?.name || me?.company_name || me?.email || null;
  } catch (err) {
    console.error('Réponse /me Axonaut non-JSON (non bloquant):', err);
  }

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: authedUser.company_id,
        provider: 'axonaut',
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
    console.error('Erreur stockage clé API Axonaut:', dbError);
    return NextResponse.json({ error: 'Erreur serveur — réessayez.' }, { status: 500 });
  }

  // Garde companies.crm_provider synchronisé avec la vraie connexion, même
  // logique que app/api/auth/hubspot/callback/route.ts.
  await supabaseAdmin.from('companies').update({ crm_provider: 'axonaut' }).eq('id', authedUser.company_id);

  return NextResponse.json({ success: true });
}
