// app/api/checkout/route.ts
// POST -> crée une session de paiement Stripe (abonnement) pour une nouvelle société.
// Les infos de la société sont passées en "metadata" pour que le webhook Stripe
// puisse créer la société + le profil utilisateur une fois le paiement confirmé.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';
import { MODULE_CODES, ModuleCode, getModulePriceId } from '@/lib/subscription';

// Configurable via Vercel (STRIPE_PRICE_ID_AARON_PROSPECT) pour basculer test/live
// ou changer de tarif sans redéploiement de code — la valeur actuelle reste le
// fallback pour ne rien casser tant que la variable n'est pas définie.
const PRICE_ID_AARON_PROSPECT = process.env.STRIPE_PRICE_ID_AARON_PROSPECT || 'price_1U28xj7srPu7DrXAy07EdRs7';

// Choix des modules à l'inscription (demande d'Alex 2026-08-17) : l'onboarding
// ne propose plus uniquement Aaron Prospect — le futur patron choisit 1, 2 ou
// les 3 modules (Aaron Prospect/Opportunités/Clients) dès la création du
// compte, chacun devenant sa propre ligne d'abonnement Stripe (même
// architecture "un abonnement, plusieurs subscription items" que la bascule
// après-coup dans Préférences, voir lib/subscription.ts et
// app/api/subscription/modules/route.ts). Aaron Prospect garde son fallback
// de Price ID en dur (PRICE_ID_AARON_PROSPECT ci-dessus, comportement
// préexistant) ; Opportunités/Clients passent par getModulePriceId, qui
// renvoie null si la variable Vercel correspondante n'est pas configurée.
function priceIdFor(module: ModuleCode): string | null {
  return module === 'AP' ? PRICE_ID_AARON_PROSPECT : getModulePriceId(module);
}

// Marchés visés pour l'expansion internationale (voir statut projet) :
// Portugal, Espagne, France, Belgique, Pays-Bas, Allemagne, Italie, UK,
// Australie, USA. Stripe Checkout gère déjà nativement la TVA UE/UK, la GST
// australienne et la sales tax américaine via Stripe Tax (automatic_tax
// ci-dessous) — à condition que Stripe Tax soit activé et qu'un
// enregistrement fiscal (tax registration) existe pour chaque pays où on
// veut réellement collecter la taxe. Je ne crée PAS ces enregistrements
// depuis le code : c'est une décision fiscale/légale par pays qui doit
// rester entre les mains d'Alex (et de son comptable), pas quelque chose
// qu'Aaron décide unilatéralement même si l'API Stripe le permettrait
// techniquement (stripe.tax.registrations.create). Voir la note dans le
// statut projet pour la marche à suivre côté Dashboard Stripe.

// Correspondance locale interne (lib/i18n.js) -> code de langue Stripe
// Checkout (liste officielle Stripe, sous-ensemble pertinent ici). 'auto'
// : Stripe détecte la langue du navigateur si aucune valeur reconnue n'est
// fournie.
const STRIPE_LOCALE_MAP: Record<string, string> = {
  fr: 'fr', en: 'en', de: 'de', it: 'it', es: 'es', pt: 'pt', nl: 'nl',
};

export async function POST(request: NextRequest) {
  const { first_name, full_name, company_name, country, locale, modules } = await request.json();

  if (!first_name || !full_name || !company_name || !country) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  // Repli sur ['AP'] seul si le payload n'envoie rien de reconnu (ancien
  // frontend pas encore redéployé, ou appel externe) — comportement identique
  // à avant cette évolution.
  const selectedModules: ModuleCode[] = Array.isArray(modules)
    ? (modules.filter((m: string) => MODULE_CODES.includes(m as ModuleCode)) as ModuleCode[])
    : [];
  if (selectedModules.length === 0) selectedModules.push('AP');

  const lineItems: { price: string; quantity: number }[] = [];
  for (const mod of selectedModules) {
    const priceId = priceIdFor(mod);
    if (!priceId) {
      return NextResponse.json(
        { error: `Module ${mod} pas encore configuré côté serveur (Price ID Stripe manquant).` },
        { status: 501 }
      );
    }
    lineItems.push({ price: priceId, quantity: 1 });
  }

  // auth_user_id et email proviennent du token vérifié : sinon, quelqu'un pourrait
  // payer un abonnement en indiquant l'UUID Supabase Auth d'une autre personne dans
  // les metadata, et le webhook Stripe créerait alors un compte "patron" au nom de
  // cette victime sans son consentement (même faille que /api/auth/link).
  const identity = await getAuthedIdentity(request);
  if (!identity) return unauthorizedResponse();
  const { auth_user_id, email } = identity;

  const origin = request.nextUrl.origin;

try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
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
      locale: (STRIPE_LOCALE_MAP[locale] as any) || 'auto',
      success_url: `${origin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/onboarding`,
      metadata: {
        auth_user_id,
        email,
        first_name,
        full_name,
        company_name,
        country,
        // Modules choisis à l'inscription — lu par le webhook
        // (checkout.session.completed) pour activer les bons booléens
        // offer_ap_active/offer_as_active/offer_ac_active à la création de
        // la société. Même convention que purpose:'reactivate_subscription'
        // (app/api/subscription/modules/route.ts), qui utilise déjà un
        // champ metadata.modules en liste séparée par des virgules.
        modules: selectedModules.join(','),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Erreur création session Stripe:', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
