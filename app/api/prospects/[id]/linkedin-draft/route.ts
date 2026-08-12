// app/api/prospects/[id]/linkedin-draft/route.ts
// POST -> génère une proposition de note de connexion + premier message
// LinkedIn pour ce prospect (voir lib/linkedin-assist.ts : le commercial
// envoie lui-même, aucune automatisation).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateLinkedInDraft } from '@/lib/linkedin-assist';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  // Même vérification que les autres routes prospects : le commercial doit
  // être soit le propriétaire du prospect, soit dans la même société.
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  try {
    const draft = await generateLinkedInDraft(params.id);
    return NextResponse.json({ draft });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? "Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.",
        },
        { status: 429 }
      );
    }
    console.error('Erreur génération draft LinkedIn:', err.message);
    return NextResponse.json({ error: "Impossible de générer le message" }, { status: 500 });
  }
}
