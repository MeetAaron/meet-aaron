// lib/business-summary-store.ts
// Logique partagée d'écriture de companies.business_summary — utilisée par
// app/api/business-summary/route.ts (régénération POST, correction manuelle
// PATCH) et app/api/business-summary/versions/route.ts (réactivation d'une
// ancienne version). Centralisée ici pour que TOUT remplacement complet du
// profil passe par le même filet de sécurité : avant d'écraser, l'ancienne
// valeur est copiée dans business_summary_versions (historique des 5
// dernières versions, voir migration_business_summary_versions_2026-08-29.sql).
//
// Remplace l'ancien mécanisme à un seul emplacement (colonnes
// companies.business_summary_backup / business_summary_backup_at, ajoutées le
// 29/08/2026 — voir migration_business_summary_backup_2026-08-29.sql) : Alex a
// demandé le même jour de garder les 5 derniers profils plutôt que juste le
// précédent, pour se protéger d'une "gaffe" (ex: cliquer sur "Relancer le
// questionnaire de découverte" par erreur et écraser un profil qu'il voulait
// garder). Les anciennes colonnes restent en base (données déjà migrées vers
// la nouvelle table par le script SQL) mais ne sont plus écrites.
import { supabaseAdmin } from '@/lib/supabase-admin';

const MAX_VERSIONS_KEPT = 5;

// Best-effort : purge les versions au-delà des 5 plus récentes pour une
// société. N'échoue jamais bruyamment — une purge ratée laisse juste une
// version en trop en base, sans conséquence pour l'utilisateur.
async function pruneOldVersions(companyId: string) {
  try {
    const { data: rows } = await supabaseAdmin
      .from('business_summary_versions')
      .select('id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (!rows || rows.length <= MAX_VERSIONS_KEPT) return;
    const idsToDelete = rows.slice(MAX_VERSIONS_KEPT).map((r) => r.id);
    await supabaseAdmin.from('business_summary_versions').delete().in('id', idsToDelete);
  } catch (err) {
    console.error('Purge historique profil entreprise échouée (non bloquant):', err);
  }
}

// Remplace entièrement companies.business_summary par newSummary, en
// sauvegardant d'abord l'ancienne valeur (si non vide) dans l'historique.
export async function backupThenReplaceBusinessSummary(companyId: string, newSummary: string) {
  const { data: current } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', companyId)
    .maybeSingle();

  if (current?.business_summary) {
    await supabaseAdmin.from('business_summary_versions').insert({
      company_id: companyId,
      summary: current.business_summary,
    });
    await pruneOldVersions(companyId);
  }

  return supabaseAdmin.from('companies').update({ business_summary: newSummary }).eq('id', companyId);
}
