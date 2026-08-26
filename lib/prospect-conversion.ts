// lib/prospect-conversion.ts
// Cas particulier "dogfooding" : meetaaron.app peut lui-même être le produit
// vendu par un commercial via Aaron Prospect (ex : Alex démarche un prospect
// pour qu'il devienne client de meetaaron.app). Contrairement à une vente
// classique, il n'y a pas de RDV/devis/signature manuelle à saisir : le
// signal de conversion, c'est l'inscription + le paiement Stripe eux-mêmes.
//
// Cette fonction est appelée depuis le webhook Stripe (checkout.session.completed,
// voir app/api/webhooks/stripe/route.ts) juste après la création réussie du
// nouveau compte. Elle cherche, dans TOUTE la base prospects (tous
// commerciaux/sociétés confondus — un prospect démarché par n'importe quel
// commercial peut être celui qui s'inscrit), un prospect pas encore
// gagné/perdu dont l'email correspond exactement (insensible à la casse) à
// l'email du nouveau compte Stripe. Si trouvé, le fait basculer en client
// gagné avec 1ère commande confirmée (le paiement Stripe EST la 1ère
// commande) et déclenche l'onboarding automatique standard (email de
// bienvenue + proposition de RDV de lancement + notification push au
// commercial) — exactement le même chemin que l'action manuelle
// "Confirmer la 1ère commande" (voir app/api/prospects/[id]/route.ts).
//
// Best-effort et non-bloquant par construction, comme le reste du webhook
// Stripe autour de la création de compte elle-même (qui reste l'action
// critique) : une erreur ici ne doit jamais faire échouer la création du
// compte du nouveau client.

import { supabaseAdmin } from './supabase-admin';
import { triggerAutomaticOnboarding } from './aaron-customer';

export async function convertMatchingProspectsToClients(signupEmail: string): Promise<void> {
  if (!signupEmail) return;

  try {
    const { data: matches, error } = await supabaseAdmin
      .from('prospects')
      .select('id, full_name, assigned_user_id')
      .ilike('email', signupEmail)
      .eq('is_won', false)
      .eq('is_lost', false);

    if (error) {
      console.error('Erreur recherche prospect correspondant à un nouvel inscrit meetaaron.app:', error.message);
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
        console.error(`Erreur passage en client du prospect ${prospect.id} (inscription meetaaron.app):`, updateError.message);
        continue;
      }

      console.log(
        `Prospect ${prospect.id} (${prospect.full_name || signupEmail}) marqué gagné automatiquement : ` +
        `inscription + paiement meetaaron.app détectés.`
      );

      // Fire-and-forget, comme partout ailleurs où cette fonction est
      // appelée : envoie l'email de bienvenue + proposition de RDV de
      // lancement + notification push au commercial assigné.
      triggerAutomaticOnboarding(prospect.id).catch((err) => {
        console.error(`Erreur onboarding automatique (inscription meetaaron.app) pour prospect ${prospect.id}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error('Erreur convertMatchingProspectsToClients:', err.message);
  }
}
