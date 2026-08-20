// lib/client-invoices.ts
// Facturation client (tâche #141 sous-item 2). Voir migration_invoicing_2026-08-20.sql.
//
// Couvre deux besoins distincts identifiés avec Alex :
// 1. Émettre de vraies factures pour un entrepreneur qui n'a pas d'outil de
//    facturation (ou dont le CRM connecté n'en a pas nativement —
//    Salesforce/Pipedrive/Capsule CRM, voir lib/crm-sync.ts).
// 2. Détecter automatiquement les retards de paiement sur ces factures
//    (app/api/cron/invoice-late-payments).
//
// Volontairement centré sur les mentions obligatoires courantes en France
// (numérotation séquentielle sans trou, identité vendeur/acheteur, mention
// pénalités de retard) — PAS une garantie de conformité fiscale/légale pour
// tout pays ou tout statut d'entreprise. À faire valider par l'expert-
// comptable d'Alex avant un usage à grande échelle, comme déjà recommandé
// pour la recherche sur la facturation électronique (tâche #133).

import { supabaseAdmin } from './supabase-admin';
import { DevisLineItem } from './aaron-sales';

export interface InvoiceLineItem {
  designation: string;
  description: string | null;
  quantite: number;
  prix_unitaire_ht_eur: number;
  total_ligne_ht_eur: number;
}

export interface InvoiceTotals {
  total_ht_eur: number;
  total_ttc_eur: number;
}

// Mention légale standard française pour les pénalités de retard en B2B
// (article L441-10 du Code de commerce) — obligatoire sur toute facture
// française entre professionnels, qu'elle soit appliquée ou non.
export const DEFAULT_PAYMENT_TERMS_FR =
  "Paiement à réception de facture, sauf conditions particulières convenues avec le client. " +
  "Tout retard de paiement entraîne l'exigibilité d'une indemnité forfaitaire pour frais de recouvrement de 40 € " +
  "(article L441-10 du Code de commerce), ainsi que des pénalités de retard au taux d'intérêt légal en vigueur, " +
  "sans qu'un rappel soit nécessaire.";

// Convertit les postes d'un devis déjà accepté (prospects.devis_recap, voir
// lib/aaron-sales.ts) en lignes de facture prêtes à l'emploi — évite de
// ressaisir ce qui a déjà été chiffré et validé par le client. Les postes
// sans prix (a_des_postes_sans_prix) sont ignorés : on ne facture jamais un
// montant qu'on ne connaît pas.
export function lineItemsFromDevisRecap(recap: DevisLineItem[]): InvoiceLineItem[] {
  return recap
    .filter((r) => r.total_ligne_eur !== null && r.total_ligne_eur !== undefined && r.prix_unitaire_eur !== null)
    .map((r) => ({
      designation: r.poste,
      description: r.description || null,
      quantite: r.quantite,
      prix_unitaire_ht_eur: r.prix_unitaire_eur as number,
      total_ligne_ht_eur: r.total_ligne_eur as number,
    }));
}

export function computeInvoiceTotals(lineItems: InvoiceLineItem[], vatRate: number | null): InvoiceTotals {
  const total_ht_eur = Math.round(lineItems.reduce((sum, l) => sum + (l.total_ligne_ht_eur || 0), 0) * 100) / 100;
  const total_ttc_eur = Math.round(total_ht_eur * (1 + (vatRate || 0)) * 100) / 100;
  return { total_ht_eur, total_ttc_eur };
}

// Attribution atomique du prochain numéro de facture pour une entreprise.
// Format "AAAA-NNNN" (ex. "2026-0001"), jamais réutilisé — y compris pour
// une facture annulée juste après, afin de respecter l'obligation de
// numérotation séquentielle sans trou. Le compteur (companies.invoice_next_number)
// n'est JAMAIS remis à zéro par année : le préfixe année est purement
// d'affichage, l'unicité réelle vient du compteur continu.
export async function getNextInvoiceNumber(companyId: string): Promise<string> {
  // Boucle de ré-essai (compare-and-swap applicatif, faute de vraie
  // transaction atomique côté client Supabase) : deux commerciaux de la même
  // entreprise pourraient en théorie créer une facture au même instant — la
  // clause .eq('invoice_next_number', attributed) fait qu'un seul des deux
  // UPDATE concurrents matche réellement une ligne, l'autre ré-essaie avec la
  // valeur fraîche. Rare en pratique, mais une numérotation en double serait
  // un vrai problème de conformité (facture non unique).
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: company, error } = await supabaseAdmin
      .from('companies')
      .select('invoice_next_number')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      throw new Error("Entreprise introuvable pour l'attribution du numéro de facture.");
    }

    const attributed = company.invoice_next_number || 1;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('companies')
      .update({ invoice_next_number: attributed + 1 })
      .eq('id', companyId)
      .eq('invoice_next_number', attributed) // garde optimiste anti double-attribution en cas d'appels concurrents
      .select('id');

    if (updateError) {
      throw new Error("Erreur lors de l'attribution du numéro de facture.");
    }

    if (updated && updated.length > 0) {
      const year = new Date().getFullYear();
      return `${year}-${String(attributed).padStart(4, '0')}`;
    }
    // Aucune ligne mise à jour : un autre appel a pris ce numéro entre le
    // SELECT et l'UPDATE — on relit la valeur fraîche et on retente.
  }

  throw new Error("Impossible d'attribuer un numéro de facture après plusieurs tentatives (forte concurrence) — réessayez.");
}
