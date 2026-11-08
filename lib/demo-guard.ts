// lib/demo-guard.ts
// Compte de DÉMONSTRATION (société « Démo Meet Aaron », companies.is_demo) :
// partagé avec les testeurs Google Play, la revue Apple, les captures
// d'écran. Décision Alex (08/11/2026) : « ils ne vont pas lancer une
// campagne j'espère, ça va me coûter un bras ». Donc, sur une société démo,
// tout ce qui coûte ou qui casse est désactivé : campagnes (création,
// relance, exécution par le cron), ajout et import de prospects, envoi de
// devis, modification du profil entreprise par le chat, suppression du
// compte. Le reste (lire, naviguer, discuter avec Aaron sous plafond API)
// reste ouvert : c'est ce qui fait la démo.
//
// migration_demo_company_2026-11-08.sql ajoute la colonne ; sans elle,
// personne n'est démo (lecture tolérante).

import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase-admin';

const cache = new Map<string, { demo: boolean; at: number }>();
const TTL_MS = 60 * 1000;

export async function isDemoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.demo;
  try {
    const { data, error } = await supabaseAdmin.from('companies').select('is_demo').eq('id', companyId).maybeSingle();
    const demo = !error && (data as any)?.is_demo === true;
    cache.set(companyId, { demo, at: Date.now() });
    return demo;
  } catch {
    return false;
  }
}

export async function isDemoUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).maybeSingle();
    return isDemoCompany((data as any)?.company_id);
  } catch {
    return false;
  }
}

export const DEMO_BLOCKED_MESSAGE: Record<string, string> = {
  fr: 'Compte de démonstration : cette action est désactivée. Créez votre propre compte pour l’utiliser.',
  en: 'Demo account: this action is disabled. Create your own account to use it.',
  de: 'Demokonto: Diese Aktion ist deaktiviert. Erstellen Sie ein eigenes Konto, um sie zu nutzen.',
  it: 'Account demo: questa azione è disattivata. Crea il tuo account per usarla.',
  es: 'Cuenta de demostración: esta acción está desactivada. Crea tu propia cuenta para usarla.',
  pt: 'Conta de demonstração: esta ação está desativada. Cria a tua própria conta para a usar.',
  nl: 'Demo-account: deze actie is uitgeschakeld. Maak je eigen account aan om ze te gebruiken.',
};

export function demoBlockedResponse(locale?: string | null) {
  const key = String(locale || 'fr').slice(0, 2).toLowerCase();
  return NextResponse.json({ error: DEMO_BLOCKED_MESSAGE[key] || DEMO_BLOCKED_MESSAGE.fr, demo: true }, { status: 403 });
}
