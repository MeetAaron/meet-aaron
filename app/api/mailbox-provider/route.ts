// app/api/mailbox-provider/route.ts
//
// GET -> devine le fournisseur de messagerie du commercial connecté, à partir
// du domaine de son adresse : 'google' | 'microsoft' | null.
//
// Demande Alex (08/09/2026) : « on est obligés d'avoir le bouton Google et le
// bouton Microsoft, ou on peut tout mettre sous un seul bouton du genre
// "connecter ma boîte email + agenda" ? » — un commercial ne se demande pas
// s'il est Google ou Microsoft, il sait juste qu'il a une boîte mail. C'est
// donc à l'app de deviner, et à lui de ne rien choisir dans 99 % des cas.
//
// Comment : les domaines grand public sont connus ; pour un domaine
// d'entreprise, on interroge ses enregistrements MX — un domaine hébergé chez
// Google Workspace pointe vers google.com / googlemail.com, chez Microsoft 365
// vers outlook.com (mail.protection.outlook.com). Fiable en B2B, ~50 ms, et
// aucune donnée n'est envoyée nulle part : une résolution DNS publique.
//
// null = on ne sait pas (boîte auto-hébergée, OVH, Gandi, Zoho…) : l'écran
// montre alors les deux fournisseurs et laisse choisir. Ne jamais deviner au
// hasard — envoyer quelqu'un vers le mauvais écran de consentement est pire
// que lui poser la question.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { detectMailboxProvider } from '@/lib/mailbox-provider';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', authedUser.id).maybeSingle();
  const email = (user as any)?.email || '';
  const provider = await detectMailboxProvider(email);
  return NextResponse.json({ provider, domain: email.split('@')[1] || null });
}
