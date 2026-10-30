// app/api/webhooks/external-conversion/[secret]/route.ts
// Webhook générique de conversion prospect -> client (demande Alex, 2026-08-26)
// ---------------------------------------------------------------------------
// Généralise à N'IMPORTE QUEL commercial le mécanisme déjà construit pour
// meetaaron.app lui-même (lib/prospect-conversion.ts) : un commercial dont
// l'objectif de prospection est "inscription/abonnement direct" (pas de
// RDV, voir companies.prospecting_goal) vend un produit qui se souscrit
// tout seul, et a besoin qu'Aaron sache automatiquement quand UN DE SES
// PROSPECTS a réellement payé/s'est inscrit, pour le faire basculer en
// client gagné sans bilan manuel.
//
// Chaque société a une URL UNIQUE et SECRÈTE (companies.external_conversion_
// webhook_secret, voir migration_external_conversion_webhook_2026-08-26.sql,
// affichée en copiable dans Préférences), à brancher côté commercial sur
// SON PROPRE outil : Stripe (webhook direct ou via Zapier/Make), un CRM,
// une automatisation quelconque qui sait "pousser" un email vers une URL
// quand un client paie. Le secret dans l'URL fait office d'authentification
// (comme la plupart des webhooks entrants tiers — Zapier, Stripe Connect
// pour compte tiers, etc.) : pas de vérification de signature possible ici
// puisqu'on ne connaît pas à l'avance le système de facturation utilisé.
//
// Payload accepté (POST, JSON) — DEUX formes reconnues pour rester simple à
// brancher sans middleware, y compris depuis un webhook Stripe direct :
//   1. Générique (Zapier/Make/CRM) : { "email": "prospect@example.com" }
//   2. Stripe checkout.session.completed natif, si le commercial pointe
//      directement SON PROPRE webhook Stripe ici sans transformation :
//      { "data": { "object": { "customer_details": { "email": "..." } } } }
//
// INSCRIPTION N'EST PAS PAIEMENT (30/10/2026). Le payload décide : avec une
// preuve de paiement (`{"paid": true}`, ou Stripe payment_status 'paid' avec
// un montant non nul), le prospect devient client avec première commande
// confirmée. Sans preuve — essai gratuit, compte gratuit, inscription à une
// liste — il passe en OPPORTUNITÉ au stade le plus avancé, pas en client :
// Aaron arrête de le démarcher à froid et le suit comme une affaire en
// cours. Le jour où le paiement arrive, le même webhook le promeut client.
//
// Réponse toujours 200 dès que le secret est valide, MÊME si aucun email
// exploitable n'est trouvé dans le payload ou si aucun prospect ne
// correspond : un webhook qui répond une erreur déclenche des retries
// infinis côté Stripe/Zapier pour une intégration qu'on ne peut pas
// corriger nous-mêmes depuis ce endpoint. Seul un secret inconnu vaut 404.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { convertMatchingProspectsToClients } from '@/lib/prospect-conversion';

// Le payload prouve-t-il un PAIEMENT, ou seulement une inscription ?
// (Alex, 30/10/2026.) Jusqu'ici la route répondait « paiement » dans tous les
// cas : un prospect qui ouvrait un simple essai gratuit basculait en client
// avec première commande confirmée — Aaron arrêtait de le suivre, l'accueil
// automatique partait, la synchro CRM aussi, et il comptait dans le chiffre
// d'affaires de la page Marge. Un euro affiché que personne n'avait encaissé.
//
// On ne devine rien : il faut une preuve explicite dans le payload. Sans
// preuve, l'inscription reste une inscription (voir prospect-conversion.ts).
function looksPaid(body: any): boolean {
  if (!body || typeof body !== 'object') return false;

  // Forme générique : le commercial (ou son Zapier) le dit lui-même.
  if (body.paid === true || body.paid === 'true') return true;

  // Forme Stripe native : checkout.session.completed d'un paiement réel.
  // payment_status vaut 'no_payment_required' pour un essai sans carte et
  // 'unpaid' tant que rien n'est encaissé — seul 'paid' compte, et il faut
  // en plus un montant non nul (un coupon à 100 % donne 'paid' à 0).
  const obj = body?.data?.object;
  if (obj && typeof obj === 'object') {
    const amount = Number(obj.amount_total ?? obj.amount_paid ?? 0);
    if (obj.payment_status === 'paid' && amount > 0) return true;
  }
  return false;
}

function extractEmail(body: any): string | null {
  if (!body || typeof body !== 'object') return null;

  if (typeof body.email === 'string' && body.email.trim()) {
    return body.email.trim();
  }

  // Forme Stripe checkout.session.completed native.
  const stripeEmail =
    body?.data?.object?.customer_details?.email ||
    body?.data?.object?.customer_email ||
    null;
  if (typeof stripeEmail === 'string' && stripeEmail.trim()) {
    return stripeEmail.trim();
  }

  return null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const params = await ctx.params;
  const secret = params.secret;
  if (!secret) {
    return NextResponse.json({ error: 'Secret manquant' }, { status: 404 });
  }

  const { data: company, error } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('external_conversion_webhook_secret', secret)
    .maybeSingle();

  if (error || !company) {
    return NextResponse.json({ error: 'Webhook inconnu' }, { status: 404 });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const email = extractEmail(body);
  if (!email) {
    return NextResponse.json({ received: true, matched: false });
  }

  // Contrairement à l'appel fire-and-forget du webhook Stripe interne (où la
  // conversion est un effet secondaire best-effort d'une création de compte
  // déjà réussie), ici c'est TOUT le travail de cette route — on attend la
  // fin avant de répondre pour ne pas risquer que la fonction serverless
  // s'arrête avant que la conversion soit faite.
  try {
    await convertMatchingProspectsToClients(email, company.id, { paid: looksPaid(body) });
  } catch (err: any) {
    console.error(`Erreur webhook conversion externe (société ${company.id}):`, err.message);
  }

  return NextResponse.json({ received: true });
}
