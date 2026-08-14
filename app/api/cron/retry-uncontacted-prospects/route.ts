// app/api/cron/retry-uncontacted-prospects/route.ts
// Filet de sécurité, exécuté périodiquement via Vercel Cron.
//
// Cas traité : un prospect est ajouté (manuellement via POST /api/prospects,
// ou trouvé par une campagne via lib/sourcing.ts) AVANT que le commercial
// concerné ait connecté sa boîte mail (Gmail/Outlook) dans "Connexions".
// L'envoi du tout premier message d'Aaron échoue alors silencieusement (le
// prospect est quand même créé, avec un avertissement renvoyé au frontend),
// et jusqu'ici RIEN ne retentait cet envoi ensuite — même une fois la boîte
// mail connectée, le prospect restait bloqué indéfiniment sans être démarché
// ni avoir sa fiche remplie par Aaron (personality_type/notes/advice ne sont
// renseignés qu'après un premier contact réussi).
//
// Ce cron repère tout prospect encore jamais contacté avec succès
// (personality_type toujours null — même critère que lib/sourcing.ts pour
// détecter un "nouveau" prospect) dont le commercial assigné a désormais une
// boîte mail connectée, et retente l'envoi du premier message.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

// Plafond par commercial et par passage, pour ne jamais déclencher une rafale
// d'envois Gmail/Outlook d'un coup si beaucoup de prospects étaient restés
// bloqués (ex: boîte mail connectée après plusieurs jours d'ajouts manuels).
const MAX_PER_USER_PER_RUN = 5;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: stuckProspects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, conversations(id)')
    .is('personality_type', null)
    .eq('is_won', false)
    .eq('is_lost', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stuckProspects || stuckProspects.length === 0) {
    return NextResponse.json({ contacted: 0 });
  }

  // Ne retente que pour les commerciaux ayant désormais une boîte mail
  // connectée — sinon on retomberait sur le même échec qu'au moment de la
  // création du prospect, pour rien.
  const userIds = Array.from(new Set(stuckProspects.map((p) => p.assigned_user_id)));
  const { data: connections } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id')
    .in('user_id', userIds)
    .in('provider', ['google', 'microsoft']);

  const connectedUserIds = new Set((connections || []).map((c) => c.user_id));

  const perUserCount: Record<string, number> = {};
  let contacted = 0;

  for (const prospect of stuckProspects) {
    if (!connectedUserIds.has(prospect.assigned_user_id)) continue;

    perUserCount[prospect.assigned_user_id] = (perUserCount[prospect.assigned_user_id] || 0) + 1;
    if (perUserCount[prospect.assigned_user_id] > MAX_PER_USER_PER_RUN) continue;

    let conversationId = (prospect as any).conversations?.[0]?.id;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .insert({ prospect_id: prospect.id, channel: 'email' })
        .select('id')
        .single();
      conversationId = conv?.id;
    }
    if (!conversationId) continue;

    try {
      const aaronOutput = await generateAaronResponse(prospect.id);

      await sendEmailForUser(
        prospect.assigned_user_id,
        prospect.email,
        aaronOutput.email_draft.subject,
        aaronOutput.email_draft.body
      );

      const { data: senderUser } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', prospect.assigned_user_id)
        .single();

      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_email: senderUser?.email || '',
        recipient_email: prospect.email,
        body: aaronOutput.email_draft.body,
      });

      await supabaseAdmin
        .from('prospects')
        .update({
          status: aaronOutput.prospect_status,
          personality_type: aaronOutput.personality_type,
          personality_notes: aaronOutput.personality_notes,
          aaron_advice: aaronOutput.aaron_advice,
          ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
        })
        .eq('id', prospect.id);

      contacted++;
    } catch (err: any) {
      if (!(err instanceof MonthlyCapExceededError)) {
        console.error(`Erreur relance premier contact pour prospect ${prospect.id}:`, err.message);
      }
    }
  }

  return NextResponse.json({ contacted });
}
