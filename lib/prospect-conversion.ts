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
import { markProspectAsClient } from './become-client';

// Renvoie le NOMBRE de prospects effectivement bascules en client
// (30/09/2026). L'appelant en a besoin : le webhook Stripe cree une fiche
// client « inscription directe » quand ce nombre vaut zero — voir
// lib/self-signup-client.ts. Renvoyait void jusqu'ici.
// `paid` (Alex, 30/10/2026) : le payload a-t-il PROUVÉ un paiement ?
//
// Jusqu'ici la réponse était « oui » dans tous les cas, et c'était faux pour
// la moitié des usages. Un prospect qui ouvre un essai gratuit ou crée un
// compte gratuit n'est pas un client : le basculer en client avec première
// commande confirmée déclenchait l'accueil automatique, le passage de relais,
// la synchro CRM, et le faisait compter dans le chiffre d'affaires de la page
// Marge — un euro affiché que personne n'avait encaissé.
//
// Où va-t-il alors ? En OPPORTUNITÉ, au stade le plus avancé
// (`en_negociation`, catégorie opportunité — voir lib/pipeline.ts). C'est la
// place juste : quelqu'un qui vient d'ouvrir un essai est l'affaire la plus
// chaude du fichier, mais ce n'est pas une vente. Aaron cesse de le démarcher
// à froid et le suit comme une affaire en cours, ce qui est exactement ce
// qu'il faut faire d'un essai en cours. Le jour où le paiement arrive, le
// même webhook repasse avec la preuve et le promeut client.
//
// Jamais de recul : un prospect déjà plus avancé (ou déjà client) n'est pas
// ramené en arrière par une inscription tardive.
export async function convertMatchingProspectsToClients(
  signupEmail: string,
  companyId?: string,
  options: { paid?: boolean } = {}
): Promise<number> {
  if (!signupEmail) return 0;

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
      return 0;
    }
    if (!matches || matches.length === 0) return 0;

    let converted = 0;

    const paid = options.paid !== false; // défaut historique : appel interne Stripe = paiement réel

    for (const prospect of matches) {
      if (paid) {
        // Le paiement confirmé EST la 1ère commande. Une seule fonction pour
        // devenir client (28/10/2026, lib/become-client.ts) : colonnes,
        // accueil automatique, passage de relais, CRM.
        const result = await markProspectAsClient(prospect.id, { source: 'paiement', firstOrderConfirmed: true });
        if (!result.ok) {
          console.error(`Erreur passage en client du prospect ${prospect.id} (conversion auto)`);
          continue;
        }
        console.log(
          `Prospect ${prospect.id} (${prospect.full_name || signupEmail}) marqué CLIENT automatiquement : ` +
          `paiement prouvé${companyId ? ' (webhook externe société ' + companyId + ')' : ' (inscription meetaaron.app)'}.`
        );
        converted += 1;
        continue;
      }

      // Inscription sans preuve de paiement : opportunité, pas client.
      const now = new Date().toISOString();
      const update: Record<string, any> = {
        status: 'bleu',
        status_updated_at: now,
        deal_stage: 'en_negociation',
        deal_stage_updated_at: now,
      };
      const { error: stageError } = await supabaseAdmin
        .from('prospects')
        .update(update)
        .eq('id', prospect.id)
        // Jamais de recul : on ne touche qu'aux fiches moins avancées.
        .not('deal_stage', 'in', '("en_negociation","signe","perdu")');
      if (stageError) {
        console.error(
          `Erreur passage en opportunité du prospect ${prospect.id} (inscription sans paiement, ${stageError.code || '?'}) : ${stageError.message}`
        );
        continue;
      }
      console.log(
        `Prospect ${prospect.id} (${prospect.full_name || signupEmail}) passé en OPPORTUNITÉ : ` +
        `inscription détectée sans preuve de paiement${companyId ? ' (webhook externe société ' + companyId + ')' : ''}.`
      );
      converted += 1;
    }
    return converted;
  } catch (err: any) {
    console.error('Erreur convertMatchingProspectsToClients:', err.message);
    return 0;
  }
}
