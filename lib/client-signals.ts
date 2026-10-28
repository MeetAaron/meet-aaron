// lib/client-signals.ts
// NOTIFICATIONS DE PLATEFORMES DANS LA BOÎTE DU COMMERCIAL (28/10/2026).
//
// Deux chemins vers « client » manquaient (revue du 25/10, validée par Alex) :
//   - une signature faite sur DocuSign, Yousign, PandaDoc… dont l'email de
//     confirmation vient de la plateforme, pas du client ;
//   - un paiement reçu sur le Stripe, PayPal, GoCardless… du commercial, sans
//     qu'il ait branché de webhook (presque personne ne le fera).
// Ces emails arrivent pourtant dans la boîte que lit déjà Aaron. On les
// reconnaît à l'expéditeur et aux mots-clés, on retrouve le contact concerné
// (son email ou son nom dans le message), et on crée un signal « Client à
// confirmer » (lib/become-client.ts). RIEN ne bascule tout seul.

import { supabaseAdmin } from './supabase-admin';
import { flagClientSignal } from './become-client';
import { sendPushNotification } from './push';

const SIGNATURE_SENDERS = /@([a-z0-9.-]+\.)?(docusign\.(net|com)|yousign\.(com|app|fr)|youtrust\.(com|app|fr)|pandadoc\.com|hellosign\.com|dropboxsign\.com|signnow\.com|adobesign\.com|echosign\.com|signrequest\.com|universign\.com|oodrive[a-z-]*\.com)$/i;
const PAYMENT_SENDERS = /@([a-z0-9.-]+\.)?(stripe\.com|paypal\.(com|fr|co\.uk|com\.au)|gocardless\.com|shopify\.com|squareup\.com|sumup\.(com|fr|co\.uk)|mollie\.com|qonto\.(com|eu)|pennylane\.com|zoho\.com|quickbooks\.com|intuit\.com|xero\.com|wix\.com)$/i;

const SIGNATURE_WORDS = /(completed|has been signed|has signed|all parties|signed by|document.{0,20}sign|signé|signée|a signé|terminé|complété|unterzeichnet|firmado|firmato|assinado|ondertekend)/i;
const PAYMENT_WORDS = /(payment (received|succeeded|successful)|you.ve received|received a payment|paid you|a payé|paiement (reçu|réussi|accepté)|vous avez reçu|new order|nouvelle commande|order #|invoice .{0,20}paid|facture .{0,20}(payée|réglée)|zahlung erhalten|pago recibido|pagamento ricevuto)/i;

export type PlatformKind = 'signature_plateforme' | 'paiement';

export function classifyPlatformSender(fromEmail: string): PlatformKind | null {
  const e = String(fromEmail || '').toLowerCase();
  if (SIGNATURE_SENDERS.test(e)) return 'signature_plateforme';
  if (PAYMENT_SENDERS.test(e)) return 'paiement';
  return null;
}

// Appelé par le cron check-inbox pour un email dont l'expéditeur n'est pas
// un prospect. `loadBody` n'est appelé que si l'expéditeur est une plateforme
// connue : aucun téléchargement pour le reste du courrier.
export async function detectPlatformClientSignal(params: {
  userId: string;
  fromEmail: string;
  subject: string | null;
  messageId: string;
  loadBody: () => Promise<string | null>;
}): Promise<boolean> {
  const kind = classifyPlatformSender(params.fromEmail);
  if (!kind) return false;

  const subject = params.subject || '';
  let body = '';
  try {
    body = (await params.loadBody()) || '';
  } catch {
    body = '';
  }
  const text = `${subject}\n${body}`.slice(0, 20000);
  const words = kind === 'signature_plateforme' ? SIGNATURE_WORDS : PAYMENT_WORDS;
  if (!words.test(text)) return false;

  // Contacts du commercial pas encore clients : on cherche leur email, puis
  // leur nom complet, dans le message.
  const { data: candidates } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, is_lost')
    .eq('assigned_user_id', params.userId)
    .is('first_order_confirmed_at', null)
    .limit(2000);
  const lower = text.toLowerCase();
  let match: any = null;
  for (const p of (candidates || []) as any[]) {
    if (p.email && lower.includes(String(p.email).toLowerCase())) { match = p; break; }
  }
  if (!match) {
    for (const p of (candidates || []) as any[]) {
      const name = String(p.full_name || '').trim().toLowerCase();
      if (name.length >= 6 && lower.includes(name)) { match = p; break; }
    }
  }
  if (!match) return false;

  const platform = params.fromEmail.split('@')[1] || 'plateforme';
  const reason = kind === 'signature_plateforme'
    ? `Notification de signature reçue de ${platform} : « ${subject.slice(0, 120)} »`
    : `Notification de paiement reçue de ${platform} : « ${subject.slice(0, 120)} »`;
  const created = await flagClientSignal(match.id, { source: kind, reason, messageId: params.messageId });
  if (!created) return false;

  await sendPushNotification(params.userId, {
    title: kind === 'signature_plateforme' ? 'Signature détectée' : 'Paiement détecté',
    body: `${match.full_name} : ${reason}. Je le passe en client ? Confirme depuis ton tableau de bord.`,
    url: `/app/dashboard?user_id=${params.userId}`,
    tag: `client_signal:${match.id}`,
  }).catch(() => {});
  return true;
}
