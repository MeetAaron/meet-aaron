// lib/prospect-conversion.ts
// Cas d'origine "dogfooding" : meetaaron.app peut lui-même être le produit
// vendu par un commercial via Aaron Prospect (ex : Alex démarche un prospect
// pour qu'il devienne client de meetaaron.app). Contrairement à une vente
// classique, il n'y a pas de RDV/devis/signature manuelle à saisir : le
// signal de conversion, c'est l'inscription + le paiement Stripe eux-mêmes.
//
// Généralisé le 26/08/2026 (demande Alex) : n'importe quel commercial qui
// utilise Aaron avec l'objectif "inscription/abonnement direct" (voir
// lib/aaron.ts, PROSPECTING_GOAL_LABELS.essai_gratuit) vend, lui aussi, un
// produit qui se souscrit tout seul (SON PROPRE abonnement, pas forcément
// via Stripe) — il a donc le même besoin qu'Alex : détecter automatiquement
// qu'UN DE SES PROSPECTS a payé/s'est inscrit, sans RDV ni bilan manuel.
// Voir app/api/webhooks/external-conversion/[secret]/route.ts : webhook
// générique, un par société (companies.external_conversion_webhook_secret),
// que le commercial branche sur SON propre Stripe/CRM/Zapier/Make. Cette
// fonction accepte maintenant un `companyId` optionnel pour scoper la
// recherche à une seule société — indispensable pour ce nouveau webhook
// externe (sécurité multi-tenant : la société A ne doit jamais pouvoir
// convertir un prospect de la société B), alors que l'appel historique
// depuis le webhook Stripe interne de meetaaron.app (juste en dessous)
// continue volontairement à chercher sur toute la base : n'importe quel
// commercial peut avoir démarché la personne qui s'inscrit à meetaaron.app.
//
// Appelée (1) depuis le webhook Stripe interne (checkout.session.completed,
// voir app/api/webhooks/stripe/route.ts) juste après la création réussie du
// nouveau compte meetaaron.app, sans companyId (recherche globale) ; (2)
// depuis le webhook externe générique, avec companyId (recherche scopée).
// Dans les deux cas : cherche un prospect pas encore gagné/perdu dont
// l'email correspond exactement (insensible à la casse) à l'email fourni.
// Si trouvé, le fait basculer en client gagné avec 1ère commande confirmée
// (le paiement EST la 1ère commande) et déclenche l'onboarding automatique
// standard (email de bienvenue + proposition de RDV de lancement +
// notification push au commercial) — exactement le même chemin que l'action
// manuelle "Confirmer la 1ère commande" (voir app/api/prospects/[id]/route.ts).
//
// Best-effort et non-bloquant par construction : une erreur ici ne doit
// jamais faire échouer l'appelant (création de compte Stripe interne, ou
// réponse HTTP du webhook externe).

import { supabaseAdmin } from './supabase-admin';
import { triggerAutomaticOnboarding } from './aaron-customer';

export async function convertMatchingProspectsToClients(
  signupEmail: string,
  companyId?: string
): Promise<void> {
  if (!signupEmail) return;

  try {
    let query = supabaseAdmin
      .from('prospects')
      .select('id, full_name, assigned_user_id')
      .ilike('email', signupEmail)
      .eq('is_won', false)
      .eq('is_lost', false);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data: matches, error } = await query;

    if (error) {
      console.error('Erreur recherche prospect correspondant à un nouvel inscrit:', error.message);
      return;
    }
    if (!matches || matches.length === 0) return;

    const now = new Date().toISOString();

    for (const prospect of matches) {
      const { error: updateError } = await supabaseAdmin
        .from('prospects')
        .update({
          is_won: true,
          won_at: now,
          is_lost: false,
          // Le paiement Stripe confirmé EST la 1ère commande — pas besoin
          // d'attendre une confirmation manuelle du commercial, voir
          // migration_first_order_confirmed_2026-08-14.sql.
          first_order_confirmed_at: now,
        })
        .eq('id', prospect.id);

      if (updateError) {
        console.error(`Erreur passage en client du prospect ${prospect.id} (conversion auto):`, updateError.message);
        continue;
      }

      console.log(
        `Prospect ${prospect.id} (${prospect.full_name || signupEmail}) marqué gagné automatiquement : ` +
        `inscription/paiement détecté${companyId ? ' (webhook externe société ' + companyId + ')' : ' (inscription meetaaron.app)'}.`
      );

      // Fire-and-forget, comme partout ailleurs où cette fonction est
      // appelée : envoie l'email de bienvenue + proposition de RDV de
      // lancement + notification push au commercial assigné.
      triggerAutomaticOnboarding(prospect.id).catch((err) => {
        console.error(`Erreur onboarding automatique (conversion auto) pour prospect ${prospect.id}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error('Erreur convertMatchingProspectsToClients:', err.message);
  }
}
