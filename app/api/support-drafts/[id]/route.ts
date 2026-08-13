// app/api/support-drafts/[id]/route.ts
// PATCH -> action "envoyer" (envoie la suggestion de réponse au client, au
//          nom du commercial) ou "ecarter" (l'écarte sans l'envoyer, ex: le
//          commercial préfère répondre lui-même de zéro).
// Voir app/api/support-drafts/route.ts (liste) et app/app/customer/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { sendEmailForUser } from '@/lib/messaging';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const draftId = params.id;
  const { action } = await request.json();

  const { data: draft, error } = await supabaseAdmin
    .from('customer_support_drafts')
    .select('id, prospect_id, suggested_subject, suggested_body, sent_at, dismissed_at, prospects (assigned_user_id, full_name, email)')
    .eq('id', draftId)
    .single();

  if (error || !draft) {
    return NextResponse.json({ error: 'Suggestion introuvable' }, { status: 404 });
  }

  const prospect = (draft as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect?.assigned_user_id) return forbiddenResponse();

  if (draft.sent_at || draft.dismissed_at) {
    return NextResponse.json({ error: 'Cette suggestion a déjà été traitée.' }, { status: 400 });
  }

  if (action === 'ecarter') {
    await supabaseAdmin
      .from('customer_support_drafts')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', draftId);
    return NextResponse.json({ success: true, status: 'ecarte' });
  }

  if (action === 'envoyer') {
    try {
      await sendEmailForUser(prospect.assigned_user_id, prospect.email, draft.suggested_subject, draft.suggested_body);
    } catch (err: any) {
      console.error('Erreur envoi réponse support:', err.message);
      const message = err.message?.includes('Aucune boîte mail connectée')
        ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
        : "Erreur lors de l'envoi de l'email.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const sentAt = new Date().toISOString();
    await supabaseAdmin.from('customer_support_drafts').update({ sent_at: sentAt }).eq('id', draftId);

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', draft.prospect_id)
      .eq('channel', 'email')
      .maybeSingle();

    if (conversation) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: '',
        recipient_email: prospect.email,
        body: draft.suggested_body,
      });
    }

    return NextResponse.json({ success: true, status: 'envoye', sent_at: sentAt });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
