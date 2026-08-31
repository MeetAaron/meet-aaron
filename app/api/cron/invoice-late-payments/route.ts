// app/api/cron/invoice-late-payments/route.ts
// Exécuté quotidiennement via Vercel Cron. Détecte les factures internes
// (client_invoices.source = 'interne', voir lib/client-invoices.ts) émises
// dont l'échéance est dépassée sans paiement, les passe en statut
// "en_retard", et notifie le commercial une seule fois (late_notified_at).
// Tâche #141 sous-item 2.
//
// Ne couvre volontairement que les factures internes : les factures qui
// existeraient déjà dans un CRM avec module de facturation natif (Jobber,
// Housecall Pro, ServiceM8, Axonaut, Sellsy) ne sont pas encore lues par
// Meet Aaron — voir le statut du projet pour ce chantier de suite possible.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';
import { sendEmailForUser } from '@/lib/messaging';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: overdueInvoices, error } = await supabaseAdmin
    .from('client_invoices')
    .select('id, invoice_number, total_ttc_eur, due_date, prospect_id, company_id, prospects (full_name, assigned_user_id, users (id, full_name, email, notify_channel))')
    .eq('status', 'emise')
    .eq('source', 'interne')
    .lt('due_date', today)
    .not('due_date', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let flagged = 0;
  let notified = 0;

  for (const invoice of overdueInvoices || []) {
    try {
      const { error: statusError } = await supabaseAdmin
        .from('client_invoices')
        .update({ status: 'en_retard' })
        .eq('id', invoice.id)
        .eq('status', 'emise'); // évite d'écraser un paiement/annulation arrivé entre-temps

      if (statusError) {
        console.error(`Erreur passage en retard facture ${invoice.id}:`, statusError.message);
        continue;
      }
      flagged++;

      const prospect = (invoice as any).prospects;
      const user = prospect?.users;
      if (!user) continue;

      const message = `La facture ${invoice.invoice_number} (${(invoice.total_ttc_eur || 0).toFixed(2)} €) de ${prospect.full_name} a dépassé son échéance sans être marquée payée.`;
      const url = `/app/prospects?contact=${invoice.prospect_id}`;

      const channel = user.notify_channel || 'email';
      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, { title: 'Facture en retard', body: message, url });
      }
      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(user.id, user.email, 'Facture en retard de paiement', `${message}\n\n${process.env.APP_URL || ''}${url}`);
      }

      await supabaseAdmin.from('client_invoices').update({ late_notified_at: new Date().toISOString() }).eq('id', invoice.id);
      notified++;
    } catch (err: any) {
      // Un échec sur UNE facture ne doit pas empêcher le traitement des autres.
      console.error(`Erreur traitement retard facture ${invoice.id}:`, err.message);
    }
  }

  return NextResponse.json({ flagged, notified });
}
