// lib/quote-signature.ts
// « LE DEVIS EST SIGNÉ » — un seul endroit pour l'effet d'une signature, quel
// que soit le canal (23/10/2026, demande d'Alex : certains clients ne passent
// pas par Youtrust et renvoient le devis signé par email, en pièce jointe).
//
// Avant ce fichier, la logique vivait dans app/api/webhooks/youtrust/route.ts
// uniquement. Elle est déplacée ici telle quelle et appelée par :
//   - le webhook Youtrust (signature électronique) ;
//   - le cron check-inbox, quand Aaron lit un devis signé renvoyé en pièce
//     jointe (lib/quote-return.ts).
//
// Effet : affaire signée et gagnée (is_won, won_at, première commande
// confirmée), synchro CRM, passage de relais au commercial, notification,
// onboarding automatique. Strictement identique pour les deux canaux ; seuls
// la raison enregistrée et le texte de la notification changent.

import { supabaseAdmin } from './supabase-admin';
import { markProspectAsClient } from './become-client';
import { sendPushNotification } from './push';

export type QuoteSignatureSource = 'youtrust' | 'email';

export interface SignedQuoteProspect {
  id: string;
  full_name: string;
  assigned_user_id: string;
  company_id: string | null;
}

export async function markQuoteSigned(
  prospect: SignedQuoteProspect,
  source: QuoteSignatureSource,
  options: { reason?: string | null } = {}
): Promise<void> {
  const now = new Date().toISOString();
  const wonReason =
    options.reason ||
    (source === 'youtrust'
      ? 'Devis signé électroniquement via Youtrust.'
      : 'Devis signé renvoyé par email (pièce jointe lue par Aaron).');

  await supabaseAdmin
    .from('prospects')
    .update({ signature_status: 'signe', signature_completed_at: now })
    .eq('id', prospect.id);
  // Une seule fonction pour devenir client (28/10/2026, lib/become-client.ts).
  // notify:false : le push « Contrat signé » ci-dessous fait déjà l'annonce.
  await markProspectAsClient(prospect.id, {
    source: source === 'youtrust' ? 'youtrust' : 'devis_email',
    firstOrderConfirmed: true,
    reason: wonReason,
    notify: false,
  });

  // Docx pipeline (Alex, 2026-08-23), section I.7 : texte différent selon
  // que le commercial a déjà l'abonnement Aaron Clients.
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('offer_ac_active')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const how = source === 'email' ? 'a renvoyé le devis signé par email' : 'a signé le devis';
  await sendPushNotification(prospect.assigned_user_id, {
    title: 'Contrat signé 🎉',
    body: company?.offer_ac_active
      ? `${prospect.full_name} ${how}. Félicitations, nouveau client ! Tu peux désormais le suivre dans Aaron Clients, je m'occupe de son accueil.`
      : `${prospect.full_name} ${how}. Félicitations, nouveau client ! Je te passe la main : c'est toi qui suis la relation. Abonne-toi à Aaron Clients pour l'accueillir, le fidéliser, et vendre encore et encore.`,
    url: `/app/prospects?user_id=${prospect.assigned_user_id}&contact=${prospect.id}`,
  });

}
