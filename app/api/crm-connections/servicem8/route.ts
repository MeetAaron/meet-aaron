// app/api/crm-connections/servicem8/route.ts
// ServiceM8 (servicem8.com, Australie) — 7e CRM du chantier "pas à pas",
// 1er de la liste Australie (ServiceM8, puis Tradify). plancraft et ToolTime
// (Allemagne) ont été écartés juste avant faute d'API publique documentée
// (voir claude/statut, Lot 19) ; Capsule CRM (UK, Lot 20) livré juste avant
// celui-ci.
//
// Authentification par clé API statique ("Private App"), générée par
// l'utilisateur dans ServiceM8 (Settings -> API Keys) — ServiceM8 propose
// aussi un flux OAuth2 à redirection, mais réservé aux apps publiques
// enregistrées comme "Development Partner" sur developer.servicem8.com ; pour
// une intégration serveur-à-serveur sur un seul compte comme ici, la clé API
// statique est le mécanisme prévu par ServiceM8 lui-même (pas de client_id/
// secret à enregistrer, pas de redirection). En-tête `X-API-Key: <clé>`
// (différent de `Authorization: Bearer`/`Token` des CRM précédents — vérifié
// sur la doc officielle developer.servicem8.com/docs/authentication).
//
// Même architecture qu'Axonaut/Housecall Pro/Capsule CRM : ce endpoint
// remplace la paire app/api/auth/<provider>/route.ts + callback/route.ts des
// CRM OAuth — pas de redirection externe, juste une clé collée dans un
// formulaire (voir carte ServiceM8 dans app/app/connexions/page.jsx, réutilise
// le même composant générique ApiKeyCrmConnectionCard).
//
// POST -> valide la clé auprès de ServiceM8 (GET /api_1.0/company.json,
// limité à 1 résultat — sert de "whoami" : échoue en 401/403 si la clé est
// invalide, et ne dépend pas du contexte "Add-on SDK" propre à
// /addonsdk/whoami.json dont la doc ne confirme pas qu'il fonctionne pour une
// simple clé API "Private App" comme la nôtre) puis la stocke chiffrée dans
// crm_connections, réservé au patron (même garde que les connexions
// existantes).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { encryptToken } from '@/lib/encryption';

const SERVICEM8_BASE_URL = 'https://api.servicem8.com/api_1.0';

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

  // Validation : GET /company.json?$top=1 est un endpoint standard de la doc
  // ServiceM8 (liste des "Company" = clients), il échoue (401/403) si la clé
  // est invalide — même principe de validation que /me pour Axonaut et
  // /users/current pour Capsule CRM, mais en évitant l'ambiguïté du endpoint
  // /addonsdk/whoami.json (namespace propre aux Add-ons SDK, pas confirmé
  // fonctionnel pour une clé API "Private App" classique).
  let checkRes: Response;
  try {
    checkRes = await fetch(`${SERVICEM8_BASE_URL}/company.json?%24top=1`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    });
  } catch (err) {
    console.error('Erreur réseau validation clé ServiceM8:', err);
    return NextResponse.json({ error: 'Impossible de joindre ServiceM8 pour valider la clé — réessayez.' }, { status: 502 });
  }

  if (!checkRes.ok) {
    const message =
      checkRes.status === 401 || checkRes.status === 403
        ? 'Clé API ServiceM8 invalide — vérifiez la clé copiée depuis ServiceM8 (Settings -> API Keys).'
        : `Erreur ServiceM8 lors de la validation de la clé (HTTP ${checkRes.status}).`;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: dbError } = await supabaseAdmin
    .from('crm_connections')
    .upsert(
      {
        company_id: authedUser.company_id,
        provider: 'servicem8',
        portal_id: null,
        access_token: encryptToken(apiKey),
        refresh_token: null,
        expires_at: null,
        connected_by_user_id: authedUser.id,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' }
    );

  if (dbError) {
    console.error('Erreur stockage clé ServiceM8:', dbError);
    return NextResponse.json({ error: 'Erreur serveur — réessayez.' }, { status: 500 });
  }

  await supabaseAdmin.from('companies').update({ crm_provider: 'servicem8' }).eq('id', authedUser.company_id);

  return NextResponse.json({ success: true });
}
