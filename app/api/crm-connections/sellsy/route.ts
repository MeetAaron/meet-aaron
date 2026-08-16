// app/api/crm-connections/sellsy/route.ts
// Sellsy utilise OAuth2 "client credentials" (voir lib/crm-sync.ts pour le
// détail complet) : pas de redirection externe comme HubSpot/Salesforce/
// Pipedrive, mais deux valeurs (client_id + client_secret, créées dans Sellsy
// via Réglages -> Developer Portal -> API V2 -> "Créer un accès API") au lieu
// de la clé unique d'Axonaut. Ce endpoint valide les deux valeurs en
// échangeant réellement un jeton auprès de Sellsy (l'échange échoue lui-même
// si les identifiants sont invalides — pas besoin d'un endpoint "whoami"
// séparé), puis les stocke chiffrées séparément (client_id dans access_token,
// client_secret dans refresh_token — réutilisation des colonnes existantes,
// aucun jeton mis en cache ici).
//
// POST -> { client_id, client_secret } -> valide puis stocke, réservé au patron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { encryptToken } from '@/lib/encryption';

const SELLSY_TOKEN_URL = 'https://login.sellsy.com/oauth2/access-tokens';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') {
    return forbiddenResponse();
  }
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte.' }, { status: 400 });
  }

  let clientId: string | null = null;
  let clientSecret: string | null = null;
  try {
    const body = await request.json();
    clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : null;
    clientSecret = typeof body?.client_secret === 'string' ? body.client_secret.trim() : null;
  } catch {
    // corps absent/invalide -> traité comme identifiants manquants ci-dessous
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Client ID et Client Secret requis.' }, { status: 400 });
  }

  // Validation : l'échange OAuth2 client_credentials lui-même échoue avec des
  // identifiants invalides — pas d'appel séparé nécessaire, même principe que
  // la validation de token pour les CRM OAuth existants.
  let tokenRes: Response;
  try {
    tokenRes = await fetch(SELLSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    console.error('Erreur réseau validation identifiants Sellsy:', err);
    return NextResponse.json({ error: "Impossible de joindre Sellsy pour valider les identifiants — réessayez." }, { status: 502 });
  }

  if (!tokenRes.ok) {
    const message =
      tokenRes.status === 400 || tokenRes.status === 401
        ? 'Client ID ou Client Secret Sellsy invalide — vérifiez les valeurs copiées depuis le Developer Portal Sellsy.'
        : `Erreur Sellsy lors de la validation des identifiants (HTTP ${tokenRes.status}).`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: authedUser.company_id,
        provider: 'sellsy',
        portal_id: null,
        access_token: encryptToken(clientId),
        refresh_token: encryptToken(clientSecret),
        expires_at: null,
        connected_by_user_id: authedUser.id,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage identifiants Sellsy:', dbError);
    return NextResponse.json({ error: 'Erreur serveur — réessayez.' }, { status: 500 });
  }

  // Garde companies.crm_provider synchronisé avec la vraie connexion, même
  // logique que les autres routes de connexion CRM.
  await supabaseAdmin.from('companies').update({ crm_provider: 'sellsy' }).eq('id', authedUser.company_id);

  return NextResponse.json({ success: true });
}
