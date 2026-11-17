// lib/signup-checkout.ts
//
// SESSION DE PAIEMENT STRIPE D'UNE NOUVELLE SOCIÉTÉ (extrait de
// app/api/checkout/route.ts le 17/11/2026).
//
// Deux portes d'entrée l'utilisent désormais :
//   - /api/checkout : inscription sur le SITE, redirection immédiate vers
//     Stripe (inchangé) ;
//   - /api/checkout/resume : lien reçu PAR EMAIL après une inscription faite
//     DANS L'APPLICATION iPhone / Android. Apple (règle 3.1.1) et Google
//     (règlement Paiements) interdisent de vendre un abonnement dans l'app
//     ou d'y renvoyer vers un paiement externe ; un email envoyé hors de
//     l'app est en revanche permis. Voir app/api/checkout/email-link.
//
// Les commentaires d'origine (devises, taxes, métadonnées lues par le
// webhook) sont conservés ci-dessous.

import { stripe, managedPaymentsParams } from './stripe';
import { ModuleCode, getModulePriceId, getAaronYearlyPriceId, currencyForCountry } from './subscription';

export type SignupCheckoutInput = {
  auth_user_id: string;
  email: string;
  first_name: string;
  full_name: string;
  company_name: string;
  country: string;
  locale?: string | null;
  role?: string | null;
  billing_interval?: string | null;
  origin: string;
  // Chemin (avec paramètres) de retour après paiement / abandon.
  successPath?: string;
  cancelPath?: string;
};

export class SignupCheckoutError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function priceIdFor(module: ModuleCode): string | null {
  return getModulePriceId(module);
}

// Correspondance locale interne (lib/i18n.js) -> code de langue Stripe
// Checkout (liste officielle Stripe, sous-ensemble pertinent ici). 'auto'
// : Stripe détecte la langue du navigateur si aucune valeur reconnue n'est
// fournie.
const STRIPE_LOCALE_MAP: Record<string, string> = {
  fr: 'fr', en: 'en', de: 'de', it: 'it', es: 'es', pt: 'pt', nl: 'nl',
};

export async function createSignupCheckoutSession(input: SignupCheckoutInput): Promise<string> {
  const { auth_user_id, email, first_name, full_name, company_name, country, locale, role, billing_interval, origin } = input;
  if (!first_name || !full_name || !company_name || !country) {
    throw new SignupCheckoutError('Champs manquants', 400);
  }
  // Repli sur ['AP'] seul si le payload n'envoie rien de reconnu (ancien
  // frontend pas encore redéployé, ou appel externe) — comportement identique
  // à avant cette évolution.
  // Abonnement unique Aaron (décision Alex, 31/08/2026) : quel que soit le
  // choix envoyé par le frontend (ancienne sélection de modules), le
  // Checkout ne vend plus qu'UNE ligne — le prix Aaron à 30 €/mois (ex prix
  // "AP"). Le webhook active ensuite les 3 drapeaux de modules.
  const selectedModules: ModuleCode[] = ['AP'];

  // TARIF ANNUEL (06/11/2026) : billing_interval 'year' → le Price annuel.
  // S'il n'est pas configuré, on REFUSE (501) plutôt que de prélever un
  // mensuel à quelqu'un qui a choisi l'année — l'écran d'inscription ne
  // propose l'annuel que si NEXT_PUBLIC_YEARLY_PLAN vaut "1".
  const yearly = billing_interval === 'year';
  const lineItems: { price: string; quantity: number }[] = [];
  for (const mod of selectedModules) {
    const priceId = yearly ? getAaronYearlyPriceId() : priceIdFor(mod);
    if (!priceId) {
      throw new SignupCheckoutError(
        yearly ? "Tarif annuel pas encore configuré côté serveur (STRIPE_PRICE_ID_AARON_PROSPECT_YEARLY manquant)." : `Module ${mod} pas encore configuré côté serveur (Price ID Stripe manquant).`,
        501
      );
    }
    lineItems.push({ price: priceId, quantity: 1 });
  }

  const currency = currencyForCountry(country);
  const sessionParams: Record<string, any> = {
      mode: 'subscription',
      // Stripe vendeur officiel si Alex l'a activé (voir lib/stripe.ts).
      ...managedPaymentsParams(),
      customer_email: email,
      line_items: lineItems,
      allow_promotion_codes: true,
      // Adresse de facturation complète (rue, ville, code postal) requise pour
      // pouvoir générer une vraie facture — avant, seul le pays était demandé.
      billing_address_collection: 'required',
      // Calcule automatiquement la TVA/GST/sales tax selon le pays de
      // facturation renseigné par le client (UE, UK, Australie, USA...).
      // Nécessite Stripe Tax activé + un enregistrement fiscal pour le pays
      // concerné côté Dashboard Stripe (voir note ci-dessus) — sans ça,
      // Stripe ignore simplement ce paramètre et ne facture aucune taxe,
      // donc pas de risque de casser le paiement en attendant.
      automatic_tax: { enabled: true },
      // Permet à un client professionnel de renseigner son numéro de TVA
      // intracommunautaire (autoliquidation en B2B UE) directement dans le
      // Checkout, sur la facture générée automatiquement par Stripe.
      tax_id_collection: { enabled: true },
      // Langue du Checkout alignée sur la langue choisie dans l'app (voir
      // lib/i18n.js) quand elle est reconnue par Stripe, sinon détection
      // automatique du navigateur.
      locale: (STRIPE_LOCALE_MAP[String(locale || '')] as any) || 'auto',
      success_url: `${origin}${input.successPath || '/onboarding/success?session_id={CHECKOUT_SESSION_ID}'}`,
      cancel_url: `${origin}${input.cancelPath || '/onboarding'}`,
      metadata: {
        auth_user_id,
        email,
        first_name,
        full_name,
        company_name,
        country,
        billing_interval: yearly ? 'year' : 'month',
        // Modules choisis à l'inscription — lu par le webhook
        // (checkout.session.completed) pour activer les bons booléens
        // offer_ap_active/offer_as_active/offer_ac_active à la création de
        // la société. Même convention que purpose:'reactivate_subscription'
        // (app/api/subscription/modules/route.ts), qui utilise déjà un
        // champ metadata.modules en liste séparée par des virgules.
        modules: selectedModules.join(','),
        // 'patron' (fondateur/dirigeant, valeur par défaut) ou 'commercial'
        // (commercial solo qui paie lui-même — pas de code d'activation
        // entreprise). Lu par le webhook pour renseigner users.role au lieu
        // de forcer 'patron' pour tout le monde (demande Alex 25/08 : un
        // commercial solo payant seul ne doit pas hériter des permissions
        // "fondateur", ex. voir "Mon équipe" dans le menu).
        role: role === 'commercial' ? 'commercial' : 'patron',
      },
  };

    let session;
    try {
      // La devise est TOUJOURS passée, euro compris (06/11/2026) : le prix
      // annuel a été créé avec le dollar australien comme devise de base, et
      // sans `currency` Stripe facturerait un client français en AUD.
      session = await stripe.checkout.sessions.create({ ...sessionParams, currency });
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (/currenc/.test(msg)) {
        console.error(`Devise ${currency} non configurée sur le Price Stripe, repli EUR:`, err?.message);
        session = await stripe.checkout.sessions.create(sessionParams);
      } else {
        throw err;
      }
    }
    if (!session?.url) throw new SignupCheckoutError('Session Stripe sans adresse', 502);
    return session.url;
}
