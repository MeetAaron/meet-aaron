// app/api/welcome/route.ts
// Parcours de première connexion /app/bienvenue (refonte validée par Alex le
// 21/10/2026, voir migration_bienvenue_2026-10-22.sql).
//
// GET  -> état du parcours : fini ou non, écran et question où reprendre,
//         réponses déjà données, et ce qu'il faut savoir pour choisir les
//         écrans (profil d'entreprise existant, boîte mail liée, rôle).
// POST -> enregistre la progression À CHAQUE PAS (écran, question, réponse),
//         pour une reprise EXACTE après déconnexion, sur n'importe quel
//         appareil : tout est en base, rien dans le navigateur.
//         { step?, question?, answer?: { key, question, text }, done?: true }

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody, serverError } from '@/lib/http';

const WELCOME_STEPS = ['intro', 'company', 'campaign', 'mailbox', 'end'] as const;
type WelcomeStep = (typeof WELCOME_STEPS)[number];

function isMissingColumn(error: any): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204');
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, company_id, role, first_name, full_name, onboarding_answers, welcome_step, welcome_question, welcome_done_at')
    .eq('id', authedUser.id)
    .maybeSingle();

  // Migration du 22/10 pas encore jouée : on considère le parcours comme
  // fait, pour ne jamais enfermer quelqu'un dans un écran qui ne peut pas
  // enregistrer sa progression.
  if (isMissingColumn(error)) return NextResponse.json({ done: true, unavailable: true });
  if (error) return serverError(error, '/api/welcome');
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });

  const [{ data: company }, { data: connections }, { count: campaignCount }] = await Promise.all([
    supabaseAdmin.from('companies').select('name, business_summary').eq('id', user.company_id).maybeSingle(),
    supabaseAdmin.from('oauth_connections').select('provider').eq('user_id', user.id),
    supabaseAdmin.from('prospecting_campaigns').select('id', { count: 'exact', head: true }).eq('assigned_user_id', user.id),
  ]);

  const providers = (connections || []).map((c: any) => c.provider);
  const hasProfile = !!(company?.business_summary && String(company.business_summary).trim());

  return NextResponse.json({
    done: !!user.welcome_done_at,
    step: (WELCOME_STEPS as readonly string[]).includes(user.welcome_step) ? user.welcome_step : null,
    question: Number.isInteger(user.welcome_question) ? user.welcome_question : 0,
    answers: Array.isArray(user.onboarding_answers) ? user.onboarding_answers : [],
    role: user.role || null,
    first_name: user.first_name || String(user.full_name || '').split(/\s+/)[0] || '',
    company_name: company?.name || '',
    has_profile: hasProfile,
    // Commercial invité par code : son entreprise a déjà un profil, il ne
    // voit que Bienvenue, Boîte mail et Fin.
    invited: user.role === 'commercial' && hasProfile,
    has_campaign: (campaignCount || 0) > 0,
    mailbox_connected: providers.length > 0,
    mailbox_has_calendar: providers.some((p: string) => p === 'google' || p === 'microsoft'),
  });
}

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const body: any = await readJsonBody(request);
  const update: Record<string, any> = {};

  if (body.step !== undefined) {
    if (!(WELCOME_STEPS as readonly string[]).includes(body.step)) {
      return NextResponse.json({ error: 'Étape inconnue' }, { status: 400 });
    }
    update.welcome_step = body.step as WelcomeStep;
  }
  if (body.question !== undefined) {
    const q = Number(body.question);
    if (!Number.isInteger(q) || q < 0 || q > 50) return NextResponse.json({ error: 'Question invalide' }, { status: 400 });
    update.welcome_question = q;
  }
  if (body.done === true) {
    update.welcome_done_at = new Date().toISOString();
    update.welcome_step = 'end';
  }

  // Réponse à une question : remplace la réponse précédente à la même
  // question (clé), sans toucher aux autres. Même format que le chat
  // ({ question, answer }) + la clé, pour que /api/business-summary et la
  // reprise lisent la même chose.
  if (body.answer && typeof body.answer === 'object') {
    const key = String(body.answer.key || '').slice(0, 80);
    const text = String(body.answer.text || '').trim().slice(0, 2000);
    const question = String(body.answer.question || '').slice(0, 500);
    if (!key) return NextResponse.json({ error: 'Clé de question manquante' }, { status: 400 });
    const { data: current } = await supabaseAdmin.from('users').select('onboarding_answers').eq('id', authedUser.id).maybeSingle();
    const answers: any[] = Array.isArray(current?.onboarding_answers) ? current!.onboarding_answers : [];
    const others = answers.filter((a) => a?.key !== key);
    update.onboarding_answers = text ? [...others, { key, question, answer: text }] : others;
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ success: true });

  const { error } = await supabaseAdmin.from('users').update(update).eq('id', authedUser.id);
  if (isMissingColumn(error)) return NextResponse.json({ success: false, unavailable: true });
  if (error) return serverError(error, '/api/welcome');
  return NextResponse.json({ success: true });
}
