// app/api/business-summary/versions/route.ts
// Historique des 5 derniers profils d'entreprise (demande Alex, 29/08/2026 :
// "ce serait bien d'avoir un historique des 5 derniers profils avec leur
// date de modification. Car si jamais l'utilisateur fait une gaffe et
// clique sur 'relancer le questionnaire' que ça n'efface pas tout. Et à
// côté des docs il y a un bouton pour choisir le profil qui sera utilisé.").
//
// GET  -> liste les versions précédentes (jamais la version actuelle, qui
//         vit sur companies.business_summary — voir app/api/business-summary
//         GET pour la relire).
// POST -> réactive une ancienne version comme profil courant. Passe par
//         backupThenReplaceBusinessSummary (voir lib/business-summary-store.ts) :
//         le profil actuellement affiché est donc lui-même sauvegardé dans
//         l'historique avant d'être remplacé — on ne perd jamais rien, même
//         en cas d'erreur de manipulation (activer la mauvaise version).
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { buildBusinessProfilePreview } from '@/lib/business-profile-format';
import { backupThenReplaceBusinessSummary } from '@/lib/business-summary-store';

// Longueur d'aperçu plus courte qu'ailleurs (280) : ici affiché à côté d'une
// date dans une petite ligne de liste, pas en tête d'un document complet.
const HISTORY_PREVIEW_LENGTH = 140;

async function resolveCompanyId(userId: string): Promise<string | null> {
  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  return user?.company_id || null;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const companyId = await resolveCompanyId(userId);
  if (!companyId) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: versions, error } = await supabaseAdmin
    .from('business_summary_versions')
    .select('id, summary, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    versions: (versions || []).map((v) => ({
      id: v.id,
      createdAt: v.created_at,
      preview: buildBusinessProfilePreview(v.summary, HISTORY_PREVIEW_LENGTH),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { user_id, version_id } = await request.json();

  if (!user_id || !version_id) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const companyId = await resolveCompanyId(user_id);
  if (!companyId) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: version } = await supabaseAdmin
    .from('business_summary_versions')
    .select('summary, company_id')
    .eq('id', version_id)
    .maybeSingle();

  // Vérifie que la version demandée appartient bien à la société de
  // l'utilisateur authentifié — jamais confiance dans un id fourni côté
  // client sans ce contrôle (un commercial d'une autre société ne doit pas
  // pouvoir réactiver une version qui n'est pas la sienne).
  if (!version || version.company_id !== companyId) {
    return NextResponse.json({ error: 'Version introuvable' }, { status: 404 });
  }

  const { error } = await backupThenReplaceBusinessSummary(companyId, version.summary);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, summary: version.summary });
}
