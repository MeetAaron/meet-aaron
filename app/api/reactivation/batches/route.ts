// app/api/reactivation/batches/route.ts
// Docx pipeline "Réactivation" (Alex, 2026-08-23), niveau 1 : quand le
// commercial dépose un fichier de clients/prospects/opportunités perdus
// pour qu'Aaron les reprenne en charge (voir components/CsvImportModal.jsx,
// contexte "reactivation"), on trace CE dépôt de fichier comme un
// "reactivation_batches" — sert à :
//   1. la confirmation "je confirme donner à Aaron la prise en charge de ce
//      fichier" (une fois par fichier, pas une fois par email/ligne) ;
//   2. rattacher chaque prospect réactivé à son fichier d'origine
//      (prospects.reactivation_batch_id), pour pouvoir un jour retrouver
//      "tout ce qui vient de ce fichier" (filtre à venir sur la page
//      Prospects si besoin) ;
//   3. la future mécanique "demande de contexte" (Aaron sait de quel dépôt
//      vient un contact quand il doit demander de l'aide au commercial).
// Ce fichier ne crée AUCUN prospect lui-même — la création se fait ensuite
// via les appels existants à POST /api/prospects (un par ligne du fichier),
// avec reactivation_batch_id renseigné.
//
// PAS de lecture/écriture DB directe hors Supabase ici : migration à exécuter
// par Alex, voir migration_reactivation_2026-08-23.sql.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { company_id, uploaded_by_user_id, file_name, row_count } = body;

  if (!company_id || !uploaded_by_user_id || !file_name) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== uploaded_by_user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  const { data: batch, error } = await supabaseAdmin
    .from('reactivation_batches')
    .insert({
      company_id,
      uploaded_by_user_id,
      file_name,
      row_count: row_count || null,
      confirmed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ batch });
}
