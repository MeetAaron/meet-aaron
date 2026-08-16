// app/api/crm-connections/housecallpro/route.ts
// Housecall Pro n'a PAS de flux OAuth accessible pour ce type d'intégration
// (l'OAuth2 documenté vise les apps publiques du marketplace Housecall Pro,
// un processus de partenariat séparé) — l'authentification se fait par une
// clé API statique, une par compte, générée par un administrateur dans
// Housecall Pro (Mon compte -> "My Apps" -> "All Apps" -> "API Key
// Management" -> "Generate API Key"). Même architecture qu'Axonaut : ce
// endpoint remplace le couple app/api/auth/<provider>/route.ts + callback/
// route.ts des CRM OAuth — pas de redirection externe, juste une clé collée
// dans un formulaire (voir carte Housecall Pro dans app/app/connexions/
// page.jsx, réutilise le même composant ApiKeyCrmConnectionCard qu'Axonaut).
//
// POST -> valide la clé auprès de Housecall Pro (GET /company) puis la
// stocke chiffrée dans crm_connections, réservé au patron (même garde que
// les connexions existantes).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { encryptToken } from '@/lib/encryption';

const HOUSECALLPRO_BASE_URL = 'https://api.housecallpro.com';

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

  // Validation : GET /company est l'endpoint "informations sur la société"
  // de Housecall Pro, il échoue (401/403) si la clé est invalide — même
  // principe de validation que /me pour Axonaut.
  let companyRes: Response;
  try {
    companyRes = await fetch(`${HOUSECALLPRO_BASE_URL}/company`, {
      headers: { Authorization: `Token ${apiKey}`, Accept: 'application/json' },
    });
  } catch (err) {
    console.error('Erreur réseau validation clé API Housecall Pro:', err);
    return NextResponse.json({ error: 'Impossible de joindre Housecall Pro pour valider la clé — réessayez.' }, { status: 502 });
  }

  if (!companyRes.ok) {
    const message =
      companyRes.status === 401 || companyRes.status === 403
        ? 'Clé API Housecall Pro invalide — vérifiez la clé copiée depuis Housecall Pro (My Apps -> API Key Management).'
        : `Erreur Housecall Pro lors de la validation de la clé (HTTP ${companyRes.status}).`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Libellé informatif seulement (affiché comme "compte connecté" dans
  // Connexions) — best-effort, la forme exacte de la réponse /company n'est
  // pas garantie donc on ne bloque jamais dessus.
  let accountLabel: string | null = null;
  try {
    const company = await companyRes.json();
    accountLabel = company?.name || company?.company_name || company?.email || null;
  } catch (err) {
    console.error('Réponse /company Housecall Pro non-JSON (non bloquant):', err);
  }

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: authedUser.company_id,
        provider: 'housecallpro',
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
    console.error('Erreur stockage clé API Housecall Pro:', dbError);
    return NextResponse.json({ error: 'Erreur serveur — réessayez.' }, { status: 500 });
  }

  // Garde companies.crm_provider synchronisé avec la vraie connexion, même
  // logique que pour Axonaut/Sellsy.
  await supabaseAdmin.from('companies').update({ crm_provider: 'housecallpro' }).eq('id', authedUser.company_id);

  return NextResponse.json({ success: true });
}
