// app/api/mailbox/imap/route.ts
// Connecteur « Autre boîte mail » (IMAP/SMTP) — 09/09/2026, voir lib/imap.ts.
//
// GET  ?user_id=…&email=…  → serveurs devinés pour cette adresse (pré-remplissage)
// POST { user_id, email, password, imap_host, imap_port, imap_secure,
//        smtp_host, smtp_port, smtp_secure, username? }
//      → teste la connexion IMAP puis SMTP, crée le dossier « Géré par Aaron »,
//        et n'enregistre la boîte QUE si tout répond. Réponse 422 avec l'étape
//        en échec sinon. Le mot de passe transite une fois, en HTTPS, depuis
//        le navigateur du commercial ; il est chiffré au repos.
//
// Réservé à l'utilisateur lui-même (même règle que /api/auth/google).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { autodiscoverMailServers, guessVariants } from '@/lib/mail-autodiscover';
import { testImapSmtp, saveImapConnection, type ImapCredentials } from '@/lib/imap';
import { notifyIfDeliverabilityIssue } from '@/lib/email-deliverability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!userId || !email.includes('@')) {
    return NextResponse.json({ error: 'user_id ou email manquant' }, { status: 400 });
  }
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const servers = await autodiscoverMailServers(email);
  return NextResponse.json({ email, servers });
}

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.round(n) : fallback;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || '');
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!userId || !email.includes('@') || !password) {
    return NextResponse.json({ error: 'email et mot de passe requis' }, { status: 400 });
  }
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const guessed = await autodiscoverMailServers(email);
  const base = {
    imap_host: String(body.imap_host || guessed.imap_host).trim(),
    imap_port: toInt(body.imap_port, guessed.imap_port),
    imap_secure: body.imap_secure === undefined ? guessed.imap_secure : Boolean(body.imap_secure),
    smtp_host: String(body.smtp_host || guessed.smtp_host).trim(),
    smtp_port: toInt(body.smtp_port, guessed.smtp_port),
    smtp_secure: body.smtp_secure === undefined ? guessed.smtp_secure : Boolean(body.smtp_secure),
  };
  const username = String(body.username || '').trim() || email;

  // Si les serveurs viennent d'une simple devinette (imap.<domaine>) et
  // qu'ils ne répondent pas, on essaie les variantes usuelles avant de
  // renvoyer l'erreur au commercial.
  const attempts = [base];
  const userSuppliedHosts = Boolean(body.imap_host) || Boolean(body.smtp_host);
  if (guessed.source === 'guess' && !userSuppliedHosts) {
    attempts.push(...guessVariants(email.split('@')[1]));
  }

  let lastError: { step: 'imap' | 'smtp'; error: string } | null = null;
  for (const settings of attempts) {
    const creds: ImapCredentials = { email, username, password, settings };
    const result = await testImapSmtp(creds);
    if (result.ok === true) {
      const okResult = result as { ok: true; sentFolder: string | null; aaronFolder: string };
      await saveImapConnection(userId, creds, { sentFolder: okResult.sentFolder, aaronFolder: okResult.aaronFolder });
      // Contrôle de délivrabilité (12/09/2026, demande d'Alex : « Aaron doit
      // toujours vérifier ce qui est vital, quel que soit l'email utilisé »).
      // Il n'existait que sur les connexions Google et Microsoft — une boîte
      // OVH ou Gandi se connectait donc sans que personne ne regarde jamais
      // son SPF ni son DKIM. Fire-and-forget : jamais bloquant pour la
      // connexion, qui vient de réussir.
      notifyIfDeliverabilityIssue(userId, email, 'imap').catch(() => {});
      return NextResponse.json({
        ok: true,
        email,
        settings: { ...settings, username, sent_folder: okResult.sentFolder, aaron_folder: okResult.aaronFolder },
      });
    }
    // (strict: false → pas de rétrécissement automatique de l'union, d'où le cast)
    const failed = result as { ok: false; step: 'imap' | 'smtp'; error: string };
    lastError = { step: failed.step, error: failed.error };
    // Mot de passe refusé : inutile d'essayer d'autres serveurs.
    if (/auth|login|password|credential|535|LOGIN failed/i.test(failed.error)) break;
  }

  return NextResponse.json(
    {
      ok: false,
      step: lastError?.step || 'imap',
      error: lastError?.error || 'Connexion impossible',
      tried: attempts.map((a) => `${a.imap_host}:${a.imap_port} / ${a.smtp_host}:${a.smtp_port}`),
    },
    { status: 422 }
  );
}
