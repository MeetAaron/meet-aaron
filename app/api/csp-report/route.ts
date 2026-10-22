// app/api/csp-report/route.ts
// Reçoit les rapports de la CSP en mode rapport (next.config.js, 22/10/2026).
// Rien n'est bloqué côté navigateur : on se contente de journaliser ce
// qu'une vraie CSP aurait bloqué, pour la régler avant de l'appliquer.
// Journal minimal et sans données sensibles : directive violée, origine de la
// ressource bloquée et CHEMIN de la page (jamais les paramètres d'URL, qui
// peuvent porter des identifiants).

import { NextRequest, NextResponse } from 'next/server';

function originOnly(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  try {
    const u = new URL(v);
    return u.origin;
  } catch {
    return v.slice(0, 40); // 'inline', 'eval', 'data'…
  }
}

function pathOnly(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  try {
    return new URL(v).pathname.slice(0, 120);
  } catch {
    return '';
  }
}

export async function POST(request: NextRequest) {
  try {
    const text = (await request.text()).slice(0, 10_000);
    const body = JSON.parse(text);
    const r = body?.['csp-report'] || body?.[0]?.body || body || {};
    console.warn(
      '[csp-report]',
      r['violated-directive'] || r.effectiveDirective || r['effective-directive'] || '?',
      originOnly(r['blocked-uri'] || r.blockedURL),
      pathOnly(r['document-uri'] || r.documentURL)
    );
  } catch {
    // rapport illisible : ignoré
  }
  return new NextResponse(null, { status: 204 });
}
