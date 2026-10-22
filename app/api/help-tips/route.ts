// app/api/help-tips/route.ts
// Bulles d'aide au premier passage (lot 3 de la refonte de l'onboarding,
// 22/10/2026) — voir components/HelpLayer.jsx.
// GET  -> { seen: ['prospects', ...] } : pages dont la bulle a été fermée.
// POST -> { tip } : marque la bulle de cette page comme vue.
// Mémorisé en base (users.help_tips_seen) : on ne la revoit ni sur un autre
// appareil ni après une déconnexion.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody, serverError } from '@/lib/http';

const TIPS = ['prospects', 'campaigns', 'agenda', 'resultats'];

function isMissingColumn(error: any): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204');
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  const { data, error } = await supabaseAdmin.from('users').select('help_tips_seen').eq('id', authedUser.id).maybeSingle();
  // Migration pas encore jouée : on ne montre aucune bulle (impossible de
  // retenir qu'elle a été fermée, elle reviendrait à chaque page).
  if (isMissingColumn(error)) return NextResponse.json({ unavailable: true });
  if (error) return serverError(error, '/api/help-tips');
  const seen = Array.isArray(data?.help_tips_seen) ? data!.help_tips_seen.filter((t: unknown) => typeof t === 'string') : [];
  return NextResponse.json({ seen });
}

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  const body: any = await readJsonBody(request);
  const tip = String(body?.tip || '');
  if (!TIPS.includes(tip)) return NextResponse.json({ error: 'Bulle inconnue' }, { status: 400 });

  const { data, error } = await supabaseAdmin.from('users').select('help_tips_seen').eq('id', authedUser.id).maybeSingle();
  if (isMissingColumn(error)) return NextResponse.json({ success: false, unavailable: true });
  if (error) return serverError(error, '/api/help-tips');
  const seen: string[] = Array.isArray(data?.help_tips_seen) ? data!.help_tips_seen : [];
  if (seen.includes(tip)) return NextResponse.json({ success: true });

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ help_tips_seen: [...seen, tip] })
    .eq('id', authedUser.id);
  if (updateError) return serverError(updateError, '/api/help-tips');
  return NextResponse.json({ success: true });
}
