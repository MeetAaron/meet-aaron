// lib/signature-locale.ts
//
// QUELLE SIGNATURE COLLER EN BAS D'UN EMAIL, SELON LA LANGUE DU DESTINATAIRE.
//
// Le trou etait la (A_FAIRE.docx, 26/09/2026) : depuis lib/prospect-locale.ts,
// Aaron redige deja le premier email dans la langue du prospect — anglais
// pour une entreprise australienne, allemand pour une entreprise autrichienne,
// et ainsi de suite. La signature, elle, restait celle d'une seule langue.
// Un email anglais se terminait donc par « Cordialement, / Directeur
// commercial / Port. : 06 ... », ce qui annule une bonne partie du soin mis
// dans le corps du message.
//
// Principe : users.email_signature reste LA signature par defaut (comportement
// inchange pour tout compte qui ne renseigne rien). users.email_signature_by_locale
// est un simple objet { langue: texte } qui la remplace quand la langue du
// destinataire y figure. Une langue absente, une valeur vide, une colonne pas
// encore migree : on retombe sur la signature par defaut. Jamais d'email sans
// signature parce qu'une traduction manquait.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveProspectLocale } from '@/lib/prospect-locale';

export const SIGNATURE_LOCALES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl'] as const;

// Meme plafond que capSignature dans lib/messaging.ts : une signature n'est
// pas un corps de message, et une signature geante est la premiere cause du
// « [Message tronque] » de Gmail.
const MAX_SIGNATURE_CHARS = 1500;

// Nettoie ce qui arrive de l'UI avant de l'ecrire en base : on ne garde que
// les langues supportees, on coupe les valeurs trop longues, et on supprime
// les entrees vides (une langue vidée = retour au repli, pas une signature
// vide dans les emails).
export function normalizeSignatureMap(input: any): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const locale of SIGNATURE_LOCALES) {
    const raw = (input as any)[locale];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_SIGNATURE_CHARS);
    if (value) out[locale] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Choix effectif. `byLocale` peut arriver en objet (jsonb) ou en chaine JSON
// selon le client Postgrest — les deux sont acceptes.
export function pickSignature(
  defaultSignature: string | null | undefined,
  byLocale: any,
  locale: string | null | undefined
): string {
  const fallback = (defaultSignature || '').trim();
  const key = String(locale || '').trim().toLowerCase();
  if (!key) return fallback;

  let map: any = byLocale;
  if (typeof map === 'string') {
    try { map = JSON.parse(map); } catch { map = null; }
  }
  if (!map || typeof map !== 'object') return fallback;

  const candidate = map[key];
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return fallback;
}

// Langue probable du DESTINATAIRE d'un envoi, a partir de sa seule adresse
// email — le seul element dont dispose sendEmailForUser.
//
// On reprend exactement les signaux de lib/prospect-locale.ts (pays de
// l'adresse de sa societe, extension de son domaine, langue cible de la
// campagne d'origine, puis langue du commercial), pour que la signature parle
// forcement la meme langue que le corps du message : les deux sortent du meme
// calcul, jamais de deux heuristiques concurrentes.
//
// Toute erreur (colonne absente, prospect inconnu, email interne) retombe sur
// la langue du commercial : aucun envoi ne doit echouer a cause de la
// signature.
export async function recipientLocaleForSignature(
  userId: string,
  to: string,
  sellerLocale: string | null | undefined
): Promise<string> {
  const fallback = resolveProspectLocale({ email: to, sellerLocale });
  try {
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('email, prospect_companies(address, found_by_campaign_id)')
      .eq('assigned_user_id', userId)
      .ilike('email', to)
      .limit(1)
      .maybeSingle();

    if (!prospect) return fallback;

    const company: any = (prospect as any).prospect_companies || null;
    let campaignLocale: string | null = null;
    if (company?.found_by_campaign_id) {
      const { data: campaign } = await supabaseAdmin
        .from('prospecting_campaigns')
        .select('target_locale')
        .eq('id', company.found_by_campaign_id)
        .maybeSingle();
      campaignLocale = (campaign as any)?.target_locale || null;
    }

    return resolveProspectLocale({
      campaignLocale,
      address: company?.address || null,
      email: (prospect as any).email || to,
      sellerLocale,
    });
  } catch {
    return fallback;
  }
}
