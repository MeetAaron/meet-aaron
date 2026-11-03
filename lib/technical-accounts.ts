// lib/technical-accounts.ts
//
// COMPTES TECHNIQUES (Alex, 03/11/2026, à propos du compte « CASA Audit ») :
// « je ne veux pas que ça reçoive d'emails ou soit considéré comme un client.
// Que cet audit disparaisse de tout, qu'il n'apparaisse nulle part. On ne le
// garde que pour l'année prochaine, quand il faudra refaire l'audit CASA. »
//
// La colonne companies.not_a_client existait déjà pour le fichier client
// (migration_pas_un_client_2026-11-02.sql). Elle prend ici son sens complet :
// une société marquée ainsi est un compte d'outillage, pas un utilisateur.
// Elle ne reçoit aucun email automatique, n'entre dans aucun fichier et ne
// déclenche aucune relance. Le compte reste intact et connectable — c'est
// tout l'intérêt : il doit resservir l'an prochain.
//
// Tolérant à l'absence de la colonne : sans elle on renvoie un ensemble vide,
// c'est-à-dire le comportement d'avant. Une migration en retard ne doit pas
// priver tout le monde de ses rapports.

import { supabaseAdmin } from './supabase-admin';

export async function technicalCompanyIds(): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('not_a_client', true);
    if (error) return new Set();
    return new Set(((data as any[]) || []).map((c) => c.id));
  } catch {
    return new Set();
  }
}

// Les utilisateurs de ces sociétés : c'est à ce niveau que se décide l'envoi
// de la plupart des emails automatiques (rapports de résultats, relances).
export async function technicalUserIds(): Promise<Set<string>> {
  const companyIds = await technicalCompanyIds();
  if (companyIds.size === 0) return new Set();
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .in('company_id', Array.from(companyIds));
    if (error) return new Set();
    return new Set(((data as any[]) || []).map((u) => u.id));
  } catch {
    return new Set();
  }
}
