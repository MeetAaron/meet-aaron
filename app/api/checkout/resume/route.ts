// app/api/checkout/resume/route.ts
// GET ?t=<jeton> — lien de l'email d'activation (voir app/api/checkout/
// email-link). Ouvert dans le navigateur (les adresses /api/* ne sont pas
// des liens universels de l'app, voir app/api/ios/aasa) : crée une session
// Stripe neuve avec les informations du formulaire et y redirige.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readActivationToken } from '@/lib/signup-activation';
import { createSignupCheckoutSession, SignupCheckoutError } from '@/lib/signup-checkout';

export const dynamic = 'force-dynamic';

const PAGE_TEXT: Record<string, { expired: string; done: string; error: string; back: string }> = {
  fr: { expired: "Ce lien d'activation est expiré ou incomplet. Ouvre l'application Meet Aaron et refais la dernière étape pour en recevoir un nouveau.", done: "Ton espace Meet Aaron est déjà actif. Ouvre l'application, ou connecte-toi sur meetaaron.app.", error: 'Le paiement ne peut pas s’ouvrir pour le moment. Réessaie dans quelques minutes, ou écris-nous à aaron@meetaaron.app.', back: 'Aller sur Meet Aaron' },
  en: { expired: 'This activation link has expired or is incomplete. Open the Meet Aaron app and redo the last step to receive a new one.', done: 'Your Meet Aaron space is already active. Open the app, or sign in at meetaaron.app.', error: 'The payment page cannot open right now. Try again in a few minutes, or write to aaron@meetaaron.app.', back: 'Go to Meet Aaron' },
  de: { expired: 'Dieser Aktivierungslink ist abgelaufen oder unvollständig. Öffne die Meet-Aaron-App und wiederhole den letzten Schritt, um einen neuen zu erhalten.', done: 'Dein Meet-Aaron-Bereich ist bereits aktiv. Öffne die App oder melde dich auf meetaaron.app an.', error: 'Die Zahlungsseite lässt sich gerade nicht öffnen. Versuche es in ein paar Minuten erneut oder schreib an aaron@meetaaron.app.', back: 'Zu Meet Aaron' },
  it: { expired: "Questo link di attivazione è scaduto o incompleto. Apri l'app Meet Aaron e ripeti l'ultimo passaggio per riceverne uno nuovo.", done: "Il tuo spazio Meet Aaron è già attivo. Apri l'app o accedi su meetaaron.app.", error: 'La pagina di pagamento non si apre al momento. Riprova tra qualche minuto o scrivi a aaron@meetaaron.app.', back: 'Vai su Meet Aaron' },
  es: { expired: 'Este enlace de activación ha caducado o está incompleto. Abre la aplicación Meet Aaron y repite el último paso para recibir uno nuevo.', done: 'Tu espacio Meet Aaron ya está activo. Abre la aplicación o inicia sesión en meetaaron.app.', error: 'La página de pago no se puede abrir ahora. Inténtalo de nuevo en unos minutos o escribe a aaron@meetaaron.app.', back: 'Ir a Meet Aaron' },
  pt: { expired: 'Este link de ativação expirou ou está incompleto. Abre a aplicação Meet Aaron e repete o último passo para receberes um novo.', done: 'O teu espaço Meet Aaron já está ativo. Abre a aplicação ou inicia sessão em meetaaron.app.', error: 'A página de pagamento não abre de momento. Tenta de novo dentro de alguns minutos ou escreve para aaron@meetaaron.app.', back: 'Ir para o Meet Aaron' },
  nl: { expired: 'Deze activeringslink is verlopen of onvolledig. Open de Meet Aaron-app en herhaal de laatste stap om een nieuwe te ontvangen.', done: 'Je Meet Aaron-omgeving is al actief. Open de app of log in op meetaaron.app.', error: 'De betaalpagina kan nu niet worden geopend. Probeer het over een paar minuten opnieuw of schrijf naar aaron@meetaaron.app.', back: 'Naar Meet Aaron' },
};

function page(locale: string, kind: 'expired' | 'done' | 'error', status: number) {
  const T = PAGE_TEXT[locale] || PAGE_TEXT.fr;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Meet Aaron</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e1a;font-family:-apple-system,system-ui,sans-serif;padding:1.25rem}.c{max-width:400px;background:#131629;border:1px solid #232744;border-radius:16px;padding:2rem 1.5rem;text-align:center;color:#f4f1ea}img{width:48px;height:48px;border-radius:12px}p{color:#a3a9c2;line-height:1.5}a{display:inline-block;margin-top:.6rem;background:#4b39ef;color:#fff;text-decoration:none;border-radius:10px;padding:.7rem 1.1rem;font-weight:600}</style></head><body><div class="c"><img src="/icon.png" alt="Meet Aaron"><p>${esc(T[kind])}</p><a href="/login">${esc(T.back)}</a></div></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const data = readActivationToken(request.nextUrl.searchParams.get('t'));
  const guessLocale = (request.headers.get('accept-language') || 'fr').slice(0, 2).toLowerCase();
  if (!data) return page(PAGE_TEXT[guessLocale] ? guessLocale : 'fr', 'expired', 400);
  const locale = PAGE_TEXT[data.locale] ? data.locale : 'fr';

  // Déjà payé (lien recliqué après coup) : pas de deuxième abonnement.
  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('auth_user_id', data.auth_user_id).maybeSingle();
  if (existing) return page(locale, 'done', 200);

  try {
    const url = await createSignupCheckoutSession({
      ...data,
      origin: request.nextUrl.origin,
      // Retour de Stripe dans le NAVIGATEUR, où la personne n'est en
      // général pas connectée : la page de succès le gère (via=email).
      successPath: '/onboarding/success?session_id={CHECKOUT_SESSION_ID}&via=email',
      cancelPath: '/login',
    });
    return NextResponse.redirect(url, 303);
  } catch (err: any) {
    if (!(err instanceof SignupCheckoutError)) {
      console.error('Lien d’activation : session Stripe impossible', { type: err?.type || null, code: err?.code || null });
    } else {
      console.error('Lien d’activation :', err.message);
    }
    return page(locale, 'error', 502);
  }
}
