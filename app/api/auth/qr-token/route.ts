// app/api/auth/qr-token/route.ts
// POST -> crée un jeton à usage unique (5 minutes) permettant de démarrer la
// connexion Google/Outlook depuis un autre appareil que celui qui affiche le
// QR code (demande Alex, 28/08/2026 : QR codes dans Connexions, à côté des
// boutons "Connecter", pour lancer l'autorisation directement depuis le
// téléphone du commercial). Voir migration_oauth_qr_tokens_2026-08-28.sql et
// lib/auth-helpers.ts (resolveAndConsumeQrToken) pour le pourquoi de cette
// table plutôt que d'exposer le token de session dans le QR.
//
// Comme pour toutes les routes protégées : le user_id lié au jeton est
// dérivé de la session vérifiée (getAuthedUser), jamais envoyé par le
// client — sinon n'importe qui aurait pu générer un QR qui lierait sa
// propre boîte mail au compte Meet Aaron d'un tiers.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';

const TTL_MS = 5 * 60 * 1000; // 5 minutes — largement suffisant pour scanner + autoriser

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { provider } = await request.json();
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.json({ error: 'provider invalide' }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from('oauth_qr_tokens')
    .insert({ user_id: authedUser.id, provider, expires_at: expiresAt })
    .select('token, expires_at')
    .single();

  if (error || !data) {
    console.error('Erreur création jeton QR OAuth:', error?.message);
    return NextResponse.json({ error: 'Impossible de générer le QR code' }, { status: 500 });
  }

  return NextResponse.json({ token: data.token, expiresAt: data.expires_at });
}
