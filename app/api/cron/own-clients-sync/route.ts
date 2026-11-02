// app/api/cron/own-clients-sync/route.ts
//
// « TOUS CEUX QUI UTILISENT AARON DOIVENT ÊTRE DANS MON FICHIER CLIENT »
// (Alex, 02/11/2026 — et c'est logique).
//
// lib/self-signup-client.ts créait déjà la fiche client au moment du
// paiement, depuis le webhook Stripe. Un seul point de passage, donc un seul
// point de panne : si le webhook échoue, si la société a été créée à la main
// dans Supabase, si elle existait avant que ce code soit écrit, ou si les
// variables MEETAARON_OWN_* n'étaient pas encore posées, le client n'apparaît
// NULLE PART et rien ne le rattrape jamais.
//
// Ce cron est ce rattrapage : une fois par jour, toute société qui a au moins
// un utilisateur a sa fiche dans le compte Meet Aaron. ensureSelfSignupClient
// est idempotent (il répond « already_known » si la fiche existe), donc ce
// passage ne crée jamais de doublon et ne coûte rien quand tout va bien.
//
// Exclus, volontairement :
//   - le compte Meet Aaron lui-même (il ne se démarche pas) ;
//   - les adresses fondateur (même raison, voir lib/founder.ts) ;
//   - les sociétés sans aucun utilisateur (coquille d'inscription abandonnée).
//
// Une société exemptée de facturation (billing_exempt) est en revanche
// INCLUSE : elle utilise Aaron, c'est tout ce que la demande dit. Alex
// décidera lui-même quoi en faire dans son fichier.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ensureSelfSignupClient } from '@/lib/self-signup-client';
import { isFounderEmail } from '@/lib/founder';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const ownCompanyId = (process.env.MEETAARON_OWN_COMPANY_ID || '').trim();
  if (!ownCompanyId || !(process.env.MEETAARON_OWN_USER_ID || '').trim()) {
    return NextResponse.json({
      skipped: true,
      reason: 'MEETAARON_OWN_COMPANY_ID et/ou MEETAARON_OWN_USER_ID absentes',
    });
  }

  try {
    // `not_a_client` : interrupteur par société (voir
    // migration_pas_un_client_2026-11-02.sql). Sans lui, une fiche supprimée
    // à la main serait RECRÉÉE au passage suivant — exactement le cas du
    // compte « CASA Audit », qui utilise Aaron sans être un client.
    //
    // La colonne peut ne pas exister encore (migration pas passée) : dans ce
    // cas on relit sans elle plutôt que de ne rien faire.
    let companies: any[] | null = null;
    {
      const withFlag = await supabaseAdmin
        .from('companies')
        .select('id, name, billing_country, stripe_customer_id, not_a_client');
      if (withFlag.error) {
        const plain = await supabaseAdmin
          .from('companies')
          .select('id, name, billing_country, stripe_customer_id');
        if (plain.error) return serverError(plain.error, 'Fichier client — lecture des sociétés');
        companies = (plain.data as any[]) || [];
      } else {
        companies = (withFlag.data as any[]) || [];
      }
    }

    let created = 0;
    let already = 0;
    let skipped = 0;
    const problems: string[] = [];

    for (const c of (companies || [])) {
      if (c.id === ownCompanyId) { skipped += 1; continue; }
      if (c.not_a_client === true) { skipped += 1; continue; }

      // Le patron, c'est-à-dire la personne qui a souscrit. À défaut, le plus
      // ancien utilisateur de la société.
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('email, full_name, role, created_at')
        .eq('company_id', c.id)
        .order('created_at', { ascending: true });
      const rows = (users as any[]) || [];
      const patron = rows.find((u) => u.role === 'patron') || rows[0];
      if (!patron?.email) { skipped += 1; continue; }
      if (isFounderEmail(patron.email)) { skipped += 1; continue; }

      try {
        const res = await ensureSelfSignupClient({
          email: patron.email,
          fullName: patron.full_name || null,
          companyName: c.name || null,
          country: c.billing_country || null,
          stripeCustomerId: c.stripe_customer_id || null,
        });
        if (res.created) created += 1;
        else if (res.reason === 'already_known') already += 1;
        else skipped += 1;
      } catch (err: any) {
        problems.push(`${c.id} : ${err?.message}`);
      }
    }

    return NextResponse.json({ created, already, skipped, problems });
  } catch (err: any) {
    return serverError(err, 'Fichier client — rattrapage');
  }
}
