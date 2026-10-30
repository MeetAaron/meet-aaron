// app/api/admin/registry-shadow/route.ts
//
// COMPARAISON À BLANC : le registre public contre la recherche web.
//
// Demande Alex (30/10/2026). On ne bascule pas le sourcing sur le registre
// sur la foi d'un raisonnement : on fait tourner les deux sur LA MÊME zone et
// LE MÊME secteur, et on regarde les listes côte à côte. Cette route ne
// touche à rien — elle lit, elle compare, elle renvoie. lib/sourcing.ts est
// inchangé et la production ne voit aucune différence.
//
// Ce qu'on cherche à savoir, en trois chiffres :
//   - combien de sociétés les deux méthodes trouvent en commun ;
//   - combien le registre ramène que la recherche web avait ratées ;
//   - combien le registre ramène de hors-sujet (la pile « non » du tri).
//
// RÉSERVÉE AU COMPTE FONDATEUR, comme app/api/admin/margin : la route expose
// le ciblage d'une campagne et déclenche des appels payants.
//
// Coût d'un passage : un petit appel Sonnet pour traduire le ciblage en codes
// d'activité et départements, zéro pour l'interrogation du registre, et un
// appel Haiku groupé pour le tri. Quelques centimes au total, quel que soit
// le nombre de sociétés trouvées.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { isFounderEmail } from '@/lib/founder';
import { serverError } from '@/lib/http';
import {
  planSireneCriteria,
  discoverFrenchCompanies,
  classifyCandidates,
  type CandidatePile,
} from '@/lib/registry-sirene';

// Deux noms de société ne se comparent jamais caractère par caractère :
// « SARL LE PETIT GOURMET » et « Le Petit Gourmet » sont la même entreprise.
function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(sarl|sas|sasu|eurl|sa|sci|snc|earl|scop|société|societe|entreprise)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!isFounderEmail(authedUser.email)) return forbiddenResponse();

  const campaignId = request.nextUrl.searchParams.get('campaign_id');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id manquant' }, { status: 400 });
  }
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 300), 1000);

  const { data: campaign, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('id, company_id, zone_label, sector_keywords, company_sizes, target_count')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) return serverError(error, '/api/admin/registry-shadow');
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const sectorKeywords: string[] = campaign.sector_keywords || [];
  const zoneLabel: string = campaign.zone_label || '';

  // 1. Ce que la recherche web a déjà trouvé pour cette campagne : la liste
  //    de référence, celle qu'on cherche à égaler ou à battre.
  const { data: webFound } = await supabaseAdmin
    .from('prospect_companies')
    .select('id, name, domain')
    .eq('found_by_campaign_id', campaignId);
  const webNames = new Set((webFound || []).map((c: any) => normalizeName(c.name)).filter(Boolean));

  // 2. Traduction du ciblage en critères de registre.
  const criteria = await planSireneCriteria(campaign.company_id, sectorKeywords, zoneLabel);
  if (!criteria.nafCodes.length || !criteria.departments.length) {
    return NextResponse.json({
      etape: 'criteres',
      erreur: criteria.error || 'aucun code NAF ou département produit',
      criteres: criteria,
    });
  }

  // 3. Le registre, gratuit.
  const discovery = await discoverFrenchCompanies({
    nafCodes: criteria.nafCodes,
    departments: criteria.departments,
    limit,
  });

  // L'URL exacte est renvoyée : si l'API refuse un paramètre, on le voit
  // immédiatement au lieu de deviner. C'est le premier essai réel de cette
  // requête, elle n'a pas pu être testée hors production.
  if (!discovery.candidates.length) {
    return NextResponse.json({
      etape: 'registre',
      erreur: discovery.error || 'aucun résultat',
      url_appelee: discovery.debugUrl,
      criteres: criteria,
    });
  }

  // 4. Le tri, un seul appel.
  const classification = await classifyCandidates(campaign.company_id, discovery.candidates, sectorKeywords);

  const parPile: Record<CandidatePile, any[]> = { sur: [], douteux: [], non: [] };
  let dejaTrouveesParLeWeb = 0;
  for (const c of discovery.candidates) {
    const pile = classification.piles[c.registryId] || 'douteux';
    const connue = webNames.has(normalizeName(c.name));
    if (connue) dejaTrouveesParLeWeb += 1;
    parPile[pile].push({
      nom: c.name,
      activite: c.activityLabel || c.activityCode,
      ville: c.city,
      code_postal: c.postalCode,
      effectif: c.employeeBracket,
      deja_trouvee_par_le_web: connue,
      fiche: c.sourceUrl,
    });
  }

  return NextResponse.json({
    campagne: {
      id: campaign.id,
      zone: zoneLabel,
      secteurs: sectorKeywords,
      objectif: campaign.target_count,
    },
    criteres_deduits: criteria,
    url_appelee: discovery.debugUrl,
    erreur_tri: classification.error || null,
    resume: {
      trouvees_par_le_web: webFound?.length || 0,
      trouvees_par_le_registre: discovery.candidates.length,
      total_disponible_dans_le_registre: discovery.totalAvailable,
      en_commun: dejaTrouveesParLeWeb,
      // Les trois chiffres qui décident. « sur » est ce qu'on paierait,
      // « non » est ce que le tri gratuit a évité de payer.
      pile_sur: parPile.sur.length,
      pile_douteux: parPile.douteux.length,
      pile_non: parPile.non.length,
      nouvelles_vs_web: parPile.sur.filter((c) => !c.deja_trouvee_par_le_web).length,
    },
    piles: parPile,
  });
}
