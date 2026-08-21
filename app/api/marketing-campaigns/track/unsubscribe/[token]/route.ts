// app/api/marketing-campaigns/track/unsubscribe/[token]/route.ts
// GET -> route PUBLIQUE (lien cliqué depuis une boîte mail, sans session).
// Marque le destinataire comme désabonné pour cette campagne ET pose
// prospects.marketing_opt_out = true pour ce client, afin qu'il soit exclu
// de TOUTES les futures campagnes marketing (pas seulement celle-ci) — c'est
// ce qu'on attend d'un lien "se désinscrire", pas une exception au cas par
// cas. Renvoie une petite page de confirmation en HTML (pas un email, donc
// aucun rapport avec la limitation text/plain documentée dans
// lib/marketing-tracking.ts).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function confirmationPage(message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Désabonnement</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:Arial,Helvetica,sans-serif;background:#0F1222;color:#EDEEF5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center}
.card{max-width:420px}h1{font-size:1.2rem;margin-bottom:0.5rem}p{color:#8B90A8;font-size:0.95rem}</style>
</head><body><div class="card"><h1>Meet Aaron</h1><p>${message}</p></div></body></html>`;
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const { data: recipient } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id, prospect_id, unsubscribed_at')
    .eq('tracking_token', params.token)
    .maybeSingle();

  if (!recipient) {
    return new NextResponse(confirmationPage('Ce lien de désabonnement n\'est plus valide.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!recipient.unsubscribed_at) {
    await supabaseAdmin
      .from('marketing_campaign_recipients')
      .update({ status: 'desabonne', unsubscribed_at: new Date().toISOString() })
      .eq('id', recipient.id);
  }

  await supabaseAdmin.from('prospects').update({ marketing_opt_out: true }).eq('id', recipient.prospect_id);

  return new NextResponse(
    confirmationPage("Vous avez bien été désabonné(e) des emails marketing. Vous ne recevrez plus ce type d'email."),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
